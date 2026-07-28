package server

import (
	"fmt"

	reviewv1 "github.com/dramaip/dramaip-platform/services/api/review/service/v1"
	reviewbiz "github.com/dramaip/dramaip-platform/services/app/review/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/conf"
	reviewsvc "github.com/dramaip/dramaip-platform/services/app/review/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, usecase *reviewbiz.ReviewUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("review-service")),
	)
	kratosx.RegisterHealth(server, "review-service", usecase.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, service *reviewsvc.ReviewService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(
			recovery.Recovery(),
			platform.GRPCPeerAuthorization(cfg.MTLS, "desktop-bff", "web-bff", "admin-bff"),
			platform.GRPCUserIdentityPropagation(cfg.MTLS),
			kratosx.TraceMiddleware("review-service"),
		),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("review gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	reviewv1.RegisterReviewServiceServer(server.Server, service)
	return server
}
