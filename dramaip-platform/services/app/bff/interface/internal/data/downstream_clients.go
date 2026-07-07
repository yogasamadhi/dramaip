package data

import (
	"context"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

type Data struct {
	Auth    authv1.AuthServiceClient
	User    userv1.UserServiceClient
	Billing billingv1.BillingServiceClient
	Quota   quotav1.QuotaServiceClient
	AI      aiv1.AiGatewayServiceClient
	DB      *gorm.DB
	conns   []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	authConn, err := platform.DialGRPC(ctx, cfg.Downstream.AuthEndpoint)
	if err != nil {
		return nil, nil, err
	}
	userConn, err := platform.DialGRPC(ctx, cfg.Downstream.UserEndpoint)
	if err != nil {
		_ = authConn.Close()
		return nil, nil, err
	}
	billingConn, err := platform.DialGRPC(ctx, cfg.Downstream.BillingEndpoint)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		return nil, nil, err
	}
	quotaConn, err := platform.DialGRPC(ctx, cfg.Downstream.QuotaEndpoint)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		_ = billingConn.Close()
		return nil, nil, err
	}
	aiConn, err := platform.DialGRPC(ctx, cfg.Downstream.AIGatewayEndpoint)
	if err != nil {
		_ = authConn.Close()
		_ = userConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		return nil, nil, err
	}
	db, err := platform.OpenPostgres()
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
		AI: aiv1.NewAiGatewayServiceClient(aiConn), DB: db, conns: []*grpc.ClientConn{authConn, userConn, billingConn, quotaConn, aiConn},
	}
	return d, d.Close, nil
}

func (d *Data) Close() {
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}

func (d *Data) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"billing": func(ctx context.Context) error {
			_, err := d.Billing.ListPlans(ctx, &billingv1.ListPlansRequest{})
			return err
		},
		"quota": func(ctx context.Context) error {
			_, err := d.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: "00000000-0000-4000-8000-000000000001"})
			return err
		},
		"user": func(ctx context.Context) error {
			_, err := d.User.GetProfile(ctx, &userv1.GetProfileRequest{UserId: "00000000-0000-4000-8000-000000000001"})
			return err
		},
		"postgres": func(ctx context.Context) error {
			if d.DB == nil {
				return nil
			}
			return platform.CheckPostgres(ctx, d.DB)
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
	if d.DB == nil {
		return []NotificationRow{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows []NotificationRow
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, type, title, body, source_event_id,
		       COALESCE(read_at::text, '') AS read_at, created_at::text AS created_at
		FROM notification.notifications
		WHERE user_id = ?::uuid
		ORDER BY created_at DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	return rows, err
}

func (d *Data) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (NotificationRow, error) {
	if d.DB == nil {
		return NotificationRow{ID: notificationID, ReadAt: time.Now().UTC().Format(time.RFC3339)}, nil
	}
	if err := d.DB.WithContext(ctx).Exec(`
		UPDATE notification.notifications
		SET read_at = COALESCE(read_at, now()), updated_at = now()
		WHERE id = ?::uuid AND user_id = ?::uuid
	`, notificationID, userID).Error; err != nil {
		return NotificationRow{}, err
	}
	var row NotificationRow
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, type, title, body, source_event_id,
		       COALESCE(read_at::text, '') AS read_at, created_at::text AS created_at
		FROM notification.notifications
		WHERE id = ?::uuid AND user_id = ?::uuid
		LIMIT 1
	`, notificationID, userID).Scan(&row).Error
	return row, err
}

func (d *Data) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) error {
	if d.DB == nil {
		return nil
	}
	if sourceEventID == "" {
		sourceEventID = platform.NewUUID()
	}
	return d.DB.WithContext(ctx).Exec(`
		INSERT INTO notification.notifications (id, user_id, type, title, body, source_event_id)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
		ON CONFLICT (user_id, source_event_id) DO NOTHING
	`, platform.NewUUID(), userID, typ, title, body, sourceEventID).Error
}
