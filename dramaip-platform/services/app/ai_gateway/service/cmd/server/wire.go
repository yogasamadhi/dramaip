//go:build wireinject

package main

import (
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/google/wire"

	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/service"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(
		conf.Load,
		data.NewData,
		biz.NewAiGatewayUsecase,
		service.NewAiGatewayService,
		server.NewHTTPServer,
		server.NewGRPCServer,
		newApp,
	))
}
