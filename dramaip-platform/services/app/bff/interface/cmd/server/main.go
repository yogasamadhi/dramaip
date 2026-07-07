package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v2"
	khttp "github.com/go-kratos/kratos/v2/transport/http"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init bff interface: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("bff interface stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server) *kratos.App {
	return kratosx.NewApp("bff-interface", httpServer)
}
