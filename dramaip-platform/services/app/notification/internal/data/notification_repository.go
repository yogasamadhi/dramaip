// Package data contains the notification domain persistence shared by the
// synchronous notification service and its event consumer. Keeping this below
// app/notification prevents either boundary from owning the other's tables.
package data

import (
	"context"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct {
	DB *gorm.DB
}

type NotificationRow struct {
	ID            string
	Type          string
	Title         string
	Body          string
	SourceEventID string
	ReadAt        string
	CreatedAt     string
}

func NewData() (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

type NotificationRepo struct {
	data *Data
}

func NewNotificationRepo(data *Data) *NotificationRepo {
	return &NotificationRepo{data: data}
}

func (r *NotificationRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
	}
}

func (r *NotificationRepo) ListNotifications(ctx context.Context, userID string, limit int32) ([]NotificationRow, error) {
	var rows []NotificationRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, type, title, body, source_event_id,
		       COALESCE(read_at::text, '') AS read_at, created_at::text AS created_at
		FROM notification.notifications
		WHERE user_id = ?::uuid
		ORDER BY created_at DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	return rows, err
}

func (r *NotificationRepo) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (NotificationRow, error) {
	result := r.data.DB.WithContext(ctx).Exec(`
		UPDATE notification.notifications
		SET read_at = COALESCE(read_at, now()), updated_at = now()
		WHERE id = ?::uuid AND user_id = ?::uuid
	`, notificationID, userID)
	if result.Error != nil {
		return NotificationRow{}, result.Error
	}
	if result.RowsAffected == 0 {
		return NotificationRow{}, gorm.ErrRecordNotFound
	}
	return r.notificationByID(ctx, userID, notificationID)
}

func (r *NotificationRepo) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) (NotificationRow, error) {
	return r.createNotification(ctx, platform.NewUUID(), userID, typ, title, body, sourceEventID)
}

// CreateEventNotification preserves the event contract's notification ID while
// source_event_id makes an at-least-once consumer idempotent for each user.
func (r *NotificationRepo) CreateEventNotification(ctx context.Context, notificationID string, userID string, typ string, title string, body string, sourceEventID string) (NotificationRow, error) {
	if notificationID == "" {
		notificationID = platform.NewUUID()
	}
	return r.createNotification(ctx, notificationID, userID, typ, title, body, sourceEventID)
}

func (r *NotificationRepo) createNotification(ctx context.Context, notificationID string, userID string, typ string, title string, body string, sourceEventID string) (NotificationRow, error) {
	if sourceEventID == "" {
		sourceEventID = platform.NewUUID()
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO notification.notifications (id, user_id, type, title, body, source_event_id)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
		ON CONFLICT (user_id, source_event_id) DO NOTHING
	`, notificationID, userID, typ, title, body, sourceEventID).Error; err != nil {
		return NotificationRow{}, err
	}
	return r.notificationBySourceEvent(ctx, userID, sourceEventID)
}

// ClaimInbox records an incoming event and leases it to this consumer. A
// duplicate that has already completed is intentionally a no-op; a failed or
// expired lease can be retried without losing the original payload.
func (r *NotificationRepo) ClaimInbox(ctx context.Context, eventID string, eventType string, traceID string, rawPayload []byte, lease time.Duration) (bool, error) {
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO notification.event_inbox (id, event_id, event_type, trace_id, raw_payload)
		VALUES (?::uuid, ?, ?, ?, ?::jsonb)
		ON CONFLICT (event_id) DO NOTHING
	`, platform.NewUUID(), eventID, eventType, traceID, string(rawPayload)).Error; err != nil {
		return false, err
	}
	result := r.data.DB.WithContext(ctx).Exec(`
		UPDATE notification.event_inbox
		SET processing_at = now(), attempts = attempts + 1, last_error = NULL, updated_at = now()
		WHERE event_id = ?
		  AND processed_at IS NULL
		  AND (processing_at IS NULL OR processing_at < ?)
	`, eventID, time.Now().UTC().Add(-lease))
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *NotificationRepo) CompleteInbox(ctx context.Context, eventID string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE notification.event_inbox
		SET processed_at = now(), processing_at = NULL, last_error = NULL, updated_at = now()
		WHERE event_id = ?
	`, eventID).Error
}

func (r *NotificationRepo) ReleaseInbox(ctx context.Context, eventID string, cause error) error {
	message := ""
	if cause != nil {
		message = cause.Error()
	}
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE notification.event_inbox
		SET processing_at = NULL, last_error = ?, updated_at = now()
		WHERE event_id = ? AND processed_at IS NULL
	`, message, eventID).Error
}

func (r *NotificationRepo) RecordDeliveryAttempt(ctx context.Context, eventID string, notificationID string, channel string, status string, failure string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO notification.delivery_attempts (id, event_id, notification_id, channel, status, failure)
		VALUES (?::uuid, ?, ?::uuid, ?, ?, NULLIF(?, ''))
	`, platform.NewUUID(), eventID, notificationID, channel, status, failure).Error
}

func (r *NotificationRepo) notificationByID(ctx context.Context, userID string, notificationID string) (NotificationRow, error) {
	var row NotificationRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, type, title, body, source_event_id,
		       COALESCE(read_at::text, '') AS read_at, created_at::text AS created_at
		FROM notification.notifications
		WHERE id = ?::uuid AND user_id = ?::uuid
		LIMIT 1
	`, notificationID, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return NotificationRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func (r *NotificationRepo) notificationBySourceEvent(ctx context.Context, userID string, sourceEventID string) (NotificationRow, error) {
	var row NotificationRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, type, title, body, source_event_id,
		       COALESCE(read_at::text, '') AS read_at, created_at::text AS created_at
		FROM notification.notifications
		WHERE user_id = ?::uuid AND source_event_id = ?
		LIMIT 1
	`, userID, sourceEventID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return NotificationRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}
