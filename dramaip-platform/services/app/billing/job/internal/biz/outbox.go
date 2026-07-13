package biz

import (
	"context"
	"fmt"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
)

type OutboxUsecase struct {
	data                  *data.Data
	batch                 int
	lease                 time.Duration
	retry                 time.Duration
	reconciliationEnabled bool
	reconciliationBatch   int
	reconciliationEvery   time.Duration
}

func NewOutboxUsecase(data *data.Data, cfg *conf.Bootstrap) (*OutboxUsecase, error) {
	lease, err := time.ParseDuration(cfg.Job.OutboxLease)
	if err != nil || lease <= 0 {
		return nil, fmt.Errorf("invalid outbox lease %q", cfg.Job.OutboxLease)
	}
	retry, err := time.ParseDuration(cfg.Job.OutboxRetryDelay)
	if err != nil || retry < 0 {
		return nil, fmt.Errorf("invalid outbox retry delay %q", cfg.Job.OutboxRetryDelay)
	}
	reconciliationEvery, err := time.ParseDuration(cfg.Job.ReconciliationInterval)
	if err != nil || reconciliationEvery <= 0 {
		return nil, fmt.Errorf("invalid reconciliation interval %q", cfg.Job.ReconciliationInterval)
	}
	if cfg.Job.ReconciliationBatchSize <= 0 {
		return nil, fmt.Errorf("invalid reconciliation batch size %d", cfg.Job.ReconciliationBatchSize)
	}
	return &OutboxUsecase{data: data, batch: cfg.Job.OutboxBatchSize, lease: lease, retry: retry, reconciliationEnabled: cfg.Job.ReconciliationEnabled, reconciliationBatch: cfg.Job.ReconciliationBatchSize, reconciliationEvery: reconciliationEvery}, nil
}

func (u *OutboxUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *OutboxUsecase) Relay(ctx context.Context) error {
	return u.data.Relay(ctx, u.batch, u.lease, u.retry)
}

func (u *OutboxUsecase) PendingOutbox(ctx context.Context) (int64, error) {
	return u.data.PendingOutbox(ctx)
}

func (u *OutboxUsecase) RetryQuotaProvisioning(ctx context.Context) error {
	return u.data.RetryQuotaProvisioning(ctx, u.batch)
}

func (u *OutboxUsecase) ProcessSubscriptionLifecycle(ctx context.Context) error {
	return u.data.ProcessSubscriptionLifecycle(ctx, u.batch)
}

func (u *OutboxUsecase) Reconcile(ctx context.Context, trigger, requestedBy string) (data.ReconciliationRun, error) {
	return u.data.Reconcile(ctx, trigger, requestedBy, u.reconciliationBatch)
}

func (u *OutboxUsecase) ReconciliationInterval() time.Duration { return u.reconciliationEvery }

func (u *OutboxUsecase) ReconciliationEnabled() bool { return u.reconciliationEnabled }

func (u *OutboxUsecase) LatestReconciliationRun(ctx context.Context) (data.ReconciliationRun, error) {
	return u.data.LatestReconciliationRun(ctx)
}

func (u *OutboxUsecase) ListReconciliationItems(ctx context.Context, state string, limit int) ([]data.ReconciliationItem, error) {
	return u.data.ListReconciliationItems(ctx, state, limit)
}

func (u *OutboxUsecase) ApplyReconciliationAction(ctx context.Context, itemID string, input data.ReconciliationActionInput) (data.ReconciliationAction, error) {
	return u.data.ApplyReconciliationAction(ctx, itemID, input)
}
