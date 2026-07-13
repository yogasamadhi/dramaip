package service

import (
	"context"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
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
		cycleCtx, span := platform.Tracer("quota-job").Start(ctx, "quota.period_account.maintenance")
		if err := s.uc.Maintain(cycleCtx); err != nil {
			span.RecordError(err)
			platform.StructuredLog(cycleCtx, "quota-job", "error", "quota_maintenance_failed", map[string]any{"error": err})
		} else {
			platform.StructuredLog(cycleCtx, "quota-job", "info", "quota_maintenance_completed", nil)
		}
		span.End()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
