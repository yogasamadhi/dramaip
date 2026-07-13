package server

import (
	"fmt"
	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/conf"
	aisvc "github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewGRPCServer(cfg *conf.Bootstrap, svc *aisvc.AiGatewayService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff", "desktop-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("ai-gateway-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("ai gateway gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	aiv1.RegisterAiGatewayServiceServer(server.Server, svc)
	return server
}

func NewHTTPServer(cfg *conf.Bootstrap, uc *biz.AiGatewayUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("ai-gateway-service")),
	)
	kratosx.RegisterHealth(server, "ai-gateway-service", uc.Checks())
	return server
}
