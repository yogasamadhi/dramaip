//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/service"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, data.NewAdminRepo, biz.NewAdminUsecase, service.NewHTTPService, server.NewHTTPServer, newApp))
}
