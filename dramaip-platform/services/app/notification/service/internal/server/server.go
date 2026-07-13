package server

import (
	"fmt"

	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	notificationbiz "github.com/dramaip/dramaip-platform/services/app/notification/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/conf"
	notificationsvc "github.com/dramaip/dramaip-platform/services/app/notification/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *notificationbiz.NotificationUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("notification-service")),
	)
	kratosx.RegisterHealth(server, "notification-service", uc.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *notificationsvc.NotificationService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("notification-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("notification gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	notificationv1.RegisterNotificationServiceServer(server.Server, svc)
	return server
}
