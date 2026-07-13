package server

import (
	"fmt"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	userbiz "github.com/dramaip/dramaip-platform/services/app/user/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/conf"
	usersvc "github.com/dramaip/dramaip-platform/services/app/user/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *userbiz.UserUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("user-service")),
	)
	kratosx.RegisterHealth(server, "user-service", uc.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *usersvc.UserService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("user-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("user gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	userv1.RegisterUserServiceServer(server.Server, svc)
	return server
}
