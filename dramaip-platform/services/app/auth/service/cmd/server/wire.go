//go:build wireinject

package main

import (
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/service"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		data.NewAuthRepo,
		biz.NewAuthUsecase,
		service.NewAuthService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
