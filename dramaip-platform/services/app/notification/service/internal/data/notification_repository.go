package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/conf"
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

func NewData(_ *conf.Bootstrap) (*Data, func(), error) {
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
	if sourceEventID == "" {
		sourceEventID = platform.NewUUID()
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO notification.notifications (id, user_id, type, title, body, source_event_id)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
		ON CONFLICT (user_id, source_event_id) DO NOTHING
	`, platform.NewUUID(), userID, typ, title, body, sourceEventID).Error; err != nil {
		return NotificationRow{}, err
	}
	return r.notificationBySourceEvent(ctx, userID, sourceEventID)
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
