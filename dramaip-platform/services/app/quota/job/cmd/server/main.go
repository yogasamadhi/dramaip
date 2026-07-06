package main

import (
	"context"
	"log"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	health := platform.HealthServer(platform.Env("QUOTA_JOB_HTTP_ADDR", ":8107"), "quota-job", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("quota-job health server stopped: %v", err)
		}
	}()
	interval := time.Duration(platform.EnvInt("QUOTA_JOB_TICK_SECONDS", 60)) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		log.Printf("quota-job heartbeat: period account maintenance not due")
	}
}
