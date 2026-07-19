package main

import (
	"log"

	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	kratos "github.com/go-kratos/kratos/v3"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init snapshot service: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("snapshot service stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server, grpcServer *kgrpc.Server, retention *biz.ProjectSnapshotRetention) *kratos.App {
	retention.Start()
	return kratosx.NewApp("snapshot-service", httpServer, grpcServer)
}
