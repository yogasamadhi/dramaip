//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, biz.NewBFFUsecase, service.NewHTTPService, server.NewHTTPServer, newApp))
}
