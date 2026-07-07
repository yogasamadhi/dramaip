//go:build wireinject

package main

import (
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"

	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/service"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		data.NewUserRepo,
		biz.NewUserUsecase,
		service.NewUserService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
