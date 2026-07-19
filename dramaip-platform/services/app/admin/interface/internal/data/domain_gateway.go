package data

import (
	"context"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingjobv1 "github.com/dramaip/dramaip-platform/services/api/billing/job/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationjobv1 "github.com/dramaip/dramaip-platform/services/api/notification/job/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
)

// DomainGateway is deliberately a thin, mTLS-only adapter. It holds no
// database handle and cannot bypass the owning Auth/User/Billing/Quota/
// Notification/AI services.
type DomainGateway struct {
	Auth            authv1.AuthServiceClient
	User            userv1.UserServiceClient
	Billing         billingv1.BillingServiceClient
	Quota           quotav1.QuotaServiceClient
	Notification    notificationv1.NotificationServiceClient
	BillingJob      billingjobv1.ReconciliationOperationsServiceClient
	NotificationJob notificationjobv1.NotificationDeliveryOperationsServiceClient
	AI              aiv1.AiGatewayServiceClient
	conns           []*grpc.ClientConn
}

func NewDomainGateway(cfg *conf.Bootstrap) (*DomainGateway, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	endpoints := []string{cfg.Downstream.AuthEndpoint, cfg.Downstream.UserEndpoint, cfg.Downstream.BillingEndpoint, cfg.Downstream.QuotaEndpoint, cfg.Downstream.NotificationEndpoint, cfg.Downstream.AIGatewayEndpoint, cfg.Downstream.BillingJobEndpoint, cfg.Downstream.NotificationJobEndpoint}
	conns := make([]*grpc.ClientConn, 0, len(endpoints))
	for _, endpoint := range endpoints {
		conn, err := platform.DialGRPC(ctx, endpoint, cfg.MTLS)
		if err != nil {
			for _, existing := range conns {
				_ = existing.Close()
			}
			return nil, nil, err
		}
		conns = append(conns, conn)
	}
	gateway := &DomainGateway{
		Auth: authv1.NewAuthServiceClient(conns[0]), User: userv1.NewUserServiceClient(conns[1]),
		Billing: billingv1.NewBillingServiceClient(conns[2]), Quota: quotav1.NewQuotaServiceClient(conns[3]),
		Notification: notificationv1.NewNotificationServiceClient(conns[4]), AI: aiv1.NewAiGatewayServiceClient(conns[5]),
		BillingJob: billingjobv1.NewReconciliationOperationsServiceClient(conns[6]), NotificationJob: notificationjobv1.NewNotificationDeliveryOperationsServiceClient(conns[7]), conns: conns,
	}
	return gateway, gateway.Close, nil
}

func (g *DomainGateway) Close() {
	for _, conn := range g.conns {
		_ = conn.Close()
	}
}
