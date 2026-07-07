package server

import (
	"context"

	migrationsvc "github.com/dramaip/dramaip-platform/services/app/migration/job/internal/service"
)

type JobServer struct {
	svc *migrationsvc.MigrationService
}

func NewJobServer(svc *migrationsvc.MigrationService) *JobServer {
	return &JobServer{svc: svc}
}

func (s *JobServer) Start(ctx context.Context) error {
	if err := s.svc.Run(ctx); err != nil {
		return err
	}
	return context.Canceled
}

func (s *JobServer) Stop(context.Context) error {
	return nil
}
