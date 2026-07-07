//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		biz.NewMigrationUsecase,
		service.NewMigrationService,
		server.NewJobServer,
		newApp,
	))
}
