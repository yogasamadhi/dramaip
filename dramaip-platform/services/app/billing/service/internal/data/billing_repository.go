package data

import (
	"context"
	"encoding/json"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type Data struct {
	DB    *gorm.DB
	Quota quotav1.QuotaServiceClient
	conns []*grpc.ClientConn
}

type PlanRow struct {
	ID                string
	Code              string
	Name              string
	Price             float64
	Currency          string
	MonthlyTokenQuota int64
	ModelLevel        string
	MaxRPM            int64
}

type SubscriptionRow struct {
	ID                 string
	UserID             string
	PlanID             string
	PlanCode           string
	Status             string
	CurrentPeriodStart string
	CurrentPeriodEnd   string
	CancelAtPeriodEnd  bool
	CanceledAt         string
}

type OrderRow struct {
	ID             string
	UserID         string
	PlanID         string
	PlanCode       string
	Provider       string
	Status         string
	Amount         string
	Currency       string
	PaymentURL     string
	CreatedAt      string
	PaidAt         string
	SubscriptionID string
}

type TokenBalanceRow struct {
	Plan            string
	QuotaTokens     int64
	UsedTokens      int64
	RemainingTokens int64
	PeriodStart     string
	PeriodEnd       string
}

type CheckoutResult struct {
	OrderID    string
	PlanID     string
	Provider   string
	Status     string
	PaymentURL string
}

type SandboxPaymentResult struct {
	OrderID      string
	Status       string
	Subscription SubscriptionRow
	TokenBalance TokenBalanceRow
	QuotaTokens  int64
	PeriodStart  string
	PeriodEnd    string
}

type SimulatedPaymentResult = SandboxPaymentResult

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Quota.DialTimeout, 10*time.Second))
	defer cancel()
	quotaConn, err := platform.DialGRPC(dialCtx, cfg.Quota.GRPCEndpoint)
	if err != nil {
		return nil, nil, err
	}
	data := &Data{DB: db, Quota: quotav1.NewQuotaServiceClient(quotaConn), conns: []*grpc.ClientConn{quotaConn}}
	return data, data.Close, nil
}

func (d *Data) Close() {
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}

type BillingRepo struct {
	data *Data
}

func NewBillingRepo(data *Data) *BillingRepo {
	return &BillingRepo{data: data}
}

func (r *BillingRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
		"quota": func(ctx context.Context) error {
			_, err := r.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: "00000000-0000-4000-8000-000000000001"})
			return err
		},
	}
}

func (r *BillingRepo) CreatePeriodAccount(ctx context.Context, userID string, subscriptionID string, planCode string, quotaTokens int64, periodStart string, periodEnd string) (TokenBalanceRow, error) {
	if _, err := r.data.Quota.CreatePeriodAccount(ctx, &quotav1.CreatePeriodAccountRequest{
		UserId: userID, SubscriptionId: subscriptionID, QuotaTokens: quotaTokens,
		PeriodStart: periodStart, PeriodEnd: periodEnd, PlanCode: planCode,
	}); err != nil {
		return TokenBalanceRow{}, err
	}
	balance, err := r.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: userID})
	if err != nil {
		return TokenBalanceRow{}, err
	}
	return TokenBalanceRow{
		Plan: balance.Plan, QuotaTokens: balance.QuotaTokens, UsedTokens: balance.UsedTokens,
		RemainingTokens: balance.RemainingTokens, PeriodStart: balance.PeriodStart, PeriodEnd: balance.PeriodEnd,
	}, nil
}

func (r *BillingRepo) ListPlans(ctx context.Context) ([]PlanRow, error) {
	var rows []PlanRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, name, price, currency, monthly_token_quota, model_level, max_rpm
		FROM billing.plans
		WHERE is_active = true
		ORDER BY price ASC
	`).Scan(&rows).Error
	return rows, err
}

func (r *BillingRepo) GetSubscription(ctx context.Context, userID string) (SubscriptionRow, error) {
	var row SubscriptionRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT
			sub.id::text AS id,
			sub.user_id::text AS user_id,
			sub.plan_id::text AS plan_id,
			plan.code AS plan_code,
			sub.status,
			sub.current_period_start::text AS current_period_start,
			sub.current_period_end::text AS current_period_end,
			sub.cancel_at_period_end,
			COALESCE(sub.canceled_at::text, '') AS canceled_at
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
		WHERE sub.user_id = ?::uuid AND sub.status = 'active'
		ORDER BY sub.created_at DESC
		LIMIT 1
	`, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return SubscriptionRow{}, status.Error(codes.NotFound, "subscription not found")
	}
	return row, nil
}

func (r *BillingRepo) CreateCheckout(ctx context.Context, userID string, planCode string, provider string) (CheckoutResult, error) {
	var plan struct {
		ID    string
		Code  string
		Price float64
	}
	if err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, price
		FROM billing.plans
		WHERE code = ? AND is_active = true
		LIMIT 1
	`, planCode).Scan(&plan).Error; err != nil || plan.ID == "" {
		return CheckoutResult{}, status.Error(codes.NotFound, "plan not found")
	}
	orderID := platform.NewUUID()
	eventID := platform.NewUUID()
	traceID := platform.TraceID(ctx)
	event := map[string]any{"order_id": orderID, "user_id": userID, "plan": plan.Code, "channel": provider, "amount": plan.Price, "trace_id": traceID}
	raw, err := json.Marshal(event)
	if err != nil {
		return CheckoutResult{}, err
	}
	err = r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			INSERT INTO billing.orders (id, user_id, plan_id, amount, currency, status, provider, provider_order_id)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, 'CNY', 'pending', ?, ?)
		`, orderID, userID, plan.ID, plan.Price, provider, orderID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO billing.outbox_events (id, aggregate_type, aggregate_id, event_type, trace_id, payload)
			VALUES (?::uuid, 'billing.order', ?::uuid, 'billing.checkout.created', ?, ?::jsonb)
		`, eventID, orderID, traceID, string(raw)).Error
	})
	if err != nil {
		return CheckoutResult{}, err
	}
	return CheckoutResult{OrderID: orderID, PlanID: plan.Code, Provider: provider, Status: "pending", PaymentURL: "simulated://payments/orders/" + orderID}, nil
}

func (r *BillingRepo) ConfirmSandboxPayment(ctx context.Context, userID string, checkoutID string) (SandboxPaymentResult, error) {
	return r.ConfirmSimulatedPayment(ctx, userID, checkoutID)
}

func (r *BillingRepo) ConfirmSimulatedPayment(ctx context.Context, userID string, checkoutID string) (SimulatedPaymentResult, error) {
	var out SandboxPaymentResult
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var order struct {
			ID             string
			PlanID         string
			Amount         float64
			Currency       string
			Status         string
			SubscriptionID string
			QuotaTokens    int64
			PlanCode       string
		}
		if err := tx.Raw(`
			SELECT
				o.id::text AS id,
				o.plan_id::text AS plan_id,
				o.amount,
				o.currency,
				o.status,
				COALESCE(o.subscription_id::text, '') AS subscription_id,
				p.monthly_token_quota AS quota_tokens,
				p.code AS plan_code
			FROM billing.orders o
			JOIN billing.plans p ON p.id = o.plan_id
			WHERE o.id = ?::uuid AND o.user_id = ?::uuid
			LIMIT 1
			FOR UPDATE OF o
		`, checkoutID, userID).Scan(&order).Error; err != nil {
			return err
		}
		if order.ID == "" {
			return status.Error(codes.NotFound, "checkout not found")
		}
		if order.Status == "paid" && order.SubscriptionID != "" {
			sub, err := loadSubscriptionByID(ctx, tx, order.SubscriptionID)
			if err != nil {
				return err
			}
			out = SandboxPaymentResult{
				OrderID: order.ID, Status: "paid", Subscription: sub,
				QuotaTokens: order.QuotaTokens, PeriodStart: sub.CurrentPeriodStart, PeriodEnd: sub.CurrentPeriodEnd,
			}
			return nil
		}
		if order.Status != "pending" {
			return status.Errorf(codes.FailedPrecondition, "checkout status %s cannot be confirmed", order.Status)
		}
		now := time.Now().UTC()
		periodEnd := now.AddDate(0, 1, 0)
		subscriptionID := platform.NewUUID()
		paymentID := platform.NewUUID()
		webhookEventID := platform.NewUUID()
		outboxEventID := platform.NewUUID()
		providerEventID := "simulated_" + order.ID
		rawPayload, err := json.Marshal(map[string]any{"checkout_id": order.ID, "provider": "simulated", "confirmed_at": now.Format(time.RFC3339)})
		if err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE billing.subscriptions SET status = 'superseded', updated_at = now() WHERE user_id = ?::uuid AND status = 'active'`, userID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.webhook_events (id, provider, provider_event_id, processed_at, raw_payload)
			VALUES (?::uuid, 'simulated', ?, now(), ?::jsonb)
			ON CONFLICT (provider, provider_event_id) DO UPDATE SET processed_at = COALESCE(billing.webhook_events.processed_at, now())
		`, webhookEventID, providerEventID, string(rawPayload)).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.subscriptions (id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end)
			VALUES (?::uuid, ?::uuid, ?::uuid, 'simulated', ?, 'quota_pending', ?, ?)
		`, subscriptionID, userID, order.PlanID, "simulated_"+subscriptionID, now, periodEnd).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE billing.orders SET status = 'paid', paid_at = now(), updated_at = now(), subscription_id = ?::uuid WHERE id = ?::uuid`, subscriptionID, order.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.payments (id, user_id, order_id, provider, provider_payment_id, amount, currency, status, raw_payload)
			VALUES (?::uuid, ?::uuid, ?::uuid, 'simulated', ?, ?, ?, 'paid', ?::jsonb)
		`, paymentID, userID, order.ID, providerEventID, order.Amount, order.Currency, string(rawPayload)).Error; err != nil {
			return err
		}
		traceID := platform.TraceID(ctx)
		eventPayload, err := json.Marshal(map[string]any{
			"event_id": outboxEventID, "event_type": "payment.succeeded.v1", "version": 1,
			"order_id": order.ID, "subscription_id": subscriptionID, "user_id": userID,
			"plan": order.PlanCode, "provider": "simulated", "trace_id": traceID, "occurred_at": now.Format(time.RFC3339),
		})
		if err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.outbox_events (id, aggregate_type, aggregate_id, event_type, version, trace_id, occurred_at, payload)
			VALUES (?::uuid, 'billing.payment', ?::uuid, 'payment.succeeded.v1', 1, ?, ?, ?::jsonb)
		`, outboxEventID, paymentID, traceID, now, string(eventPayload)).Error; err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, subscriptionID)
		if err != nil {
			return err
		}
		out = SandboxPaymentResult{
			OrderID: order.ID, Status: "paid", Subscription: sub,
			QuotaTokens: order.QuotaTokens, PeriodStart: now.Format(time.RFC3339), PeriodEnd: periodEnd.Format(time.RFC3339),
		}
		return nil
	})
	return out, err
}

func (r *BillingRepo) MarkSubscriptionActive(ctx context.Context, subscriptionID string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscriptions
		SET status = 'active', activation_error = NULL, quota_provisioned_at = now(), updated_at = now()
		WHERE id = ?::uuid
	`, subscriptionID).Error
}

func (r *BillingRepo) MarkSubscriptionActivationFailed(ctx context.Context, subscriptionID string, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscriptions
		SET status = 'activation_failed', activation_error = ?, updated_at = now()
		WHERE id = ?::uuid
	`, reason, subscriptionID).Error
}

func (r *BillingRepo) ListOrders(ctx context.Context, userID string) ([]OrderRow, error) {
	var rows []OrderRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT o.id::text AS id, o.user_id::text AS user_id, o.plan_id::text AS plan_id, p.code AS plan_code,
		       o.provider, o.status, o.amount::text AS amount, o.currency,
		       'simulated://payments/orders/' || o.id::text AS payment_url,
		       o.created_at::text AS created_at, COALESCE(o.paid_at::text, '') AS paid_at,
		       COALESCE(o.subscription_id::text, '') AS subscription_id
		FROM billing.orders o
		JOIN billing.plans p ON p.id = o.plan_id
		WHERE o.user_id = ?::uuid
		ORDER BY o.created_at DESC
		LIMIT 50
	`, userID).Scan(&rows).Error
	return rows, err
}

func (r *BillingRepo) GetOrder(ctx context.Context, userID string, orderID string) (OrderRow, error) {
	var row OrderRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT o.id::text AS id, o.user_id::text AS user_id, o.plan_id::text AS plan_id, p.code AS plan_code,
		       o.provider, o.status, o.amount::text AS amount, o.currency,
		       'simulated://payments/orders/' || o.id::text AS payment_url,
		       o.created_at::text AS created_at, COALESCE(o.paid_at::text, '') AS paid_at,
		       COALESCE(o.subscription_id::text, '') AS subscription_id
		FROM billing.orders o
		JOIN billing.plans p ON p.id = o.plan_id
		WHERE o.id = ?::uuid AND o.user_id = ?::uuid
		LIMIT 1
	`, orderID, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return OrderRow{}, status.Error(codes.NotFound, "order not found")
	}
	return row, nil
}

func (r *BillingRepo) CancelSubscription(ctx context.Context, userID string, subscriptionID string, immediate bool) (SubscriptionRow, error) {
	statusValue := "active"
	if immediate {
		statusValue = "canceled"
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscriptions
		SET cancel_at_period_end = ?, canceled_at = now(), status = ?, updated_at = now()
		WHERE id = ?::uuid AND user_id = ?::uuid AND status IN ('active', 'quota_pending', 'activation_failed')
	`, !immediate, statusValue, subscriptionID, userID).Error; err != nil {
		return SubscriptionRow{}, err
	}
	return loadSubscriptionByID(ctx, r.data.DB, subscriptionID)
}

func loadSubscription(ctx context.Context, tx *gorm.DB, userID string) (SubscriptionRow, error) {
	var sub SubscriptionRow
	if err := tx.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id, plan.code AS plan_code,
		       sub.status, sub.current_period_start::text AS current_period_start, sub.current_period_end::text AS current_period_end
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
		WHERE sub.user_id = ?::uuid AND sub.status = 'active'
		ORDER BY sub.created_at DESC
		LIMIT 1
	`, userID).Scan(&sub).Error; err != nil {
		return SubscriptionRow{}, err
	}
	if sub.ID == "" {
		return SubscriptionRow{}, status.Error(codes.NotFound, "subscription not found")
	}
	return sub, nil
}

func loadSubscriptionByID(ctx context.Context, tx *gorm.DB, subscriptionID string) (SubscriptionRow, error) {
	var sub SubscriptionRow
	if err := tx.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id, plan.code AS plan_code,
		       sub.status, sub.current_period_start::text AS current_period_start, sub.current_period_end::text AS current_period_end,
		       sub.cancel_at_period_end, COALESCE(sub.canceled_at::text, '') AS canceled_at
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
		WHERE sub.id = ?::uuid
		LIMIT 1
	`, subscriptionID).Scan(&sub).Error; err != nil {
		return SubscriptionRow{}, err
	}
	if sub.ID == "" {
		return SubscriptionRow{}, status.Error(codes.NotFound, "subscription not found")
	}
	return sub, nil
}
