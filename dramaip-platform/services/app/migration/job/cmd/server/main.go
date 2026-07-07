package main

import (
	"log"

	kratos "github.com/go-kratos/kratos/v2"
	"github.com/go-kratos/kratos/v2/transport"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

func main() {
	app, cleanup, err := wireApp()
	if err != nil {
		log.Fatalf("init migration job: %v", err)
	}
	defer cleanup()
	if err := app.Run(); err != nil {
		log.Fatalf("migration job stopped: %v", err)
	}
}

func newApp(job transport.Server) *kratos.App {
	return kratosx.NewApp("migration-job", job)
}
