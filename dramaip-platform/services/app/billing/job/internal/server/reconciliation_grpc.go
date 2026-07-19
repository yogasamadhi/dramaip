package server

import (
	"context"
	"fmt"
	"strings"

	billingjobv1 "github.com/dramaip/dramaip-platform/services/api/billing/job/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
	billingsvc "github.com/dramaip/dramaip-platform/services/app/billing/job/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ReconciliationOperationsService is kept alongside the job rather than the
// synchronous billing service. The job owns the durable reports, cursor and
// the only safe repair implementation; Admin cannot bypass it with SQL.
type ReconciliationOperationsService struct {
	billingjobv1.UnimplementedReconciliationOperationsServiceServer
	svc *billingsvc.OutboxService
}

func NewReconciliationOperationsService(svc *billingsvc.OutboxService) *ReconciliationOperationsService {
	return &ReconciliationOperationsService{svc: svc}
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *ReconciliationOperationsService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(
			recovery.Recovery(),
			platform.GRPCPeerAuthorization(cfg.MTLS, "admin-bff"),
			platform.GRPCUserIdentityPropagation(cfg.MTLS),
			kratosx.TraceMiddleware("billing-job"),
		),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("billing job gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	billingjobv1.RegisterReconciliationOperationsServiceServer(server.Server, svc)
	return server
}

func (s *ReconciliationOperationsService) StartReconciliation(ctx context.Context, req *billingjobv1.StartReconciliationRequest) (*billingjobv1.StartReconciliationResponse, error) {
	if err := s.requireActor(ctx, req.GetActorId()); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, status.Error(codes.InvalidArgument, "idempotency_key_required")
	}
	run, err := s.svc.ReconcileIdempotent(ctx, req.GetActorId(), req.GetIdempotencyKey())
	if err != nil {
		return nil, err
	}
	return &billingjobv1.StartReconciliationResponse{Run: reconciliationRunReply(run)}, nil
}

func (s *ReconciliationOperationsService) GetLatestReconciliationRun(ctx context.Context, _ *billingjobv1.GetLatestReconciliationRunRequest) (*billingjobv1.GetLatestReconciliationRunResponse, error) {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return nil, err
	}
	run, err := s.svc.LatestReconciliationRun(ctx)
	if err != nil {
		return nil, err
	}
	return &billingjobv1.GetLatestReconciliationRunResponse{Run: reconciliationRunReply(run)}, nil
}

func (s *ReconciliationOperationsService) ListReconciliationItems(ctx context.Context, req *billingjobv1.ListReconciliationItemsRequest) (*billingjobv1.ListReconciliationItemsResponse, error) {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return nil, err
	}
	if state := strings.TrimSpace(req.GetStatus()); state != "" && state != "open" && state != "manual_review" && state != "resolved" {
		return nil, status.Error(codes.InvalidArgument, "invalid_reconciliation_status")
	}
	items, err := s.svc.ListReconciliationItems(ctx, req.GetStatus(), int(req.GetLimit()))
	if err != nil {
		return nil, err
	}
	response := &billingjobv1.ListReconciliationItemsResponse{Items: make([]*billingjobv1.ReconciliationItem, 0, len(items))}
	for _, item := range items {
		response.Items = append(response.Items, reconciliationItemReply(item))
	}
	return response, nil
}

func (s *ReconciliationOperationsService) ApplyReconciliationAction(ctx context.Context, req *billingjobv1.ApplyReconciliationActionRequest) (*billingjobv1.ApplyReconciliationActionResponse, error) {
	if err := s.requireActor(ctx, req.GetActorId()); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetItemId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "reconciliation_item_id_required")
	}
	action, err := s.svc.ApplyReconciliationAction(ctx, req.GetItemId(), data.ReconciliationActionInput{
		Action: req.GetAction(), Actor: req.GetActorId(), Reason: req.GetReason(), IdempotencyKey: req.GetIdempotencyKey(),
	})
	if err != nil {
		return nil, err
	}
	return &billingjobv1.ApplyReconciliationActionResponse{Action: reconciliationActionReply(action)}, nil
}

func (s *ReconciliationOperationsService) requireActor(ctx context.Context, actorID string) error {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return err
	}
	if strings.TrimSpace(actorID) == "" {
		return status.Error(codes.InvalidArgument, "actor_id_required")
	}
	return platform.RequireUserIdentity(ctx, actorID)
}

func reconciliationRunReply(value data.ReconciliationRun) *billingjobv1.ReconciliationRun {
	return &billingjobv1.ReconciliationRun{
		Id: value.ID, Trigger: value.Trigger, RequestedBy: value.RequestedBy, Status: value.Status,
		ScannedItems: int32(value.ScannedOrders), DetectedItems: int32(value.DetectedItems),
		StartedAt: value.StartedAt, CompletedAt: value.FinishedAt, Failure: value.FailureReason,
	}
}

func reconciliationItemReply(value data.ReconciliationItem) *billingjobv1.ReconciliationItem {
	return &billingjobv1.ReconciliationItem{
		Id: value.ID, OrderId: value.OrderID, SubscriptionId: value.SubscriptionID,
		MismatchType: value.MismatchType, Severity: value.Severity, Recommendation: value.RecommendedAction,
		Status: value.Status, Occurrences: int32(value.Occurrences), FirstDetectedAt: value.FirstDetectedAt,
		LastDetectedAt: value.LastDetectedAt, ResolvedAt: value.ResolvedAt, ResolvedBy: value.ResolvedBy,
		ResolutionNote: value.ResolutionNote,
	}
}

func reconciliationActionReply(value data.ReconciliationAction) *billingjobv1.ReconciliationAction {
	return &billingjobv1.ReconciliationAction{
		Id: value.ID, ItemId: value.ItemID, Action: value.Action, IdempotencyKey: value.IdempotencyKey,
		Actor: value.Actor, Reason: value.Reason, Status: value.Status, OutcomeJson: string(value.Outcome),
		CreatedAt: value.CreatedAt, CompletedAt: value.CompletedAt,
	}
}
