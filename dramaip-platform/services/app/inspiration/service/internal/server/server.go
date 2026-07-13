package server

import (
	"fmt"

	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
	inspirationbiz "github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/conf"
	inspirationsvc "github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *inspirationbiz.MobileDraftUsecase) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("inspiration-service")))
	kratosx.RegisterHealth(server, "inspiration-service", uc.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *inspirationsvc.InspirationService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "mobile-bff", "desktop-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("inspiration-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("inspiration gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	inspirationv1.RegisterInspirationServiceServer(server.Server, svc)
	return server
}
