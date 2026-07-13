//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/notification/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	jobdata "github.com/dramaip/dramaip-platform/services/app/notification/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		data.NewNotificationRepo,
		jobdata.NewConsumerData,
		biz.NewDeliveryChannels,
		biz.NewNotificationEventUsecase,
		service.NewConsumerService,
		server.NewHTTPServer,
		server.NewJobServer,
		newApp,
	))
}
