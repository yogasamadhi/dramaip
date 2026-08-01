package main

import (
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	kratos "github.com/go-kratos/kratos/v3"
	kgrpc "github.com/go-kratos/kratos/v3/transport/grpc"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init inspiration service: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("inspiration service stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server, grpcServer *kgrpc.Server) *kratos.App {
	return kratosx.NewApp("inspiration-service", httpServer, grpcServer)
}
