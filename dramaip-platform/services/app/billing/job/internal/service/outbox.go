package service

import (
	"context"
	"log"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

type OutboxService struct {
	uc       *biz.OutboxUsecase
	interval time.Duration
}

func NewOutboxService(uc *biz.OutboxUsecase, cfg *conf.Bootstrap) *OutboxService {
	return &OutboxService{uc: uc, interval: kratosx.Duration(cfg.Job.OutboxRelayInterval, time.Second)}
}

func (s *OutboxService) Checks() map[string]func(context.Context) error {
	return s.uc.Checks()
}

func (s *OutboxService) Run(ctx context.Context) error {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		if err := s.uc.Relay(ctx); err != nil {
			log.Printf("outbox relay failed: %v", err)
		}
		if err := s.uc.RetryQuotaProvisioning(ctx); err != nil {
			log.Printf("quota provisioning retry failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
