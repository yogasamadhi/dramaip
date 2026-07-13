//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/reporting/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/reporting/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/reporting/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/reporting/service/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, data.NewReportingRepo, service.NewReportingService, server.NewHTTPServer, server.NewGRPCServer, newApp))
}
