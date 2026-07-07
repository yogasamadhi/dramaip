//go:build wireinject

package main

import (
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"

	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/service"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		data.NewQuotaRepo,
		biz.NewQuotaUsecase,
		service.NewQuotaService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
