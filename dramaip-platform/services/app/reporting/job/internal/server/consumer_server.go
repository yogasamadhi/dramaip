package server

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/conf"
	reportingsvc "github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

type JobServer struct {
	svc    *reportingsvc.ConsumerService
	cancel context.CancelFunc
}

func NewJobServer(svc *reportingsvc.ConsumerService) *JobServer { return &JobServer{svc: svc} }
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
func NewHTTPServer(cfg *conf.Bootstrap, svc *reportingsvc.ConsumerService) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("reporting-job")))
	kratosx.RegisterHealth(server, "reporting-job", svc.Checks())
	return server
}
