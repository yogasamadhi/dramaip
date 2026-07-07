package server

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/conf"
	quotasvc "github.com/dramaip/dramaip-platform/services/app/quota/job/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

type JobServer struct {
	svc    *quotasvc.MaintenanceService
	cancel context.CancelFunc
}

func NewJobServer(svc *quotasvc.MaintenanceService) *JobServer {
	return &JobServer{svc: svc}
}

func (s *JobServer) Start(ctx context.Context) error {
	jobCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	return s.svc.Run(jobCtx)
}

func (s *JobServer) Stop(context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func NewHTTPServer(cfg *conf.Bootstrap, svc *quotasvc.MaintenanceService) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("quota-job")),
	)
	kratosx.RegisterHealth(server, "quota-job", svc.Checks())
	return server
}
