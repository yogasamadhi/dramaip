package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type eventRow struct {
	ID        string
	EventType string
	Payload   []byte
}

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	publisher, err := platform.NewRabbitPublisher(platform.RabbitConfigFromEnv())
	if err != nil {
		log.Fatalf("connect rabbitmq: %v", err)
	}
	defer publisher.Close()
	health := platform.HealthServer(platform.Env("BILLING_JOB_HTTP_ADDR", ":8106"), "billing-job", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
		"rabbitmq": publisher.Health,
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("billing-job health server stopped: %v", err)
		}
	}()
	interval := time.Duration(platform.EnvInt("OUTBOX_POLL_INTERVAL_MS", 1000)) * time.Millisecond
	batch := platform.EnvInt("OUTBOX_BATCH_SIZE", 100)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := relay(context.Background(), db, publisher, batch); err != nil {
			log.Printf("outbox relay failed: %v", err)
		}
		<-ticker.C
	}
}

func relay(ctx context.Context, db *gorm.DB, publisher *platform.RabbitPublisher, batch int) error {
	var rows []eventRow
	if err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, event_type, payload
		FROM billing.outbox_events
		WHERE published_at IS NULL
		ORDER BY created_at ASC
		LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var payload map[string]any
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			return err
		}
		if err := publisher.Publish(ctx, row.EventType, payload); err != nil {
			return err
		}
		if err := db.WithContext(ctx).Exec(`UPDATE billing.outbox_events SET published_at = now() WHERE id = ?::uuid`, row.ID).Error; err != nil {
			return err
		}
	}
	return nil
}
