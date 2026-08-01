package data

import (
	"context"
	"time"

	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
)

// ReportingGateway is the Admin BFF's only reporting integration point. It
// dials the mTLS-protected reporting API and deliberately has no database
// handle, preventing cross-schema queries from the BFF.
type ReportingGateway struct {
	client reportingv1.ReportingServiceClient
	conn   *grpc.ClientConn
}

func NewReportingGateway(cfg *conf.Bootstrap) (*ReportingGateway, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	conn, err := platform.DialGRPC(ctx, cfg.Downstream.ReportingEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	return &ReportingGateway{client: reportingv1.NewReportingServiceClient(conn), conn: conn}, func() { _ = conn.Close() }, nil
}
func (g *ReportingGateway) GetOverview(ctx context.Context, req *reportingv1.GetOverviewRequest, options ...grpc.CallOption) (*reportingv1.GetOverviewResponse, error) {
	return g.client.GetOverview(ctx, req, options...)
}
func (g *ReportingGateway) ListUsers(ctx context.Context, req *reportingv1.ListUsersRequest, options ...grpc.CallOption) (*reportingv1.ListUsersResponse, error) {
	return g.client.ListUsers(ctx, req, options...)
}
func (g *ReportingGateway) ListOrders(ctx context.Context, req *reportingv1.ListOrdersRequest, options ...grpc.CallOption) (*reportingv1.ListOrdersResponse, error) {
	return g.client.ListOrders(ctx, req, options...)
}
func (g *ReportingGateway) ListSubscriptions(ctx context.Context, req *reportingv1.ListSubscriptionsRequest, options ...grpc.CallOption) (*reportingv1.ListSubscriptionsResponse, error) {
	return g.client.ListSubscriptions(ctx, req, options...)
}
func (g *ReportingGateway) ListExceptions(ctx context.Context, req *reportingv1.ListExceptionsRequest, options ...grpc.CallOption) (*reportingv1.ListExceptionsResponse, error) {
	return g.client.ListExceptions(ctx, req, options...)
}
func (g *ReportingGateway) ResolveException(ctx context.Context, req *reportingv1.ResolveExceptionRequest, options ...grpc.CallOption) (*reportingv1.ResolveExceptionResponse, error) {
	return g.client.ResolveException(ctx, req, options...)
}
