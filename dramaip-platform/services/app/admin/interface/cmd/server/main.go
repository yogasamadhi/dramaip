package main

import (
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	kratos "github.com/go-kratos/kratos/v3"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init admin interface: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("admin interface stopped: %v", err)
	}
}
func newApp(httpServer *khttp.Server) *kratos.App {
	return kratosx.NewApp("admin-bff-interface", httpServer)
}
