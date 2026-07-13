package data

import (
	"context"
	"time"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
)

type AuthClient interface {
	ExchangeDesktopAuthorizationCode(context.Context, *authv1.ExchangeDesktopAuthorizationCodeRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
	Refresh(context.Context, *authv1.RefreshRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
	Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error)
	ValidateAccessToken(context.Context, *authv1.ValidateAccessTokenRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
}

type BillingClient interface {
	GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error)
}

type QuotaClient interface {
	GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error)
}

type Data struct {
	Auth    AuthClient
	Billing BillingClient
	Quota   QuotaClient
	conns   []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	authConn, err := platform.DialGRPC(ctx, cfg.Downstream.AuthEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	billingConn, err := platform.DialGRPC(ctx, cfg.Downstream.BillingEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		return nil, nil, err
	}
	quotaConn, err := platform.DialGRPC(ctx, cfg.Downstream.QuotaEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		return nil, nil, err
	}
	d := &Data{
		Auth: authv1.NewAuthServiceClient(authConn), Billing: billingv1.NewBillingServiceClient(billingConn), Quota: quotav1.NewQuotaServiceClient(quotaConn),
		conns: []*grpc.ClientConn{authConn, billingConn, quotaConn},
	}
	return d, d.Close, nil
}

func (d *Data) Close() {
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}
