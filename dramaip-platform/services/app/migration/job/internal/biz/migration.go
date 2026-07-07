package biz

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/data"
)

type MigrationUsecase struct {
	data *data.Data
}

func NewMigrationUsecase(data *data.Data) *MigrationUsecase {
	return &MigrationUsecase{data: data}
}

func (u *MigrationUsecase) Run(ctx context.Context) error {
	return u.data.Run(ctx)
}
