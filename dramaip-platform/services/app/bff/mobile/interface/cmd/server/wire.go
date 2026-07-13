//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, biz.NewBFFUsecase, service.NewHTTPService, server.NewHTTPServer, newApp))
}
