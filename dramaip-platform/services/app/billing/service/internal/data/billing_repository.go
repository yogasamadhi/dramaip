package data

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
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
	Code              string `json:"code"`
	Name              string `json:"name"`
	BillingPeriod     string `json:"billing_period"`
	Price             string `json:"price"`
	Currency          string `json:"currency"`
	MonthlyTokenQuota int64  `json:"monthly_token_quota"`
	MaxRPM            int64  `json:"max_rpm"`
	MaxContextTokens  int64  `json:"max_context_tokens"`
	ModelLevel        string `json:"model_level"`
	Source            string `json:"source"`
	At                string `json:"at"`
}

type SubscriptionRow struct {
	ID                 string
	UserID             string
	PlanID             string
	PlanCode           string
	Provider           string
	Status             string
	CurrentPeriodStart string
	CurrentPeriodEnd   string
	CancelAtPeriodEnd  bool
	CanceledAt         string
	ScheduledPlanCode  string
	ScheduledChangeAt  string
	LifecycleError     string
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

// WechatWebhookEvent keeps the signed transport boundary intact for audit and
// reconciliation. RawBody is stored separately from the JSON payload so a
// future verifier can reproduce exactly what the provider signed.
type WechatWebhookEvent struct {
	ProviderEventID       string
	ProviderOrderID       string
	ProviderTransactionID string
	RawBody               []byte
	SignatureTimestamp    string
	SignatureNonce        string
	SignatureSerial       string
}

type WechatWebhookReceipt struct {
	Processed bool
}

// AlipayWebhookEvent stores the signed form separately from a minimized JSON
// audit payload. Alipay forms can include buyer-facing fields, so raw_body is
// retained for audit while JSON columns avoid copying unnecessary PII.
type AlipayWebhookEvent struct {
	ProviderEventID       string
	ProviderOrderID       string
	ProviderTransactionID string
	RawBody               []byte
	AuditPayload          []byte
	NotifyTime            string
	SignType              string
}

type AlipayWebhookReceipt struct {
	Processed bool
}

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
			return platform.NormalizeHealthProbeError(err)
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
			, COALESCE(sub.scheduled_plan_snapshot ->> 'code', '') AS scheduled_plan_code
			, COALESCE(sub.scheduled_change_at::text, '') AS scheduled_change_at
			, COALESCE(sub.lifecycle_error, '') AS lifecycle_error
			, sub.provider
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
	return r.createCheckout(ctx, userID, planCode, provider, platform.NewUUID(), "")
}

// CreateWechatCheckout persists the local side of an already accepted WeChat
// native order. providerOrderID is deliberately distinct from the UUID primary
// key because WeChat's out_trade_no has a tighter length limit.
func (r *BillingRepo) CreateWechatCheckout(ctx context.Context, userID string, planCode string, orderID string, providerOrderID string) (CheckoutResult, error) {
	return r.createCheckout(ctx, userID, planCode, "wechat_pay", orderID, providerOrderID)
}

// CreateAlipayCheckout persists the local side of an already accepted Alipay
// precreate order. Alipay accepts the UUID-shaped merchant out_trade_no.
func (r *BillingRepo) CreateAlipayCheckout(ctx context.Context, userID string, planCode string, orderID string, providerOrderID string) (CheckoutResult, error) {
	return r.createCheckout(ctx, userID, planCode, "alipay", orderID, providerOrderID)
}

func (r *BillingRepo) createCheckout(ctx context.Context, userID string, planCode string, provider string, orderID string, providerOrderID string) (CheckoutResult, error) {
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
	if orderID == "" {
		return CheckoutResult{}, status.Error(codes.InvalidArgument, "checkout order id is required")
	}
	if providerOrderID == "" {
		providerOrderID = orderID
	}
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
	`, orderID, userID, plan.ID, plan.Price, plan.Currency, provider, providerOrderID,
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
	return r.confirmProviderPayment(ctx, userID, checkoutID, "simulated", "", "", 0, "", nil)
}

// ConfirmWechatPayment is called only after the webhook ingress has verified
// the raw V3 signature and independently confirmed the provider transaction.
// providerOrderID is WeChat's out_trade_no, not the local UUID primary key.
func (r *BillingRepo) ConfirmWechatPayment(ctx context.Context, providerOrderID, providerEventID, providerTransactionID string, totalCents int64, currency string, rawPayload []byte) (SimulatedPaymentResult, error) {
	return r.confirmProviderPayment(ctx, "", providerOrderID, "wechat_pay", providerEventID, providerTransactionID, totalCents, currency, rawPayload)
}

func (r *BillingRepo) ConfirmAlipayPayment(ctx context.Context, providerOrderID, providerEventID, providerTransactionID string, totalCents int64, currency string, rawPayload []byte) (SimulatedPaymentResult, error) {
	return r.confirmProviderPayment(ctx, "", providerOrderID, "alipay", providerEventID, providerTransactionID, totalCents, currency, rawPayload)
}

// RecordWechatWebhook writes the verified provider event before any outbound
// reconciliation. The provider event id is the idempotency key; a processed
// duplicate can be acknowledged immediately without replaying the saga.
func (r *BillingRepo) RecordWechatWebhook(ctx context.Context, event WechatWebhookEvent) (WechatWebhookReceipt, error) {
	var receipt struct {
		Processed bool
	}
	err := r.data.DB.WithContext(ctx).Raw(`
		INSERT INTO billing.webhook_events (
			id, provider, provider_event_id, raw_payload, raw_body, received_at,
			signature_timestamp, signature_nonce, signature_serial, verification_status,
			provider_order_id, provider_transaction_id
		)
		VALUES (?::uuid, 'wechat_pay', ?, ?::jsonb, ?, now(), ?, ?, ?, 'received', ?, ?)
		ON CONFLICT (provider, provider_event_id) DO UPDATE
		SET received_at = now()
		RETURNING processed_at IS NOT NULL AS processed
	`, platform.NewUUID(), event.ProviderEventID, string(event.RawBody), event.RawBody,
		event.SignatureTimestamp, event.SignatureNonce, event.SignatureSerial,
		event.ProviderOrderID, event.ProviderTransactionID).Scan(&receipt).Error
	if err != nil {
		return WechatWebhookReceipt{}, err
	}
	return WechatWebhookReceipt{Processed: receipt.Processed}, nil
}

func (r *BillingRepo) RecordAlipayWebhook(ctx context.Context, event AlipayWebhookEvent) (AlipayWebhookReceipt, error) {
	var receipt struct {
		Processed bool
	}
	if len(event.AuditPayload) == 0 {
		event.AuditPayload = []byte(`{}`)
	}
	err := r.data.DB.WithContext(ctx).Raw(`
		INSERT INTO billing.webhook_events (
			id, provider, provider_event_id, raw_payload, raw_body, received_at,
			signature_timestamp, signature_serial, verification_status,
			provider_order_id, provider_transaction_id
		)
		VALUES (?::uuid, 'alipay', ?, ?::jsonb, ?, now(), ?, ?, 'received', ?, ?)
		ON CONFLICT (provider, provider_event_id) DO UPDATE
		SET received_at = now()
		RETURNING processed_at IS NOT NULL AS processed
	`, platform.NewUUID(), event.ProviderEventID, string(event.AuditPayload), event.RawBody,
		event.NotifyTime, event.SignType, event.ProviderOrderID, event.ProviderTransactionID).Scan(&receipt).Error
	if err != nil {
		return AlipayWebhookReceipt{}, err
	}
	return AlipayWebhookReceipt{Processed: receipt.Processed}, nil
}

func (r *BillingRepo) MarkWechatWebhookQueryFailed(ctx context.Context, providerEventID string, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.webhook_events
		SET verification_status = 'query_pending', verification_error = ?
		WHERE provider = 'wechat_pay' AND provider_event_id = ?
	`, reason, providerEventID).Error
}

func (r *BillingRepo) MarkWechatWebhookQueryConfirmed(ctx context.Context, providerEventID string, queryPayload []byte) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.webhook_events
		SET verification_status = 'query_confirmed', verification_error = NULL,
		    query_payload = ?::jsonb, query_confirmed_at = now()
		WHERE provider = 'wechat_pay' AND provider_event_id = ?
	`, string(queryPayload), providerEventID).Error
}

func (r *BillingRepo) MarkAlipayWebhookQueryFailed(ctx context.Context, providerEventID string, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.webhook_events
		SET verification_status = 'query_pending', verification_error = ?
		WHERE provider = 'alipay' AND provider_event_id = ?
	`, reason, providerEventID).Error
}

func (r *BillingRepo) MarkAlipayWebhookQueryConfirmed(ctx context.Context, providerEventID string, queryPayload []byte) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.webhook_events
		SET verification_status = 'query_confirmed', verification_error = NULL,
		    query_payload = ?::jsonb, query_confirmed_at = now()
		WHERE provider = 'alipay' AND provider_event_id = ?
	`, string(queryPayload), providerEventID).Error
}

func (r *BillingRepo) confirmProviderPayment(ctx context.Context, userID string, checkoutID string, provider string, providerEventID string, providerPaymentID string, providerTotalCents int64, providerCurrency string, providerRawPayload []byte) (SimulatedPaymentResult, error) {
	var out SandboxPaymentResult
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var order struct {
			ID                 string
			UserID             string
			PlanID             string
			Amount             float64
			Currency           string
			Status             string
			Provider           string
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
				o.user_id::text AS user_id,
				o.plan_id::text AS plan_id,
				o.amount,
				o.currency,
				o.status,
				o.provider,
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
			WHERE (
				(? = 'simulated' AND o.id::text = ?)
				OR (? <> 'simulated' AND o.provider_order_id = ?)
			) AND (? = '' OR o.user_id::text = ?)
			LIMIT 1
			FOR UPDATE OF o
		`, provider, checkoutID, provider, checkoutID, userID, userID).Scan(&order).Error; err != nil {
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
		if order.Provider != provider {
			return status.Errorf(codes.FailedPrecondition, "checkout provider %s does not match %s", order.Provider, provider)
		}
		if provider == "wechat_pay" || provider == "alipay" {
			expectedCents := int64(math.Round(order.Amount * 100))
			if providerTotalCents != expectedCents || providerCurrency != order.Currency {
				return status.Errorf(codes.FailedPrecondition, "%s confirmation amount or currency does not match checkout", provider)
			}
		}
		now := time.Now().UTC()
		periodEnd := now.AddDate(0, 1, 0)
		subscriptionID := platform.NewUUID()
		paymentID := platform.NewUUID()
		webhookEventID := platform.NewUUID()
		outboxEventID := platform.NewUUID()
		if providerEventID == "" {
			providerEventID = "simulated_" + order.ID
		}
		if providerPaymentID == "" {
			providerPaymentID = providerEventID
		}
		rawPayload := providerRawPayload
		if len(rawPayload) == 0 {
			var err error
			rawPayload, err = json.Marshal(map[string]any{"checkout_id": order.ID, "provider": provider, "confirmed_at": now.Format(time.RFC3339)})
			if err != nil {
				return err
			}
		}
		if err := tx.Exec(`UPDATE billing.subscriptions SET status = 'superseded', updated_at = now() WHERE user_id = ?::uuid AND status = 'active'`, order.UserID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.webhook_events (id, provider, provider_event_id, processed_at, raw_payload)
			VALUES (?::uuid, ?, ?, now(), ?::jsonb)
			ON CONFLICT (provider, provider_event_id) DO UPDATE
			SET processed_at = COALESCE(billing.webhook_events.processed_at, now()),
			    verification_status = CASE WHEN billing.webhook_events.provider IN ('wechat_pay', 'alipay') THEN 'processed' ELSE billing.webhook_events.verification_status END
		`, webhookEventID, provider, providerEventID, string(rawPayload)).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.subscriptions (
				id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end,
				plan_code, plan_name, billing_period, plan_price, currency, monthly_token_quota,
				max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at
			)
			VALUES (
				?::uuid, ?::uuid, ?::uuid, ?, ?, 'quota_pending', ?, ?,
				?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, ?, ?::timestamptz
			)
		`, subscriptionID, order.UserID, order.PlanID, provider, provider+"_"+subscriptionID, now, periodEnd,
			order.PlanCode, order.PlanName, order.BillingPeriod, order.PlanPrice, order.Currency, order.QuotaTokens,
			order.MaxRPM, order.MaxContextTokens, order.ModelLevel, order.PlanSnapshotSource, order.PlanSnapshotAt).Error; err != nil {
			return err
		}
		if err := insertSubscriptionPeriod(tx, subscriptionID, order.UserID, order.ID, order.PlanID, PlanSnapshot{
			Code: order.PlanCode, Name: order.PlanName, BillingPeriod: order.BillingPeriod,
			Price: order.PlanPrice, Currency: order.Currency, MonthlyTokenQuota: order.QuotaTokens,
			MaxRPM: order.MaxRPM, MaxContextTokens: order.MaxContextTokens, ModelLevel: order.ModelLevel,
			Source: order.PlanSnapshotSource, At: order.PlanSnapshotAt,
		}, now, periodEnd, "quota_pending", "initial_payment"); err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE billing.orders SET status = 'paid', paid_at = now(), updated_at = now(), subscription_id = ?::uuid WHERE id = ?::uuid`, subscriptionID, order.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.payments (id, user_id, order_id, provider, provider_payment_id, amount, currency, status, raw_payload)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, 'paid', ?::jsonb)
		`, paymentID, order.UserID, order.ID, provider, providerPaymentID, order.Amount, order.Currency, string(rawPayload)).Error; err != nil {
			return err
		}
		traceID := platform.TraceID(ctx)
		eventPayload, err := events.MarshalEnvelope(events.NewPaymentSucceeded(outboxEventID, traceID, now, &billingeventsv1.PaymentSucceeded{
			PaymentId:      paymentID,
			OrderId:        order.ID,
			SubscriptionId: subscriptionID,
			UserId:         order.UserID,
			PlanCode:       order.PlanCode,
			Provider:       provider,
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
	var out SubscriptionRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSubscription(ctx, tx, userID, subscriptionID); err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, subscriptionID)
		if err != nil {
			return err
		}
		if sub.Status != "active" && sub.Status != "quota_pending" && sub.Status != "activation_failed" {
			return status.Errorf(codes.FailedPrecondition, "subscription status %s cannot be canceled", sub.Status)
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET cancel_at_period_end = ?,
			    canceled_at = CASE WHEN ? THEN now() ELSE NULL END,
			    status = CASE WHEN ? THEN 'canceled' ELSE status END,
			    updated_at = now()
			WHERE id = ?::uuid
		`, !immediate, immediate, immediate, sub.ID).Error; err != nil {
			return err
		}
		changeState := "scheduled"
		if immediate {
			changeState = "applied"
			if err := tx.Exec(`
				UPDATE billing.subscription_periods
				SET status = 'canceled', ended_at = now(), updated_at = now()
				WHERE subscription_id = ?::uuid AND period_start = ?::timestamptz
			`, sub.ID, sub.CurrentPeriodStart).Error; err != nil {
				return err
			}
		}
		if err := insertLifecycleChange(tx, sub.ID, userID, "cancel", changeState, fmt.Sprintf("cancel:%t:%s", immediate, sub.CurrentPeriodStart), time.Now().UTC(), map[string]bool{"immediate": immediate}); err != nil {
			return err
		}
		out, err = loadSubscriptionByID(ctx, tx, sub.ID)
		return err
	})
	return out, err
}

func loadSubscription(ctx context.Context, tx *gorm.DB, userID string) (SubscriptionRow, error) {
	var sub SubscriptionRow
	if err := tx.WithContext(ctx).Raw(`
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id, sub.provider,
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
		SELECT sub.id::text AS id, sub.user_id::text AS user_id, sub.plan_id::text AS plan_id, sub.provider,
		       sub.plan_code, sub.plan_name, sub.billing_period, sub.plan_price::text AS plan_price,
		       sub.currency, sub.monthly_token_quota, sub.max_rpm, sub.max_context_tokens, sub.model_level,
		       sub.plan_snapshot_source, sub.plan_snapshot_at::text AS plan_snapshot_at,
		       sub.status, sub.current_period_start::text AS current_period_start, sub.current_period_end::text AS current_period_end,
		       sub.cancel_at_period_end, COALESCE(sub.canceled_at::text, '') AS canceled_at,
		       COALESCE(sub.scheduled_plan_snapshot ->> 'code', '') AS scheduled_plan_code,
		       COALESCE(sub.scheduled_change_at::text, '') AS scheduled_change_at,
		       COALESCE(sub.lifecycle_error, '') AS lifecycle_error
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
