package server

import (
	"fmt"
	"net/http"

	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	billingbiz "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	billingsvc "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *billingbiz.BillingUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("billing-service")),
	)
	kratosx.RegisterHealth(server, "billing-service", uc.Checks())
	wechatWebhook, err := newWechatWebhook(cfg.Payment.WechatPay, uc)
	if err != nil {
		panic(fmt.Sprintf("billing wechat pay webhook: %v", err))
	}
	alipayWebhook, err := newAlipayWebhook(cfg.Payment.Alipay, uc)
	if err != nil {
		panic(fmt.Sprintf("billing alipay webhook: %v", err))
	}
	server.HandleFunc("/v1/webhooks/wechat-pay", func(w http.ResponseWriter, r *http.Request) {
		wechatWebhook.Handle(w, r)
	})
	server.HandleFunc("/v1/webhooks/alipay", func(w http.ResponseWriter, r *http.Request) {
		alipayWebhook.Handle(w, r)
	})
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *billingsvc.BillingService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("billing-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("billing gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	billingv1.RegisterBillingServiceServer(server.Server, svc)
	return server
}
