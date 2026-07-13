package service

import (
	"context"
	"testing"

	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

func TestNotificationServiceOwnsSynchronousReadAndWritePath(t *testing.T) {
	repo := &fakeNotificationRepo{rows: map[string]data.NotificationRow{}}
	svc := NewNotificationService(biz.NewNotificationUsecase(repo))
	ctx := context.Background()

	created, err := svc.CreateNotification(ctx, &notificationv1.CreateNotificationRequest{
		UserId: "user-1", Type: "payment_succeeded", Title: "Payment confirmed", Body: "Your subscription is active.", SourceEventId: "payment:order-1",
	})
	if err != nil {
		t.Fatalf("create notification: %v", err)
	}
	if created.GetNotification().GetId() == "" || created.GetNotification().GetSourceEventId() != "payment:order-1" {
		t.Fatalf("created notification = %+v", created.GetNotification())
	}
	duplicate, err := svc.CreateNotification(ctx, &notificationv1.CreateNotificationRequest{
		UserId: "user-1", Type: "payment_succeeded", Title: "Payment confirmed", Body: "Your subscription is active.", SourceEventId: "payment:order-1",
	})
	if err != nil || duplicate.GetNotification().GetId() != created.GetNotification().GetId() || len(repo.rows) != 1 {
		t.Fatalf("duplicate notification=%+v err=%v rows=%+v", duplicate.GetNotification(), err, repo.rows)
	}

	listed, err := svc.ListNotifications(ctx, &notificationv1.ListNotificationsRequest{UserId: "user-1", Limit: 200})
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	if repo.lastLimit != 50 || len(listed.GetNotifications()) != 1 {
		t.Fatalf("limit=%d notifications=%+v", repo.lastLimit, listed.GetNotifications())
	}

	marked, err := svc.MarkNotificationRead(ctx, &notificationv1.MarkNotificationReadRequest{UserId: "user-1", NotificationId: created.GetNotification().GetId()})
	if err != nil {
		t.Fatalf("mark notification read: %v", err)
	}
	if marked.GetNotification().GetReadAt() == "" {
		t.Fatalf("read notification = %+v", marked.GetNotification())
	}
}

func TestNotificationServiceRejectsInvalidOrMissingNotification(t *testing.T) {
	svc := NewNotificationService(biz.NewNotificationUsecase(&fakeNotificationRepo{rows: map[string]data.NotificationRow{}}))
	if _, err := svc.CreateNotification(context.Background(), &notificationv1.CreateNotificationRequest{UserId: "user-1", Type: "payment"}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid create error=%v", err)
	}
	if _, err := svc.MarkNotificationRead(context.Background(), &notificationv1.MarkNotificationReadRequest{UserId: "user-1", NotificationId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("missing notification error=%v", err)
	}
}

type fakeNotificationRepo struct {
	rows      map[string]data.NotificationRow
	lastLimit int32
}

func (f *fakeNotificationRepo) Checks() map[string]func(context.Context) error { return nil }

func (f *fakeNotificationRepo) ListNotifications(_ context.Context, _ string, limit int32) ([]data.NotificationRow, error) {
	f.lastLimit = limit
	rows := make([]data.NotificationRow, 0, len(f.rows))
	for _, row := range f.rows {
		rows = append(rows, row)
	}
	return rows, nil
}

func (f *fakeNotificationRepo) MarkNotificationRead(_ context.Context, _ string, notificationID string) (data.NotificationRow, error) {
	row, ok := f.rows[notificationID]
	if !ok {
		return data.NotificationRow{}, gorm.ErrRecordNotFound
	}
	row.ReadAt = "2026-07-13T00:00:00Z"
	f.rows[notificationID] = row
	return row, nil
}

func (f *fakeNotificationRepo) CreateNotification(_ context.Context, _ string, typ string, title string, body string, sourceEventID string) (data.NotificationRow, error) {
	for _, row := range f.rows {
		if row.SourceEventID == sourceEventID {
			return row, nil
		}
	}
	row := data.NotificationRow{ID: "notification-1", Type: typ, Title: title, Body: body, SourceEventID: sourceEventID, CreatedAt: "2026-07-13T00:00:00Z"}
	f.rows[row.ID] = row
	return row, nil
}
