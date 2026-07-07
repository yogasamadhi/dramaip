package server

import (
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	quotabiz "github.com/dramaip/dramaip-platform/services/app/quota/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/conf"
	quotasvc "github.com/dramaip/dramaip-platform/services/app/quota/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *quotabiz.QuotaUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("quota-service")),
	)
	kratosx.RegisterHealth(server, "quota-service", uc.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *quotasvc.QuotaService) *kgrpc.Server {
	server := kgrpc.NewServer(
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("quota-service")),
	)
	quotav1.RegisterQuotaServiceServer(server.Server, svc)
	return server
}
