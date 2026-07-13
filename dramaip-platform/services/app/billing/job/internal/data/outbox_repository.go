package data

import (
	"context"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/activation"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/outbox"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

type Data struct {
	DB        *gorm.DB
	Publisher *platform.RabbitPublisher
	Quota     quotav1.QuotaServiceClient
	workerID  string
	conns     []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "billing")
	if err != nil {
		return nil, nil, err
	}
	publisher, err := platform.NewRabbitPublisher(platform.RabbitConfigFromEnv())
	if err != nil {
		return nil, nil, err
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	quotaConn, err := platform.DialGRPC(dialCtx, cfg.Quota.GRPCEndpoint, cfg.MTLS)
	if err != nil {
		publisher.Close()
		return nil, nil, err
	}
	data := &Data{DB: db, Publisher: publisher, Quota: quotav1.NewQuotaServiceClient(quotaConn), workerID: platform.NewUUID(), conns: []*grpc.ClientConn{quotaConn}}
	return data, data.Close, nil
}

func (d *Data) Close() {
	d.Publisher.Close()
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}

func (d *Data) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, d.DB) },
		"rabbitmq": d.Publisher.Health,
	}
}

func (d *Data) Relay(ctx context.Context, batch int, lease time.Duration, retry time.Duration) error {
	return outbox.Relay(ctx, d.DB, d.Publisher, d.workerID, batch, lease, retry)
}

func (d *Data) RetryQuotaProvisioning(ctx context.Context, batch int) error {
	var rows []struct {
		ID                 string
		UserID             string
		PlanCode           string
		PlanName           string
		BillingPeriod      string
		PlanPrice          string
		Currency           string
		QuotaTokens        int64
		MaxRPM             int64
		MaxContextTokens   int64
		ModelLevel         string
		PlanSnapshotSource string
		PlanSnapshotAt     string
		CurrentPeriodStart string
		CurrentPeriodEnd   string
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_code,
		       sub.plan_name, sub.billing_period, sub.plan_price::text AS plan_price, sub.currency,
		       sub.monthly_token_quota AS quota_tokens, sub.max_rpm, sub.max_context_tokens, sub.model_level,
		       sub.plan_snapshot_source, sub.plan_snapshot_at::text AS plan_snapshot_at,
		       sub.current_period_start::text AS current_period_start,
		       sub.current_period_end::text AS current_period_end
		FROM billing.subscriptions sub
		WHERE sub.status IN ('quota_pending', 'activation_failed')
		ORDER BY sub.updated_at ASC
		LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := d.Quota.CreatePeriodAccount(ctx, &quotav1.CreatePeriodAccountRequest{
			UserId: row.UserID, SubscriptionId: row.ID, PlanCode: row.PlanCode,
			QuotaTokens: row.QuotaTokens, PeriodStart: row.CurrentPeriodStart, PeriodEnd: row.CurrentPeriodEnd,
			PlanName: row.PlanName, BillingPeriod: row.BillingPeriod, PlanPrice: row.PlanPrice,
			Currency: row.Currency, MaxRpm: row.MaxRPM, MaxContextTokens: row.MaxContextTokens,
			ModelLevel: row.ModelLevel, PlanSnapshotSource: row.PlanSnapshotSource, PlanSnapshotAt: row.PlanSnapshotAt,
		}); err != nil {
			_ = d.DB.WithContext(ctx).Exec(`UPDATE billing.subscriptions SET status = 'activation_failed', activation_error = ?, updated_at = now() WHERE id = ?::uuid AND status IN ('quota_pending', 'activation_failed')`, err.Error(), row.ID).Error
			continue
		}
		if err := activation.ActivateSubscription(ctx, d.DB, row.ID); err != nil {
			_ = d.DB.WithContext(ctx).Exec(`UPDATE billing.subscriptions SET status = 'activation_failed', activation_error = ?, updated_at = now() WHERE id = ?::uuid AND status IN ('quota_pending', 'activation_failed')`, err.Error(), row.ID).Error
			return err
		}
	}
	return nil
}
