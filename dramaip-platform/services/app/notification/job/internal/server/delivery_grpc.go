package server

import (
	"context"
	"errors"
	"fmt"
	"strings"

	notificationjobv1 "github.com/dramaip/dramaip-platform/services/api/notification/job/v1"
	notificationdata "github.com/dramaip/dramaip-platform/services/app/notification/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	notificationsvc "github.com/dramaip/dramaip-platform/services/app/notification/job/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// DeliveryOperationsService is part of notification-job because the job owns
// the inbox lease and delivery adapters. Retrying here prevents Admin from
// mutating inbox state or fabricating a delivery result directly.
type DeliveryOperationsService struct {
	notificationjobv1.UnimplementedNotificationDeliveryOperationsServiceServer
	repo *notificationdata.NotificationRepo
	svc  *notificationsvc.ConsumerService
}

func NewDeliveryOperationsService(repo *notificationdata.NotificationRepo, svc *notificationsvc.ConsumerService) *DeliveryOperationsService {
	return &DeliveryOperationsService{repo: repo, svc: svc}
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *DeliveryOperationsService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(
			recovery.Recovery(),
			platform.GRPCPeerAuthorization(cfg.MTLS, "admin-bff"),
			platform.GRPCUserIdentityPropagation(cfg.MTLS),
			kratosx.TraceMiddleware("notification-job"),
		),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("notification job gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	notificationjobv1.RegisterNotificationDeliveryOperationsServiceServer(server.Server, svc)
	return server
}

func (s *DeliveryOperationsService) ListDeliveryAttempts(ctx context.Context, req *notificationjobv1.ListDeliveryAttemptsRequest) (*notificationjobv1.ListDeliveryAttemptsResponse, error) {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return nil, err
	}
	if state := strings.TrimSpace(req.GetStatus()); state != "" && state != "failed" && state != "delivered" {
		return nil, status.Error(codes.InvalidArgument, "invalid_delivery_status")
	}
	rows, err := s.repo.ListDeliveryAttempts(ctx, req.GetStatus(), req.GetLimit())
	if err != nil {
		return nil, err
	}
	response := &notificationjobv1.ListDeliveryAttemptsResponse{Attempts: make([]*notificationjobv1.DeliveryAttempt, 0, len(rows))}
	for _, row := range rows {
		response.Attempts = append(response.Attempts, deliveryAttemptReply(row))
	}
	return response, nil
}

func (s *DeliveryOperationsService) RetryDelivery(ctx context.Context, req *notificationjobv1.RetryDeliveryRequest) (*notificationjobv1.RetryDeliveryResponse, error) {
	if err := s.requireActor(ctx, req.GetActorId()); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetDeliveryAttemptId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "delivery_attempt_id_required")
	}
	if strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, status.Error(codes.InvalidArgument, "idempotency_key_required")
	}
	attempt, raw, completed, err := s.repo.BeginDeliveryRetry(ctx, req.GetDeliveryAttemptId(), req.GetActorId(), req.GetIdempotencyKey())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, status.Error(codes.NotFound, "delivery_attempt_not_found")
	}
	if err != nil {
		return nil, err
	}
	if completed {
		return &notificationjobv1.RetryDeliveryResponse{EventId: attempt.EventID, NotificationId: attempt.NotificationID, Status: "replayed"}, nil
	}
	if err := s.svc.Retry(ctx, raw); err != nil {
		_ = s.repo.FinishDeliveryRetry(ctx, req.GetIdempotencyKey(), "failed", err)
		return nil, err
	}
	if err := s.repo.FinishDeliveryRetry(ctx, req.GetIdempotencyKey(), "completed", nil); err != nil {
		return nil, err
	}
	return &notificationjobv1.RetryDeliveryResponse{EventId: attempt.EventID, NotificationId: attempt.NotificationID, Status: "replayed"}, nil
}

func (s *DeliveryOperationsService) requireActor(ctx context.Context, actorID string) error {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return err
	}
	if strings.TrimSpace(actorID) == "" {
		return status.Error(codes.InvalidArgument, "actor_id_required")
	}
	return platform.RequireUserIdentity(ctx, actorID)
}

func deliveryAttemptReply(value notificationdata.DeliveryAttemptRow) *notificationjobv1.DeliveryAttempt {
	return &notificationjobv1.DeliveryAttempt{
		Id: value.ID, EventId: value.EventID, NotificationId: value.NotificationID, UserId: value.UserID,
		Channel: value.Channel, Status: value.Status, Failure: value.Failure, AttemptedAt: value.AttemptedAt,
	}
}
