package main

import (
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	kratos "github.com/go-kratos/kratos/v3"
	"github.com/go-kratos/kratos/v3/transport"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init reporting job: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("reporting job stopped: %v", err)
	}
}
func newApp(httpServer *khttp.Server, job transport.Server) *kratos.App {
	return kratosx.NewApp("reporting-job", httpServer, job)
}
