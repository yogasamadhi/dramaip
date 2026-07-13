package biz

import (
	"context"
	"strings"

	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type ReportingClient interface {
	GetOverview(context.Context, *reportingv1.GetOverviewRequest, ...grpc.CallOption) (*reportingv1.GetOverviewResponse, error)
	ListUsers(context.Context, *reportingv1.ListUsersRequest, ...grpc.CallOption) (*reportingv1.ListUsersResponse, error)
	ListOrders(context.Context, *reportingv1.ListOrdersRequest, ...grpc.CallOption) (*reportingv1.ListOrdersResponse, error)
	ListSubscriptions(context.Context, *reportingv1.ListSubscriptionsRequest, ...grpc.CallOption) (*reportingv1.ListSubscriptionsResponse, error)
	ListExceptions(context.Context, *reportingv1.ListExceptionsRequest, ...grpc.CallOption) (*reportingv1.ListExceptionsResponse, error)
	ResolveException(context.Context, *reportingv1.ResolveExceptionRequest, ...grpc.CallOption) (*reportingv1.ResolveExceptionResponse, error)
}

type ReportingUsecase struct{ client ReportingClient }

func NewReportingUsecase(client ReportingClient) *ReportingUsecase {
	return &ReportingUsecase{client: client}
}

func (u *ReportingUsecase) Overview(ctx context.Context, actor Principal) (*reportingv1.GetOverviewResponse, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.client.GetOverview(ctx, &reportingv1.GetOverviewRequest{})
}
func (u *ReportingUsecase) Users(ctx context.Context, actor Principal, limit int) (*reportingv1.ListUsersResponse, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.client.ListUsers(ctx, &reportingv1.ListUsersRequest{Limit: int32(limit)})
}
func (u *ReportingUsecase) Orders(ctx context.Context, actor Principal, limit int) (*reportingv1.ListOrdersResponse, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.client.ListOrders(ctx, &reportingv1.ListOrdersRequest{Limit: int32(limit)})
}
func (u *ReportingUsecase) Subscriptions(ctx context.Context, actor Principal, limit int) (*reportingv1.ListSubscriptionsResponse, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.client.ListSubscriptions(ctx, &reportingv1.ListSubscriptionsRequest{Limit: int32(limit)})
}
func (u *ReportingUsecase) Exceptions(ctx context.Context, actor Principal, limit int, includeResolved bool) (*reportingv1.ListExceptionsResponse, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.client.ListExceptions(ctx, &reportingv1.ListExceptionsRequest{Limit: int32(limit), IncludeResolved: includeResolved})
}
func (u *ReportingUsecase) ResolveException(ctx context.Context, actor Principal, exceptionID, reason string) (*reportingv1.ResolveExceptionResponse, error) {
	if !actor.Allows("reporting.write") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	traceID := platform.TraceID(ctx)
	if traceID == "" {
		traceID = platform.RequestID(ctx)
	}
	return u.client.ResolveException(ctx, &reportingv1.ResolveExceptionRequest{ExceptionId: strings.TrimSpace(exceptionID), ActorId: actor.ID, Reason: strings.TrimSpace(reason), TraceId: traceID})
}
