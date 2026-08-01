//go:build wireinject

package main

import (
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/google/wire"

	"github.com/dramaip/dramaip-platform/services/app/notification/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/service"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		data.NewNotificationRepo,
		biz.NewNotificationUsecase,
		service.NewNotificationService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
