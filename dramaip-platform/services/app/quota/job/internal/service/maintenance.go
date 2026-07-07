package service

import (
	"context"
	"log"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

type MaintenanceService struct {
	uc       *biz.MaintenanceUsecase
	interval time.Duration
}

func NewMaintenanceService(uc *biz.MaintenanceUsecase, cfg *conf.Bootstrap) *MaintenanceService {
	return &MaintenanceService{uc: uc, interval: kratosx.Duration(cfg.Job.TickInterval, time.Minute)}
}

func (s *MaintenanceService) Checks() map[string]func(context.Context) error {
	return s.uc.Checks()
}

func (s *MaintenanceService) Run(ctx context.Context) error {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		if err := s.uc.Maintain(ctx); err != nil {
			log.Printf("quota maintenance failed: %v", err)
		} else {
			log.Printf("quota-job heartbeat: period account maintenance not due")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
