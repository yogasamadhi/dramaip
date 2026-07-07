package biz

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/data"
)

type MaintenanceUsecase struct {
	data *data.Data
}

func NewMaintenanceUsecase(data *data.Data) *MaintenanceUsecase {
	return &MaintenanceUsecase{data: data}
}

func (u *MaintenanceUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *MaintenanceUsecase) Maintain(ctx context.Context) error {
	return u.data.Maintain(ctx)
}
