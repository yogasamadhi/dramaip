package server

import (
	"fmt"

	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/reporting/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/reporting/service/internal/conf"
	reportingsvc "github.com/dramaip/dramaip-platform/services/app/reporting/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, repo *data.ReportingRepo) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("reporting-service")))
	kratosx.RegisterHealth(server, "reporting-service", repo.Checks())
	return server
}
func NewGRPCServer(cfg *conf.Bootstrap, svc *reportingsvc.ReportingService) *kgrpc.Server {
	options := []kgrpc.ServerOption{kgrpc.Address(cfg.Server.GRPC.Addr), kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "admin-bff"), kratosx.TraceMiddleware("reporting-service"))}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("reporting gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	reportingv1.RegisterReportingServiceServer(server.Server, svc)
	return server
}
