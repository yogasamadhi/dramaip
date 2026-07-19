//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/service"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		biz.NewMaintenanceUsecase,
		service.NewMaintenanceService,
		server.NewHTTPServer,
		server.NewJobServer,
		newApp,
	))
}
