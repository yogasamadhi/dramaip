package service

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

type OutboxService struct {
	uc                     *biz.OutboxUsecase
	interval               time.Duration
	reconciliationEnabled  bool
	reconciliationInterval time.Duration
	reconciliationRuns     uint64
	reconciliationItems    uint64
	reconciliationFailures uint64
}

func NewOutboxService(uc *biz.OutboxUsecase, cfg *conf.Bootstrap) *OutboxService {
	return &OutboxService{uc: uc, interval: kratosx.Duration(cfg.Job.OutboxRelayInterval, time.Second), reconciliationEnabled: uc.ReconciliationEnabled(), reconciliationInterval: uc.ReconciliationInterval()}
}

func (s *OutboxService) Checks() map[string]func(context.Context) error {
	return s.uc.Checks()
}

func (s *OutboxService) Run(ctx context.Context) error {
	outboxTicker := time.NewTicker(s.interval)
	defer outboxTicker.Stop()
	var reconciliationTicks <-chan time.Time
	var reconciliationTicker *time.Ticker
	if s.reconciliationEnabled {
		reconciliationTicker = time.NewTicker(s.reconciliationInterval)
		defer reconciliationTicker.Stop()
		reconciliationTicks = reconciliationTicker.C
	}
	s.runOutboxCycle(ctx)
	if s.reconciliationEnabled {
		s.runReconciliation(ctx, "scheduled", "billing-job")
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-outboxTicker.C:
			s.runOutboxCycle(ctx)
		case <-reconciliationTicks:
			s.runReconciliation(ctx, "scheduled", "billing-job")
		}
	}
}

func (s *OutboxService) runOutboxCycle(ctx context.Context) {
	if err := s.uc.Relay(ctx); err != nil {
		log.Printf("outbox relay failed: %v", err)
	}
	if err := s.uc.RetryQuotaProvisioning(ctx); err != nil {
		log.Printf("quota provisioning retry failed: %v", err)
	}
	if err := s.uc.ProcessSubscriptionLifecycle(ctx); err != nil {
		log.Printf("subscription lifecycle processing failed: %v", err)
	}
}

func (s *OutboxService) runReconciliation(ctx context.Context, trigger, requestedBy string) (data.ReconciliationRun, error) {
	run, err := s.uc.Reconcile(ctx, trigger, requestedBy)
	if err != nil {
		atomic.AddUint64(&s.reconciliationFailures, 1)
		log.Printf("billing reconciliation failed: %v", err)
		return run, err
	}
	if run.Status == "completed" {
		atomic.AddUint64(&s.reconciliationRuns, 1)
		atomic.AddUint64(&s.reconciliationItems, uint64(run.DetectedItems))
	}
	return run, nil
}

func (s *OutboxService) Reconcile(ctx context.Context, requestedBy string) (data.ReconciliationRun, error) {
	return s.runReconciliation(ctx, "manual", requestedBy)
}

func (s *OutboxService) LatestReconciliationRun(ctx context.Context) (data.ReconciliationRun, error) {
	return s.uc.LatestReconciliationRun(ctx)
}

func (s *OutboxService) ListReconciliationItems(ctx context.Context, state string, limit int) ([]data.ReconciliationItem, error) {
	return s.uc.ListReconciliationItems(ctx, state, limit)
}

func (s *OutboxService) ApplyReconciliationAction(ctx context.Context, itemID string, input data.ReconciliationActionInput) (data.ReconciliationAction, error) {
	return s.uc.ApplyReconciliationAction(ctx, itemID, input)
}

func (s *OutboxService) ReconciliationMetrics() (uint64, uint64, uint64) {
	return atomic.LoadUint64(&s.reconciliationRuns), atomic.LoadUint64(&s.reconciliationItems), atomic.LoadUint64(&s.reconciliationFailures)
}
