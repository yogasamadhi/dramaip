//go:build wireinject

package main

import (
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/service"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewS3CompatibleStore,
		data.NewData,
		data.NewReviewRepo,
		biz.NewReviewUsecase,
		biz.NewReviewRetention,
		service.NewReviewService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
