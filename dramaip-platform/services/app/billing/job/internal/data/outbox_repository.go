package data

import (
	"context"
	"encoding/json"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

type EventRow struct {
	ID        string
	EventType string
	TraceID   string
	Payload   []byte
}

type Data struct {
	DB        *gorm.DB
	Publisher *platform.RabbitPublisher
	Quota     quotav1.QuotaServiceClient
	conns     []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	publisher, err := platform.NewRabbitPublisher(platform.RabbitConfigFromEnv())
	if err != nil {
		return nil, nil, err
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	quotaConn, err := platform.DialGRPC(dialCtx, cfg.Quota.GRPCEndpoint)
	if err != nil {
		publisher.Close()
		return nil, nil, err
	}
	data := &Data{DB: db, Publisher: publisher, Quota: quotav1.NewQuotaServiceClient(quotaConn), conns: []*grpc.ClientConn{quotaConn}}
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

func (d *Data) Relay(ctx context.Context, batch int) error {
	var rows []EventRow
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, event_type, trace_id, payload
		FROM billing.outbox_events
		WHERE published_at IS NULL
		ORDER BY created_at ASC
		LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		eventCtx, span := platform.Tracer("billing-job").Start(ctx, "outbox relay "+row.EventType)
		var payload map[string]any
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			span.RecordError(err)
			span.End()
			return err
		}
		if row.TraceID != "" {
			payload["trace_id"] = row.TraceID
		}
		if err := d.Publisher.Publish(eventCtx, row.EventType, payload); err != nil {
			_ = d.DB.WithContext(ctx).Exec(`
				UPDATE billing.outbox_events
				SET publish_attempts = publish_attempts + 1, last_error = ?, occurred_at = occurred_at
				WHERE id = ?::uuid
			`, err.Error(), row.ID).Error
			platform.StructuredLog(eventCtx, "billing-job", "error", "outbox_publish_failed", map[string]any{"event_id": row.ID, "event_type": row.EventType, "error": err.Error()})
			span.RecordError(err)
			span.End()
			return err
		}
		if err := d.DB.WithContext(ctx).Exec(`UPDATE billing.outbox_events SET published_at = now() WHERE id = ?::uuid`, row.ID).Error; err != nil {
			span.RecordError(err)
			span.End()
			return err
		}
		platform.StructuredLog(eventCtx, "billing-job", "info", "outbox_published", map[string]any{"event_id": row.ID, "event_type": row.EventType})
		span.End()
	}
	return nil
}

func (d *Data) RetryQuotaProvisioning(ctx context.Context, batch int) error {
	var rows []struct {
		ID                 string
		UserID             string
		PlanCode           string
		QuotaTokens        int64
		CurrentPeriodStart string
		CurrentPeriodEnd   string
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, plan.code AS plan_code,
		       plan.monthly_token_quota AS quota_tokens,
		       sub.current_period_start::text AS current_period_start,
		       sub.current_period_end::text AS current_period_end
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
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
		}); err != nil {
			_ = d.DB.WithContext(ctx).Exec(`UPDATE billing.subscriptions SET status = 'activation_failed', activation_error = ?, updated_at = now() WHERE id = ?::uuid`, err.Error(), row.ID).Error
			continue
		}
		if err := d.DB.WithContext(ctx).Exec(`UPDATE billing.subscriptions SET status = 'active', activation_error = NULL, quota_provisioned_at = now(), updated_at = now() WHERE id = ?::uuid`, row.ID).Error; err != nil {
			return err
		}
	}
	return nil
}
