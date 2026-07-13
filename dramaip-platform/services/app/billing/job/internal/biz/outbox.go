package biz

import (
	"context"
	"fmt"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
)

type OutboxUsecase struct {
	data  *data.Data
	batch int
	lease time.Duration
	retry time.Duration
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
	return &OutboxUsecase{data: data, batch: cfg.Job.OutboxBatchSize, lease: lease, retry: retry}, nil
}

func (u *OutboxUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *OutboxUsecase) Relay(ctx context.Context) error {
	return u.data.Relay(ctx, u.batch, u.lease, u.retry)
}

func (u *OutboxUsecase) RetryQuotaProvisioning(ctx context.Context) error {
	return u.data.RetryQuotaProvisioning(ctx, u.batch)
}
