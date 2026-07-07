package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v2"
	"github.com/go-kratos/kratos/v2/transport"
	khttp "github.com/go-kratos/kratos/v2/transport/http"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init quota job: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("quota job stopped: %v", err)
	}
}

func newApp(httpServer *khttp.Server, job transport.Server) *kratos.App {
	return kratosx.NewApp("quota-job", httpServer, job)
}
