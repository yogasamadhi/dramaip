package data

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/activation"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
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

// PlanSnapshot is the immutable entitlement captured when a checkout is
// created. It is copied to the subscription and every quota period account so
// historical rights never need to be reconstructed from billing.plans.
type PlanSnapshot struct {
	Code              string
	Name              string
	BillingPeriod     string
	Price             string
	Currency          string
	MonthlyTokenQuota int64
	MaxRPM            int64
	MaxContextTokens  int64
	ModelLevel        string
	Source            string
	At                string
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
	PlanName           string
	BillingPeriod      string
	PlanPrice          string
	Currency           string
	MonthlyTokenQuota  int64
	MaxRPM             int64
	MaxContextTokens   int64
	ModelLevel         string
	PlanSnapshotSource string
	PlanSnapshotAt     string
}

func (row SubscriptionRow) PlanSnapshot() PlanSnapshot {
	return PlanSnapshot{
		Code: row.PlanCode, Name: row.PlanName, BillingPeriod: row.BillingPeriod,
		Price: row.PlanPrice, Currency: row.Currency, MonthlyTokenQuota: row.MonthlyTokenQuota,
		MaxRPM: row.MaxRPM, MaxContextTokens: row.MaxContextTokens, ModelLevel: row.ModelLevel,
		Source: row.PlanSnapshotSource, At: row.PlanSnapshotAt,
	}
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
	db, err := platform.OpenDomainPostgres(context.Background(), "billing")
	if err != nil {
		return nil, nil, err
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Quota.DialTimeout, 10*time.Second))
	defer cancel()
	quotaConn, err := platform.DialGRPC(dialCtx, cfg.Quota.GRPCEndpoint, cfg.MTLS)
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
			const healthUserID = "00000000-0000-4000-8000-000000000001"
			_, err := r.data.Quota.GetTokenBalance(platform.WithUserIdentity(ctx, healthUserID), &quotav1.GetTokenBalanceRequest{UserId: healthUserID})
			return err
		},
	}
}

func (r *BillingRepo) CreatePeriodAccount(ctx context.Context, userID string, subscriptionID string, snapshot PlanSnapshot, periodStart string, periodEnd string) (TokenBalanceRow, error) {
	if _, err := r.data.Quota.CreatePeriodAccount(ctx, &quotav1.CreatePeriodAccountRequest{
		UserId: userID, SubscriptionId: subscriptionID, QuotaTokens: snapshot.MonthlyTokenQuota,
		PeriodStart: periodStart, PeriodEnd: periodEnd, PlanCode: snapshot.Code,
		PlanName: snapshot.Name, BillingPeriod: snapshot.BillingPeriod, PlanPrice: snapshot.Price,
		Currency: snapshot.Currency, MaxRpm: snapshot.MaxRPM, MaxContextTokens: snapshot.MaxContextTokens,
		ModelLevel: snapshot.ModelLevel, PlanSnapshotSource: snapshot.Source, PlanSnapshotAt: snapshot.At,
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
			sub.plan_code,
			sub.plan_name,
			sub.billing_period,
			sub.plan_price::text AS plan_price,
			sub.currency,
			sub.monthly_token_quota,
			sub.max_rpm,
			sub.max_context_tokens,
			sub.model_level,
			sub.plan_snapshot_source,
			sub.plan_snapshot_at::text AS plan_snapshot_at,
			sub.status,
			sub.current_period_start::text AS current_period_start,
			sub.current_period_end::text AS current_period_end,
			sub.cancel_at_period_end,
			COALESCE(sub.canceled_at::text, '') AS canceled_at
		FROM billing.subscriptions sub
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
		ID                string
		Code              string
		Name              string
		BillingPeriod     string
		Price             string
		Currency          string
		MonthlyTokenQuota int64
		MaxRPM            int64
		MaxContextTokens  int64
		ModelLevel        string
	}
	if err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, name, billing_period, price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.plans
		WHERE code = ? AND is_active = true
		LIMIT 1
	`, planCode).Scan(&plan).Error; err != nil || plan.ID == "" {
		return CheckoutResult{}, status.Error(codes.NotFound, "plan not found")
	}
	orderID := platform.NewUUID()
	eventID := platform.NewUUID()
	traceID := platform.TraceID(ctx)
	now := time.Now().UTC()
	eventPayload, err := events.MarshalEnvelope(events.NewCheckoutCreated(eventID, traceID, now, &billingeventsv1.CheckoutCreated{
		OrderId:  orderID,
		UserId:   userID,
		PlanCode: plan.Code,
		Provider: provider,
		Amount:   plan.Price,
		Currency: plan.Currency,
	}))
	if err != nil {
		return CheckoutResult{}, err
	}
	err = r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			INSERT INTO billing.orders (
				id, user_id, plan_id, amount, currency, status, provider, provider_order_id,
				plan_code, plan_name, billing_period, plan_price, monthly_token_quota,
				max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at
			)
			VALUES (
				?::uuid, ?::uuid, ?::uuid, ?::numeric, ?, 'pending', ?, ?,
				?, ?, ?, ?::numeric, ?, ?, ?, ?, 'checkout', ?
			)
		`, orderID, userID, plan.ID, plan.Price, plan.Currency, provider, orderID,
			plan.Code, plan.Name, plan.BillingPeriod, plan.Price, plan.MonthlyTokenQuota,
			plan.MaxRPM, plan.MaxContextTokens, plan.ModelLevel, now).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO billing.outbox_events (id, aggregate_type, aggregate_id, event_type, version, trace_id, occurred_at, payload)
			VALUES (?::uuid, 'billing.order', ?::uuid, 'billing.checkout.created.v1', 1, ?, ?, ?::jsonb)
		`, eventID, orderID, traceID, now, string(eventPayload)).Error
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
			ID                 string
			PlanID             string
			Amount             float64
			Currency           string
			Status             string
			SubscriptionID     string
			PlanCode           string
			PlanName           string
			BillingPeriod      string
			PlanPrice          string
			QuotaTokens        int64
			MaxRPM             int64
			MaxContextTokens   int64
			ModelLevel         string
			PlanSnapshotSource string
			PlanSnapshotAt     string
		}
		if err := tx.Raw(`
			SELECT
				o.id::text AS id,
				o.plan_id::text AS plan_id,
				o.amount,
				o.currency,
				o.status,
				COALESCE(o.subscription_id::text, '') AS subscription_id,
				o.plan_code,
				o.plan_name,
				o.billing_period,
				o.plan_price::text AS plan_price,
				o.monthly_token_quota AS quota_tokens,
				o.max_rpm,
				o.max_context_tokens,
				o.model_level,
				o.plan_snapshot_source,
				o.plan_snapshot_at::text AS plan_snapshot_at
			FROM billing.orders o
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
			INSERT INTO billing.subscriptions (
				id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end,
				plan_code, plan_name, billing_period, plan_price, currency, monthly_token_quota,
				max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at
			)
			VALUES (
				?::uuid, ?::uuid, ?::uuid, 'simulated', ?, 'quota_pending', ?, ?,
				?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, ?, ?::timestamptz
			)
		`, subscriptionID, userID, order.PlanID, "simulated_"+subscriptionID, now, periodEnd,
			order.PlanCode, order.PlanName, order.BillingPeriod, order.PlanPrice, order.Currency, order.QuotaTokens,
			order.MaxRPM, order.MaxContextTokens, order.ModelLevel, order.PlanSnapshotSource, order.PlanSnapshotAt).Error; err != nil {
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
		eventPayload, err := events.MarshalEnvelope(events.NewPaymentSucceeded(outboxEventID, traceID, now, &billingeventsv1.PaymentSucceeded{
			PaymentId:      paymentID,
			OrderId:        order.ID,
			SubscriptionId: subscriptionID,
			UserId:         userID,
			PlanCode:       order.PlanCode,
			Provider:       "simulated",
			Amount:         strconv.FormatFloat(order.Amount, 'f', 2, 64),
			Currency:       order.Currency,
		}))
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

func (r *BillingRepo) ActivateSubscription(ctx context.Context, subscriptionID string) error {
	return activation.ActivateSubscription(ctx, r.data.DB, subscriptionID)
}

func (r *BillingRepo) MarkSubscriptionActivationFailed(ctx context.Context, subscriptionID string, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscriptions
		SET status = 'activation_failed', activation_error = ?, updated_at = now()
		WHERE id = ?::uuid AND status IN ('quota_pending', 'activation_failed')
	`, reason, subscriptionID).Error
}

func (r *BillingRepo) ListOrders(ctx context.Context, userID string) ([]OrderRow, error) {
	var rows []OrderRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT o.id::text AS id, o.user_id::text AS user_id, o.plan_id::text AS plan_id, o.plan_code,
		       o.provider, o.status, o.amount::text AS amount, o.currency,
		       'simulated://payments/orders/' || o.id::text AS payment_url,
		       o.created_at::text AS created_at, COALESCE(o.paid_at::text, '') AS paid_at,
		       COALESCE(o.subscription_id::text, '') AS subscription_id
		FROM billing.orders o
		WHERE o.user_id = ?::uuid
		ORDER BY o.created_at DESC
		LIMIT 50
	`, userID).Scan(&rows).Error
	return rows, err
}

func (r *BillingRepo) GetOrder(ctx context.Context, userID string, orderID string) (OrderRow, error) {
	var row OrderRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT o.id::text AS id, o.user_id::text AS user_id, o.plan_id::text AS plan_id, o.plan_code,
		       o.provider, o.status, o.amount::text AS amount, o.currency,
		       'simulated://payments/orders/' || o.id::text AS payment_url,
		       o.created_at::text AS created_at, COALESCE(o.paid_at::text, '') AS paid_at,
		       COALESCE(o.subscription_id::text, '') AS subscription_id
		FROM billing.orders o
		WHERE o.id = ?::uuid AND o.user_id = ?::uuid
		LIMIT 1
	`, orderID, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return OrderRow{}, status.Error(codes.NotFound, "order not found")
	}
	return row, nil
}

func (r *BillingRepo) CancelSubscription(ctx context.Context, userID string, subscriptionID string, immediate bool) (SubscriptionRow, error) {
	if err := r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscriptions
		SET cancel_at_period_end = ?,
		    canceled_at = now(),
		    status = CASE WHEN ? THEN 'canceled' ELSE status END,
		    updated_at = now()
		WHERE id = ?::uuid AND user_id = ?::uuid AND status IN ('active', 'quota_pending', 'activation_failed')
	`, !immediate, immediate, subscriptionID, userID).Error; err != nil {
		return SubscriptionRow{}, err
	}
	return loadSubscriptionByID(ctx, r.data.DB, subscriptionID)
}

func loadSubscription(ctx context.Context, tx *gorm.DB, userID string) (SubscriptionRow, error) {
	var sub SubscriptionRow
	if err := tx.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id,
		       sub.plan_code, sub.plan_name, sub.billing_period, sub.plan_price::text AS plan_price,
		       sub.currency, sub.monthly_token_quota, sub.max_rpm, sub.max_context_tokens, sub.model_level,
		       sub.plan_snapshot_source, sub.plan_snapshot_at::text AS plan_snapshot_at,
		       sub.status, sub.current_period_start::text AS current_period_start, sub.current_period_end::text AS current_period_end
		FROM billing.subscriptions sub
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
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id,
		       sub.plan_code, sub.plan_name, sub.billing_period, sub.plan_price::text AS plan_price,
		       sub.currency, sub.monthly_token_quota, sub.max_rpm, sub.max_context_tokens, sub.model_level,
		       sub.plan_snapshot_source, sub.plan_snapshot_at::text AS plan_snapshot_at,
		       sub.status, sub.current_period_start::text AS current_period_start, sub.current_period_end::text AS current_period_end,
		       sub.cancel_at_period_end, COALESCE(sub.canceled_at::text, '') AS canceled_at
		FROM billing.subscriptions sub
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
