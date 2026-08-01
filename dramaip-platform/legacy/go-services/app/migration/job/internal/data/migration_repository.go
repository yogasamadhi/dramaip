package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct {
	DB            *gorm.DB
	MigrationsDir string
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db, MigrationsDir: cfg.Data.MigrationsDir}, func() {}, nil
}

func (d *Data) Run(context.Context) error {
	return platform.RunMigrations(d.DB, d.MigrationsDir)
}
