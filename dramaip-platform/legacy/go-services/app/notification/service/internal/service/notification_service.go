package service

import (
	"context"

	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/notification/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type NotificationService struct {
	notificationv1.UnimplementedNotificationServiceServer
	uc *biz.NotificationUsecase
}

func NewNotificationService(uc *biz.NotificationUsecase) *NotificationService {
	return &NotificationService{uc: uc}
}

func (s *NotificationService) ListNotifications(ctx context.Context, req *notificationv1.ListNotificationsRequest) (*notificationv1.ListNotificationsResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListNotifications(ctx, req.UserId, req.Limit)
	if err != nil {
		return nil, err
	}
	response := &notificationv1.ListNotificationsResponse{Notifications: make([]*notificationv1.Notification, 0, len(rows))}
	for _, row := range rows {
		response.Notifications = append(response.Notifications, notificationReply(row))
	}
	return response, nil
}

func (s *NotificationService) MarkNotificationRead(ctx context.Context, req *notificationv1.MarkNotificationReadRequest) (*notificationv1.MarkNotificationReadResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	notification, err := s.uc.MarkNotificationRead(ctx, req.UserId, req.NotificationId)
	if err != nil {
		return nil, err
	}
	return &notificationv1.MarkNotificationReadResponse{Notification: notificationReply(notification)}, nil
}

func (s *NotificationService) CreateNotification(ctx context.Context, req *notificationv1.CreateNotificationRequest) (*notificationv1.CreateNotificationResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	notification, err := s.uc.CreateNotification(ctx, req.UserId, req.Type, req.Title, req.Body, req.SourceEventId)
	if err != nil {
		return nil, err
	}
	return &notificationv1.CreateNotificationResponse{Notification: notificationReply(notification)}, nil
}

func notificationReply(notification biz.Notification) *notificationv1.Notification {
	return &notificationv1.Notification{
		Id: notification.ID, Type: notification.Type, Title: notification.Title, Body: notification.Body,
		SourceEventId: notification.SourceEventID, ReadAt: notification.ReadAt, CreatedAt: notification.CreatedAt,
	}
}
