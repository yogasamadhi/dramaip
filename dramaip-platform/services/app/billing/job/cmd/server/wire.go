//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/service"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/go-kratos/kratos/v3/transport"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		biz.NewOutboxUsecase,
		service.NewOutboxService,
		server.NewHTTPServer,
		server.NewJobServer,
		wire.Bind(new(transport.Server), new(*server.JobServer)),
		newApp,
	))
}
