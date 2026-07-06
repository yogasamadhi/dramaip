package main

import (
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	if err := platform.RunMigrations(db, platform.Env("MIGRATIONS_DIR", "./migrations")); err != nil {
		log.Fatalf("run migrations: %v", err)
	}
	log.Printf("migrations applied")
}
