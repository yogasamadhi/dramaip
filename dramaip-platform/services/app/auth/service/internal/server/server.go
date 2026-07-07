package server

import (
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	authbiz "github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	authsvc "github.com/dramaip/dramaip-platform/services/app/auth/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewGRPCServer(cfg *conf.Bootstrap, svc *authsvc.AuthService) *kgrpc.Server {
	server := kgrpc.NewServer(
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("auth-service")),
	)
	authv1.RegisterAuthServiceServer(server.Server, svc)
	return server
}

func NewHTTPServer(cfg *conf.Bootstrap, uc *authbiz.AuthUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("auth-service")),
	)
	kratosx.RegisterHealth(server, "auth-service", uc.Checks())
	return server
}
