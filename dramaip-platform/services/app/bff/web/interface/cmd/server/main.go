package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v3"
	khttp "github.com/go-kratos/kratos/v3/transport/http"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init web bff interface: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("web bff interface stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server) *kratos.App {
	return kratosx.NewApp("web-bff-interface", httpServer)
}
