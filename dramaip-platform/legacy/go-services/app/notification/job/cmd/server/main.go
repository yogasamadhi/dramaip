package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v3"
	"github.com/go-kratos/kratos/v3/transport"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init notification job: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("notification job stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server, grpcServer *kgrpc.Server, job transport.Server) *kratos.App {
	return kratosx.NewApp("notification-job", httpServer, grpcServer, job)
}
