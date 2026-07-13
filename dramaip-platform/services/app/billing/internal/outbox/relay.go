// Package outbox provides the billing-local at-least-once relay. Durable
// claims prevent parallel job replicas from publishing the same row at once;
// a leased row is retried after a crash with the same event_id.
package outbox

import (
	"context"
	"fmt"
	"time"

	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"gorm.io/gorm"
)

type Publisher interface {
	Publish(context.Context, *envelopev1.EventEnvelope) error
}

type EventRow struct {
	ID        string
	EventType string
	TraceID   string
	Payload   []byte
}

// Relay publishes each currently claimable row. It returns the first failure
// only after releasing every failed lease, so a corrupt or unavailable event
// does not starve later rows in the batch.
func Relay(ctx context.Context, db *gorm.DB, publisher Publisher, workerID string, batch int, lease time.Duration, retryDelay time.Duration) error {
	if publisher == nil {
		return fmt.Errorf("outbox publisher is required")
	}
	if workerID == "" {
		return fmt.Errorf("outbox worker id is required")
	}
	if batch <= 0 {
		batch = 1
	}
	if lease <= 0 {
		lease = 30 * time.Second
	}
	if retryDelay < 0 {
		retryDelay = 0
	}
	rows, err := claim(ctx, db, workerID, batch, lease)
	if err != nil {
		return err
	}
	var firstErr error
	for _, row := range rows {
		envelope, err := events.ParseEnvelope(row.Payload)
		if err == nil && envelope.GetEventType() != row.EventType {
			err = fmt.Errorf("outbox event type %q does not match payload event_type %q", row.EventType, envelope.GetEventType())
		}
		if err == nil && envelope.GetTraceId() == "" && row.TraceID != "" {
			envelope.TraceId = row.TraceID
		}
		if err == nil {
			err = publisher.Publish(ctx, envelope)
		}
		if err != nil {
			if releaseErr := release(ctx, db, row.ID, workerID, err.Error(), retryDelay); releaseErr != nil {
				err = fmt.Errorf("%w (release outbox lease: %v)", err, releaseErr)
			}
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := markPublished(ctx, db, row.ID, workerID); err != nil {
			return err
		}
	}
	return firstErr
}

func claim(ctx context.Context, db *gorm.DB, workerID string, batch int, lease time.Duration) ([]EventRow, error) {
	var rows []EventRow
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`
			SELECT id::text AS id, event_type, trace_id, payload
			FROM billing.outbox_events
			WHERE published_at IS NULL
			  AND next_attempt_at <= now()
			  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
			ORDER BY created_at ASC
			LIMIT ?
			FOR UPDATE SKIP LOCKED
		`, batch).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := tx.Exec(`
				UPDATE billing.outbox_events
				SET lease_id = ?::uuid, lease_expires_at = now() + (?::bigint * interval '1 microsecond')
				WHERE id = ?::uuid AND published_at IS NULL
			`, workerID, lease.Microseconds(), row.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return rows, err
}

func release(ctx context.Context, db *gorm.DB, eventID, workerID, reason string, retryDelay time.Duration) error {
	result := db.WithContext(ctx).Exec(`
		UPDATE billing.outbox_events
		SET lease_id = NULL,
		    lease_expires_at = NULL,
		    publish_attempts = publish_attempts + 1,
		    last_error = ?,
		    next_attempt_at = now() + (?::bigint * interval '1 microsecond')
		WHERE id = ?::uuid AND lease_id = ?::uuid AND published_at IS NULL
	`, reason, retryDelay.Microseconds(), eventID, workerID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("outbox lease lost before releasing event %s", eventID)
	}
	return nil
}

func markPublished(ctx context.Context, db *gorm.DB, eventID, workerID string) error {
	result := db.WithContext(ctx).Exec(`
		UPDATE billing.outbox_events
		SET published_at = now(), lease_id = NULL, lease_expires_at = NULL, last_error = NULL
		WHERE id = ?::uuid AND lease_id = ?::uuid AND published_at IS NULL
	`, eventID, workerID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("outbox lease lost before marking event %s published", eventID)
	}
	return nil
}
