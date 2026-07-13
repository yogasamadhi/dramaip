//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/inspiration/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, data.NewMobileDraftRepo, biz.NewMobileDraftUsecase, service.NewInspirationService, server.NewHTTPServer, server.NewGRPCServer, newApp))
}
