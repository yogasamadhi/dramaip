package data

import (
	"context"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
)

// AIClient deliberately contains only the Web BFF capability. Keeping the
// adapter narrow prevents unrelated AI Gateway contract additions from
// expanding this BFF's surface or invalidating its focused tests.
type AIClient interface {
	Chat(context.Context, *aiv1.ChatRequest, ...grpc.CallOption) (*aiv1.ChatReply, error)
}

type Data struct {
	Auth         authv1.AuthServiceClient
	User         userv1.UserServiceClient
	Billing      billingv1.BillingServiceClient
	Quota        quotav1.QuotaServiceClient
	AI           AIClient
	Notification notificationv1.NotificationServiceClient
	conns        []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	authConn, err := platform.DialGRPC(ctx, cfg.Downstream.AuthEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	userConn, err := platform.DialGRPC(ctx, cfg.Downstream.UserEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		return nil, nil, err
	}
	billingConn, err := platform.DialGRPC(ctx, cfg.Downstream.BillingEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		return nil, nil, err
	}
	quotaConn, err := platform.DialGRPC(ctx, cfg.Downstream.QuotaEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		_ = billingConn.Close()
		return nil, nil, err
	}
	aiConn, err := platform.DialGRPC(ctx, cfg.Downstream.AIGatewayEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		return nil, nil, err
	}
	notificationConn, err := platform.DialGRPC(ctx, cfg.Downstream.NotificationEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		_ = aiConn.Close()
		return nil, nil, err
	}
	d := &Data{
		Auth: authv1.NewAuthServiceClient(authConn), User: userv1.NewUserServiceClient(userConn),
		Billing: billingv1.NewBillingServiceClient(billingConn), Quota: quotav1.NewQuotaServiceClient(quotaConn),
		AI: aiv1.NewAiGatewayServiceClient(aiConn), Notification: notificationv1.NewNotificationServiceClient(notificationConn),
		conns: []*grpc.ClientConn{authConn, userConn, billingConn, quotaConn, aiConn, notificationConn},
	}
	return d, d.Close, nil
}

func (d *Data) Close() {
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}

func (d *Data) Checks() map[string]func(context.Context) error {
	const healthUserID = "00000000-0000-4000-8000-000000000001"
	return map[string]func(context.Context) error{
		"billing": func(ctx context.Context) error {
			_, err := d.Billing.ListPlans(ctx, &billingv1.ListPlansRequest{})
			return err
		},
		"quota": func(ctx context.Context) error {
			_, err := d.Quota.GetTokenBalance(platform.WithUserIdentity(ctx, healthUserID), &quotav1.GetTokenBalanceRequest{UserId: healthUserID})
			return platform.NormalizeHealthProbeError(err)
		},
		"user": func(ctx context.Context) error {
			_, err := d.User.GetProfile(platform.WithUserIdentity(ctx, healthUserID), &userv1.GetProfileRequest{UserId: healthUserID})
			return platform.NormalizeHealthProbeError(err)
		},
		"notification": func(ctx context.Context) error {
			_, err := d.Notification.ListNotifications(platform.WithUserIdentity(ctx, healthUserID), &notificationv1.ListNotificationsRequest{UserId: healthUserID, Limit: 1})
			return err
		},
	}
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

func (d *Data) ListNotifications(ctx context.Context, userID string, limit int) ([]NotificationRow, error) {
	reply, err := d.Notification.ListNotifications(ctx, &notificationv1.ListNotificationsRequest{UserId: userID, Limit: int32(limit)})
	if err != nil {
		return nil, err
	}
	rows := make([]NotificationRow, 0, len(reply.GetNotifications()))
	for _, notification := range reply.GetNotifications() {
		rows = append(rows, notificationRow(notification))
	}
	return rows, nil
}

func (d *Data) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (NotificationRow, error) {
	reply, err := d.Notification.MarkNotificationRead(ctx, &notificationv1.MarkNotificationReadRequest{UserId: userID, NotificationId: notificationID})
	if err != nil {
		return NotificationRow{}, err
	}
	return notificationRow(reply.GetNotification()), nil
}

func (d *Data) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) error {
	_, err := d.Notification.CreateNotification(ctx, &notificationv1.CreateNotificationRequest{
		UserId: userID, Type: typ, Title: title, Body: body, SourceEventId: sourceEventID,
	})
	return err
}

func notificationRow(notification *notificationv1.Notification) NotificationRow {
	if notification == nil {
		return NotificationRow{}
	}
	return NotificationRow{
		ID: notification.GetId(), Type: notification.GetType(), Title: notification.GetTitle(), Body: notification.GetBody(),
		SourceEventID: notification.GetSourceEventId(), ReadAt: notification.GetReadAt(), CreatedAt: notification.GetCreatedAt(),
	}
}
