package server

import (
	"fmt"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	quotabiz "github.com/dramaip/dramaip-platform/services/app/quota/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/conf"
	quotasvc "github.com/dramaip/dramaip-platform/services/app/quota/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
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
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff", "desktop-bff", "mobile-bff", "billing-service", "ai-gateway-service", "billing-job", "admin-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("quota-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("quota gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	quotav1.RegisterQuotaServiceServer(server.Server, svc)
	return server
}
