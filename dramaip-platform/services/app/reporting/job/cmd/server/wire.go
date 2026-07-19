//go:build wireinject

package main

import (
	reportingdata "github.com/dramaip/dramaip-platform/services/app/reporting/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/conf"
	jobdata "github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/server"
	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/service"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/google/wire"
)

func wireApp() (*kratos.App, func(), error) {
	panic(wire.Build(conf.Load, reportingdata.NewData, reportingdata.NewReportingRepo, jobdata.NewConsumerData, biz.NewReportingEventUsecase, service.NewConsumerService, server.NewHTTPServer, server.NewJobServer, newApp))
}
