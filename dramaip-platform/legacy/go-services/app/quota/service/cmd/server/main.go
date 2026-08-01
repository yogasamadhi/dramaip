package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v3"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init quota service: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("quota service stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server, grpcServer *kgrpc.Server) *kratos.App {
	return kratosx.NewApp("quota-service", httpServer, grpcServer)
}
