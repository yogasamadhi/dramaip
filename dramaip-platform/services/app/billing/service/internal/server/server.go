package server

import (
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	billingbiz "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	billingsvc "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
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
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *billingsvc.BillingService) *kgrpc.Server {
	server := kgrpc.NewServer(
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("billing-service")),
	)
	billingv1.RegisterBillingServiceServer(server.Server, svc)
	return server
}
