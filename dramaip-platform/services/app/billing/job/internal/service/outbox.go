package service

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type OutboxService struct {
	uc                     *biz.OutboxUsecase
	interval               time.Duration
	operationTimeout       time.Duration
	reconciliationEnabled  bool
	reconciliationInterval time.Duration
	reconciliationRuns     uint64
	reconciliationItems    uint64
	reconciliationFailures uint64
}

func NewOutboxService(uc *biz.OutboxUsecase, cfg *conf.Bootstrap) *OutboxService {
	return &OutboxService{uc: uc, interval: kratosx.Duration(cfg.Job.OutboxRelayInterval, time.Second), operationTimeout: kratosx.Duration(cfg.Job.OperationTimeout, 30*time.Second), reconciliationEnabled: uc.ReconciliationEnabled(), reconciliationInterval: uc.ReconciliationInterval()}
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
	s.runOperation(ctx, "billing.outbox.relay", s.uc.Relay)
	s.runOperation(ctx, "billing.quota_provisioning.retry", s.uc.RetryQuotaProvisioning)
	s.runOperation(ctx, "billing.subscription.lifecycle", s.uc.ProcessSubscriptionLifecycle)
	if pending, err := s.uc.PendingOutbox(ctx); err != nil {
		platform.ReportError(ctx, "billing.outbox.pending", err)
		platform.StructuredLog(ctx, "billing-job", "error", "outbox_backlog_metric_failed", map[string]any{"error": err})
	} else {
		platform.SetOutboxPending(pending)
	}
}

func (s *OutboxService) runReconciliation(ctx context.Context, trigger, requestedBy string) (data.ReconciliationRun, error) {
	ctx, cancel := platform.WithDefaultDeadline(ctx, s.operationTimeout)
	defer cancel()
	ctx, span := platform.Tracer("billing-job").Start(ctx, "billing.reconciliation")
	defer span.End()
	run, err := s.uc.Reconcile(ctx, trigger, requestedBy)
	if err != nil {
		span.RecordError(err)
		atomic.AddUint64(&s.reconciliationFailures, 1)
		platform.StructuredLog(ctx, "billing-job", "error", "billing_reconciliation_failed", map[string]any{"trigger": trigger, "error": err})
		return run, err
	}
	if run.Status == "completed" {
		atomic.AddUint64(&s.reconciliationRuns, 1)
		atomic.AddUint64(&s.reconciliationItems, uint64(run.DetectedItems))
	}
	return run, nil
}

func (s *OutboxService) runOperation(ctx context.Context, operation string, fn func(context.Context) error) {
	ctx, cancel := platform.WithDefaultDeadline(ctx, s.operationTimeout)
	defer cancel()
	ctx, span := platform.Tracer("billing-job").Start(ctx, operation)
	defer span.End()
	if err := fn(ctx); err != nil {
		span.RecordError(err)
		platform.StructuredLog(ctx, "billing-job", "error", "job_operation_failed", map[string]any{"job_operation": operation, "error": err})
	}
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
