package service

import (
	"context"
	"errors"

	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/reporting/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type ReportingService struct {
	reportingv1.UnimplementedReportingServiceServer
	repo *data.ReportingRepo
}

func NewReportingService(repo *data.ReportingRepo) *ReportingService {
	return &ReportingService{repo: repo}
}

func (s *ReportingService) GetOverview(ctx context.Context, _ *reportingv1.GetOverviewRequest) (*reportingv1.GetOverviewResponse, error) {
	row, err := s.repo.Overview(ctx)
	if err != nil {
		return nil, err
	}
	return &reportingv1.GetOverviewResponse{UserCount: row.UserCount, PaidOrderCount: row.PaidOrderCount, ActiveSubscriptionCount: row.ActiveSubscriptionCount, TotalTokens: row.TotalTokens, OpenExceptionCount: row.OpenExceptionCount, LastEventAt: row.LastEventAt}, nil
}
func (s *ReportingService) ListUsers(ctx context.Context, req *reportingv1.ListUsersRequest) (*reportingv1.ListUsersResponse, error) {
	rows, err := s.repo.ListUsers(ctx, int(req.GetLimit()))
	if err != nil {
		return nil, err
	}
	out := &reportingv1.ListUsersResponse{Users: make([]*reportingv1.UserSummary, 0, len(rows))}
	for _, row := range rows {
		out.Users = append(out.Users, &reportingv1.UserSummary{UserId: row.UserID, FirstSeenAt: row.FirstSeenAt, LastSeenAt: row.LastSeenAt, TotalTokens: row.TotalTokens, LastPlanCode: row.LastPlanCode})
	}
	return out, nil
}
func (s *ReportingService) ListOrders(ctx context.Context, req *reportingv1.ListOrdersRequest) (*reportingv1.ListOrdersResponse, error) {
	rows, err := s.repo.ListOrders(ctx, int(req.GetLimit()))
	if err != nil {
		return nil, err
	}
	out := &reportingv1.ListOrdersResponse{Orders: make([]*reportingv1.OrderSummary, 0, len(rows))}
	for _, row := range rows {
		out.Orders = append(out.Orders, &reportingv1.OrderSummary{OrderId: row.OrderID, UserId: row.UserID, PlanCode: row.PlanCode, Provider: row.Provider, Amount: row.Amount, Currency: row.Currency, Status: row.Status, SubscriptionId: row.SubscriptionID, UpdatedAt: row.UpdatedAt})
	}
	return out, nil
}
func (s *ReportingService) ListSubscriptions(ctx context.Context, req *reportingv1.ListSubscriptionsRequest) (*reportingv1.ListSubscriptionsResponse, error) {
	rows, err := s.repo.ListSubscriptions(ctx, int(req.GetLimit()))
	if err != nil {
		return nil, err
	}
	out := &reportingv1.ListSubscriptionsResponse{Subscriptions: make([]*reportingv1.SubscriptionSummary, 0, len(rows))}
	for _, row := range rows {
		out.Subscriptions = append(out.Subscriptions, &reportingv1.SubscriptionSummary{SubscriptionId: row.SubscriptionID, UserId: row.UserID, PlanCode: row.PlanCode, Status: row.Status, PeriodStart: row.PeriodStart, PeriodEnd: row.PeriodEnd, UpdatedAt: row.UpdatedAt})
	}
	return out, nil
}
func (s *ReportingService) ListExceptions(ctx context.Context, req *reportingv1.ListExceptionsRequest) (*reportingv1.ListExceptionsResponse, error) {
	rows, err := s.repo.ListExceptions(ctx, int(req.GetLimit()), req.GetIncludeResolved())
	if err != nil {
		return nil, err
	}
	out := &reportingv1.ListExceptionsResponse{Exceptions: make([]*reportingv1.ProjectionException, 0, len(rows))}
	for _, row := range rows {
		out.Exceptions = append(out.Exceptions, exceptionReply(row))
	}
	return out, nil
}
func (s *ReportingService) ResolveException(ctx context.Context, req *reportingv1.ResolveExceptionRequest) (*reportingv1.ResolveExceptionResponse, error) {
	row, err := s.repo.ResolveException(ctx, req.GetExceptionId(), req.GetActorId(), req.GetReason())
	if errors.Is(err, data.ErrExceptionNotOpen) {
		return nil, status.Error(codes.FailedPrecondition, "reporting_exception_not_open")
	}
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid_reporting_exception_resolution")
	}
	return &reportingv1.ResolveExceptionResponse{Exception: exceptionReply(row)}, nil
}
func exceptionReply(row data.ProjectionException) *reportingv1.ProjectionException {
	return &reportingv1.ProjectionException{Id: row.ID, EventId: row.EventID, EventType: row.EventType, Status: row.Status, Summary: row.Summary, TraceId: row.TraceID, CreatedAt: row.CreatedAt, ResolvedAt: row.ResolvedAt, ResolvedBy: row.ResolvedBy, ResolutionReason: row.ResolutionReason}
}
