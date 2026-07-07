package biz

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
)

type OutboxUsecase struct {
	data  *data.Data
	batch int
}

func NewOutboxUsecase(data *data.Data, cfg *conf.Bootstrap) *OutboxUsecase {
	return &OutboxUsecase{data: data, batch: cfg.Job.OutboxBatchSize}
}

func (u *OutboxUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *OutboxUsecase) Relay(ctx context.Context) error {
	return u.data.Relay(ctx, u.batch)
}

func (u *OutboxUsecase) RetryQuotaProvisioning(ctx context.Context) error {
	return u.data.RetryQuotaProvisioning(ctx, u.batch)
}
