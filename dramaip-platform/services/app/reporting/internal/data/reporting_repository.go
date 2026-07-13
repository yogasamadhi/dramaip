package data

import (
	"context"
	"errors"
	"fmt"
	"strings"

	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

var ErrExceptionNotOpen = errors.New("reporting projection exception is not open")

type Overview struct {
	UserCount, PaidOrderCount, ActiveSubscriptionCount, TotalTokens, OpenExceptionCount int64
	LastEventAt                                                                         string
}
type UserSummary struct {
	UserID, FirstSeenAt, LastSeenAt, LastPlanCode string
	TotalTokens                                   int64
}
type OrderSummary struct {
	OrderID, UserID, PlanCode, Provider, Amount, Currency, Status, SubscriptionID, UpdatedAt string
}
type SubscriptionSummary struct {
	SubscriptionID, UserID, PlanCode, Status, PeriodStart, PeriodEnd, UpdatedAt string
}
type ProjectionException struct {
	ID, EventID, EventType, Status, Summary, TraceID, CreatedAt, ResolvedAt, ResolvedBy, ResolutionReason string
}

type ReportingRepo struct{ data *Data }

func NewReportingRepo(data *Data) *ReportingRepo { return &ReportingRepo{data: data} }

func (r *ReportingRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) }}
}

// StoreAndProject is the consumer's atomic idempotency boundary. A duplicate
// event does not touch any aggregate counter. A malformed-but-durable event is
// retained and surfaced as an exception, so it does not poison the queue.
func (r *ReportingRepo) StoreAndProject(ctx context.Context, envelope *envelopev1.EventEnvelope, raw []byte) (created bool, err error) {
	err = r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Exec(`INSERT INTO reporting.source_events (event_id, event_type, trace_id, payload) VALUES (?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING`, envelope.GetEventId(), envelope.GetEventType(), envelope.GetTraceId(), raw)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			created = false
			return nil
		}
		created = true
		if err := projectEnvelope(ctx, tx, envelope); err != nil {
			return recordException(ctx, tx, envelope, err.Error())
		}
		return nil
	})
	return created, err
}

func (r *ReportingRepo) ResetProjection(ctx context.Context) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, table := range []string{"projection_exceptions", "order_summaries", "subscription_summaries", "user_summaries"} {
			if err := tx.Exec("DELETE FROM reporting." + table).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ReportingRepo) ProjectStored(ctx context.Context, envelope *envelopev1.EventEnvelope) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := projectEnvelope(ctx, tx, envelope); err != nil {
			return recordException(ctx, tx, envelope, err.Error())
		}
		return nil
	})
}

func (r *ReportingRepo) Replay(ctx context.Context, handler func(context.Context, []byte) error) error {
	rows, err := r.data.DB.WithContext(ctx).Raw(`SELECT payload FROM reporting.source_events ORDER BY received_at ASC, event_id ASC`).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		if err := handler(ctx, raw); err != nil {
			return err
		}
	}
	return rows.Err()
}

func projectEnvelope(ctx context.Context, tx *gorm.DB, envelope *envelopev1.EventEnvelope) error {
	now := "now()"
	switch payload := envelope.GetPayload().(type) {
	case *envelopev1.EventEnvelope_CheckoutCreated:
		value := payload.CheckoutCreated
		if value == nil {
			return errors.New("checkout payload is required")
		}
		if err := upsertUser(ctx, tx, value.GetUserId(), ""); err != nil {
			return err
		}
		return tx.WithContext(ctx).Exec(`
			INSERT INTO reporting.order_summaries (order_id, user_id, plan_code, provider, amount, currency, status, updated_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, 'pending', `+now+`)
			ON CONFLICT (order_id) DO UPDATE SET user_id = EXCLUDED.user_id, plan_code = EXCLUDED.plan_code, provider = EXCLUDED.provider, amount = EXCLUDED.amount, currency = EXCLUDED.currency, status = CASE WHEN reporting.order_summaries.status = 'paid' THEN 'paid' ELSE 'pending' END, updated_at = `+now,
			value.GetOrderId(), value.GetUserId(), value.GetPlanCode(), value.GetProvider(), value.GetAmount(), value.GetCurrency()).Error
	case *envelopev1.EventEnvelope_PaymentSucceeded:
		value := payload.PaymentSucceeded
		if value == nil {
			return errors.New("payment payload is required")
		}
		if err := upsertUser(ctx, tx, value.GetUserId(), value.GetPlanCode()); err != nil {
			return err
		}
		return tx.WithContext(ctx).Exec(`
			INSERT INTO reporting.order_summaries (order_id, user_id, plan_code, provider, amount, currency, status, subscription_id, updated_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, 'paid', ?::uuid, `+now+`)
			ON CONFLICT (order_id) DO UPDATE SET user_id = EXCLUDED.user_id, plan_code = EXCLUDED.plan_code, provider = EXCLUDED.provider, amount = EXCLUDED.amount, currency = EXCLUDED.currency, status = 'paid', subscription_id = EXCLUDED.subscription_id, updated_at = `+now,
			value.GetOrderId(), value.GetUserId(), value.GetPlanCode(), value.GetProvider(), value.GetAmount(), value.GetCurrency(), value.GetSubscriptionId()).Error
	case *envelopev1.EventEnvelope_SubscriptionActivated:
		value := payload.SubscriptionActivated
		if value == nil {
			return errors.New("subscription payload is required")
		}
		if err := upsertUser(ctx, tx, value.GetUserId(), value.GetPlanCode()); err != nil {
			return err
		}
		return tx.WithContext(ctx).Exec(`
			INSERT INTO reporting.subscription_summaries (subscription_id, user_id, plan_code, status, period_start, period_end, updated_at)
			VALUES (?::uuid, ?::uuid, ?, 'active', ?::timestamptz, ?::timestamptz, `+now+`)
			ON CONFLICT (subscription_id) DO UPDATE SET user_id = EXCLUDED.user_id, plan_code = EXCLUDED.plan_code, status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, updated_at = `+now,
			value.GetSubscriptionId(), value.GetUserId(), value.GetPlanCode(), value.GetPeriodStart(), value.GetPeriodEnd()).Error
	case *envelopev1.EventEnvelope_TokenUsageRecorded:
		value := payload.TokenUsageRecorded
		if value == nil {
			return errors.New("token usage payload is required")
		}
		if err := upsertUser(ctx, tx, value.GetUserId(), ""); err != nil {
			return err
		}
		return tx.WithContext(ctx).Exec(`UPDATE reporting.user_summaries SET total_tokens = total_tokens + ?, last_seen_at = now() WHERE user_id = ?::uuid`, value.GetTotalTokens(), value.GetUserId()).Error
	default:
		return fmt.Errorf("unsupported reporting event payload %q", envelope.GetEventType())
	}
}

func upsertUser(ctx context.Context, tx *gorm.DB, userID, planCode string) error {
	return tx.WithContext(ctx).Exec(`
		INSERT INTO reporting.user_summaries (user_id, first_seen_at, last_seen_at, last_plan_code)
		VALUES (?::uuid, now(), now(), ?)
		ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now(), last_plan_code = CASE WHEN EXCLUDED.last_plan_code <> '' THEN EXCLUDED.last_plan_code ELSE reporting.user_summaries.last_plan_code END`, userID, planCode).Error
}

func recordException(ctx context.Context, tx *gorm.DB, envelope *envelopev1.EventEnvelope, summary string) error {
	summary = strings.TrimSpace(summary)
	if len(summary) > 500 {
		summary = summary[:500]
	}
	return tx.WithContext(ctx).Exec(`
		INSERT INTO reporting.projection_exceptions (id, event_id, event_type, status, summary, trace_id)
		VALUES (?::uuid, ?, ?, 'open', ?, ?)
		ON CONFLICT (event_id) DO UPDATE SET event_type = EXCLUDED.event_type, summary = EXCLUDED.summary, trace_id = EXCLUDED.trace_id WHERE reporting.projection_exceptions.status = 'open'`, platform.NewUUID(), envelope.GetEventId(), envelope.GetEventType(), summary, envelope.GetTraceId()).Error
}

func (r *ReportingRepo) Overview(ctx context.Context) (Overview, error) {
	var row Overview
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT
		  (SELECT count(*) FROM reporting.user_summaries) AS user_count,
		  (SELECT count(*) FROM reporting.order_summaries WHERE status = 'paid') AS paid_order_count,
		  (SELECT count(*) FROM reporting.subscription_summaries WHERE status = 'active') AS active_subscription_count,
		  COALESCE((SELECT sum(total_tokens) FROM reporting.user_summaries), 0) AS total_tokens,
		  (SELECT count(*) FROM reporting.projection_exceptions WHERE status = 'open') AS open_exception_count,
		  COALESCE((SELECT max(received_at)::text FROM reporting.source_events), '') AS last_event_at`).Scan(&row).Error
	return row, err
}

func (r *ReportingRepo) ListUsers(ctx context.Context, limit int) ([]UserSummary, error) {
	var rows []UserSummary
	err := r.data.DB.WithContext(ctx).Raw(`SELECT user_id::text AS user_id, first_seen_at::text AS first_seen_at, last_seen_at::text AS last_seen_at, total_tokens, last_plan_code FROM reporting.user_summaries ORDER BY last_seen_at DESC, user_id DESC LIMIT ?`, boundedLimit(limit)).Scan(&rows).Error
	return rows, err
}
func (r *ReportingRepo) ListOrders(ctx context.Context, limit int) ([]OrderSummary, error) {
	var rows []OrderSummary
	err := r.data.DB.WithContext(ctx).Raw(`SELECT order_id::text AS order_id, user_id::text AS user_id, plan_code, provider, amount, currency, status, COALESCE(subscription_id::text, '') AS subscription_id, updated_at::text AS updated_at FROM reporting.order_summaries ORDER BY updated_at DESC, order_id DESC LIMIT ?`, boundedLimit(limit)).Scan(&rows).Error
	return rows, err
}
func (r *ReportingRepo) ListSubscriptions(ctx context.Context, limit int) ([]SubscriptionSummary, error) {
	var rows []SubscriptionSummary
	err := r.data.DB.WithContext(ctx).Raw(`SELECT subscription_id::text AS subscription_id, user_id::text AS user_id, plan_code, status, COALESCE(period_start::text, '') AS period_start, COALESCE(period_end::text, '') AS period_end, updated_at::text AS updated_at FROM reporting.subscription_summaries ORDER BY updated_at DESC, subscription_id DESC LIMIT ?`, boundedLimit(limit)).Scan(&rows).Error
	return rows, err
}
func (r *ReportingRepo) ListExceptions(ctx context.Context, limit int, includeResolved bool) ([]ProjectionException, error) {
	var rows []ProjectionException
	query := `SELECT id::text AS id, event_id, event_type, status, summary, trace_id, created_at::text AS created_at, COALESCE(resolved_at::text, '') AS resolved_at, COALESCE(resolved_by::text, '') AS resolved_by, resolution_reason FROM reporting.projection_exceptions`
	if !includeResolved {
		query += ` WHERE status = 'open'`
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	err := r.data.DB.WithContext(ctx).Raw(query, boundedLimit(limit)).Scan(&rows).Error
	return rows, err
}

func (r *ReportingRepo) ResolveException(ctx context.Context, exceptionID, actorID, reason string) (ProjectionException, error) {
	if len(strings.TrimSpace(reason)) < 4 || len(reason) > 300 {
		return ProjectionException{}, fmt.Errorf("invalid exception resolution reason")
	}
	result := r.data.DB.WithContext(ctx).Exec(`UPDATE reporting.projection_exceptions SET status = 'resolved', resolved_at = now(), resolved_by = ?::uuid, resolution_reason = ? WHERE id = ?::uuid AND status = 'open'`, actorID, strings.TrimSpace(reason), exceptionID)
	if result.Error != nil {
		return ProjectionException{}, result.Error
	}
	if result.RowsAffected != 1 {
		return ProjectionException{}, ErrExceptionNotOpen
	}
	var row ProjectionException
	err := r.data.DB.WithContext(ctx).Raw(`SELECT id::text AS id, event_id, event_type, status, summary, trace_id, created_at::text AS created_at, COALESCE(resolved_at::text, '') AS resolved_at, COALESCE(resolved_by::text, '') AS resolved_by, resolution_reason FROM reporting.projection_exceptions WHERE id = ?::uuid`, exceptionID).Scan(&row).Error
	return row, err
}

func boundedLimit(value int) int {
	if value <= 0 || value > 100 {
		return 50
	}
	return value
}
