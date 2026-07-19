package server

import (
	"fmt"

	snapshotv1 "github.com/dramaip/dramaip-platform/services/api/snapshot/service/v1"
	snapshotbiz "github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/conf"
	snapshotsvc "github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, uc *snapshotbiz.ProjectSnapshotUsecase) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("snapshot-service")))
	kratosx.RegisterHealth(server, "snapshot-service", uc.Checks())
	return server
}

func NewGRPCServer(cfg *conf.Bootstrap, svc *snapshotsvc.SnapshotService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "desktop-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("snapshot-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("snapshot gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	snapshotv1.RegisterSnapshotServiceServer(server.Server, svc)
	return server
}
