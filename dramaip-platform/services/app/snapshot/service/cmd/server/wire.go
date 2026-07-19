//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/snapshot/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/service"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, data.NewData, data.NewProjectSnapshotRepo, biz.NewProjectSnapshotUsecase, biz.NewProjectSnapshotRetention, service.NewSnapshotService, server.NewHTTPServer, server.NewGRPCServer, newApp))
}
