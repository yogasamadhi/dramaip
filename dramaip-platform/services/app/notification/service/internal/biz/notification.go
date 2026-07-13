package biz

import (
	"context"
	"errors"
	"strings"

	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type NotificationRepository interface {
	Checks() map[string]func(context.Context) error
	ListNotifications(context.Context, string, int32) ([]data.NotificationRow, error)
	MarkNotificationRead(context.Context, string, string) (data.NotificationRow, error)
	CreateNotification(context.Context, string, string, string, string, string) (data.NotificationRow, error)
}

type NotificationUsecase struct {
	repo NotificationRepository
}

type Notification struct {
	ID            string
	Type          string
	Title         string
	Body          string
	SourceEventID string
	ReadAt        string
	CreatedAt     string
}

func NewNotificationUsecase(repo NotificationRepository) *NotificationUsecase {
	return &NotificationUsecase{repo: repo}
}

func (u *NotificationUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *NotificationUsecase) ListNotifications(ctx context.Context, userID string, limit int32) ([]Notification, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id_required")
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := u.repo.ListNotifications(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	notifications := make([]Notification, 0, len(rows))
	for _, row := range rows {
		notifications = append(notifications, notificationFromRow(row))
	}
	return notifications, nil
}

func (u *NotificationUsecase) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (Notification, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(notificationID) == "" {
		return Notification{}, status.Error(codes.InvalidArgument, "user_id_and_notification_id_required")
	}
	row, err := u.repo.MarkNotificationRead(ctx, userID, notificationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Notification{}, status.Error(codes.NotFound, "notification_not_found")
	}
	if err != nil {
		return Notification{}, err
	}
	return notificationFromRow(row), nil
}

func (u *NotificationUsecase) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) (Notification, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(typ) == "" || strings.TrimSpace(title) == "" || strings.TrimSpace(body) == "" {
		return Notification{}, status.Error(codes.InvalidArgument, "user_id_type_title_and_body_required")
	}
	row, err := u.repo.CreateNotification(ctx, strings.TrimSpace(userID), strings.TrimSpace(typ), strings.TrimSpace(title), strings.TrimSpace(body), strings.TrimSpace(sourceEventID))
	if err != nil {
		return Notification{}, err
	}
	return notificationFromRow(row), nil
}

func notificationFromRow(row data.NotificationRow) Notification {
	return Notification{
		ID: row.ID, Type: row.Type, Title: row.Title, Body: row.Body,
		SourceEventID: row.SourceEventID, ReadAt: row.ReadAt, CreatedAt: row.CreatedAt,
	}
}
