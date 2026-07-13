package data

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

func TestBillingReconciliationIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_BILLING_RECONCILIATION_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_BILLING_RECONCILIATION_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-billing-reconciliation-test")
	}
	db, err := platform.OpenPostgres()
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	requireFreshLifecycleDatabase(t, db)
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations"))
	if err := platform.RunMigrations(db, migrations); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	ctx := context.Background()
	plan := loadReconciliationPlan(t, db)
	now := time.Now().UTC().Truncate(time.Second)

	missingSubscriptionID := platform.NewUUID()
	missingUserID := platform.NewUUID()
	insertLifecycleSubscription(t, db, missingSubscriptionID, missingUserID, plan, now, now.AddDate(0, 1, 0), false)
	insertReconciliationOrder(t, db, missingUserID, missingSubscriptionID, plan.ID, "12.00", "simulated", 1, false)

	duplicateSubscriptionID := platform.NewUUID()
	duplicateUserID := platform.NewUUID()
	insertLifecycleSubscription(t, db, duplicateSubscriptionID, duplicateUserID, plan, now, now.AddDate(0, 1, 0), false)
	insertReconciliationOrder(t, db, duplicateUserID, duplicateSubscriptionID, plan.ID, "12.00", "simulated", 2, false)

	mismatchSubscriptionID := platform.NewUUID()
	mismatchUserID := platform.NewUUID()
	insertLifecycleSubscription(t, db, mismatchSubscriptionID, mismatchUserID, plan, now, now.AddDate(0, 1, 0), false)
	insertReconciliationOrder(t, db, mismatchUserID, mismatchSubscriptionID, plan.ID, "12.00", "simulated", 1, true)

	quota := &reconciliationQuotaClient{accounts: map[string]*quotav1.TokenAccount{
		duplicateSubscriptionID: {Id: platform.NewUUID(), UserId: duplicateUserID, SubscriptionId: duplicateSubscriptionID, PlanCode: plan.Code, QuotaTokens: plan.MonthlyTokenQuota, Status: "active"},
		mismatchSubscriptionID:  {Id: platform.NewUUID(), UserId: mismatchUserID, SubscriptionId: mismatchSubscriptionID, PlanCode: plan.Code, QuotaTokens: plan.MonthlyTokenQuota, Status: "active"},
	}}
	worker := &Data{DB: db, Quota: quota}

	first, err := worker.Reconcile(ctx, "scheduled", "billing-job", 50)
	if err != nil {
		t.Fatalf("first reconciliation: %v", err)
	}
	if first.Status != "completed" || first.ScannedOrders != 3 || first.DetectedItems != 3 {
		t.Fatalf("first reconciliation run = %#v", first)
	}
	items, err := worker.ListReconciliationItems(ctx, "", 20)
	if err != nil {
		t.Fatalf("list reconciliation items: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("reconciliation item count = %d, want 3: %#v", len(items), items)
	}
	missing := reconciliationItemByType(t, items, "missing_quota_account")
	duplicate := reconciliationItemByType(t, items, "payment_count_mismatch")
	_ = reconciliationItemByType(t, items, "payment_fields_mismatch")

	second, err := worker.Reconcile(ctx, "scheduled", "billing-job", 50)
	if err != nil {
		t.Fatalf("second reconciliation: %v", err)
	}
	if second.DetectedItems != 3 {
		t.Fatalf("second detected items = %d, want 3", second.DetectedItems)
	}
	items, err = worker.ListReconciliationItems(ctx, "", 20)
	if err != nil {
		t.Fatalf("list items after rerun: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("rerun created duplicate reconciliation cases: %d", len(items))
	}
	if reconciliationItemByType(t, items, "missing_quota_account").Occurrences != 2 {
		t.Fatalf("missing quota occurrence count was not incremented")
	}
	var observations int64
	if err := db.Raw(`SELECT count(*) FROM billing.reconciliation_observations`).Scan(&observations).Error; err != nil {
		t.Fatalf("count immutable reconciliation observations: %v", err)
	}
	if observations != 6 {
		t.Fatalf("reconciliation observation count = %d, want 6", observations)
	}
	var cursor struct{ OrderID string }
	if err := db.Raw(`SELECT last_order_id::text AS order_id FROM billing.reconciliation_cursors WHERE name = 'paid_orders'`).Scan(&cursor).Error; err != nil || cursor.OrderID == "" {
		t.Fatalf("persist paid-order reconciliation cursor: %#v, %v", cursor, err)
	}
	pageOne, err := worker.Reconcile(ctx, "scheduled", "billing-job", 1)
	if err != nil || pageOne.ScannedOrders != 1 {
		t.Fatalf("first bounded reconciliation page = %#v, %v", pageOne, err)
	}
	firstCursor := cursor.OrderID
	if err := db.Raw(`SELECT last_order_id::text AS order_id FROM billing.reconciliation_cursors WHERE name = 'paid_orders'`).Scan(&cursor).Error; err != nil {
		t.Fatalf("load first bounded cursor: %v", err)
	}
	pageTwo, err := worker.Reconcile(ctx, "scheduled", "billing-job", 1)
	if err != nil || pageTwo.ScannedOrders != 1 {
		t.Fatalf("second bounded reconciliation page = %#v, %v", pageTwo, err)
	}
	if err := db.Raw(`SELECT last_order_id::text AS order_id FROM billing.reconciliation_cursors WHERE name = 'paid_orders'`).Scan(&cursor).Error; err != nil || cursor.OrderID == firstCursor {
		t.Fatalf("bounded reconciliation cursor did not advance: %#v, %v", cursor, err)
	}

	repair, err := worker.ApplyReconciliationAction(ctx, missing.ID, ReconciliationActionInput{
		Action: "retry_quota_provision", Actor: "ops@example.test", Reason: "paid order has no entitlement", IdempotencyKey: "repair-" + missing.ID,
	})
	if err != nil {
		t.Fatalf("repair missing quota: %v", err)
	}
	if repair.Status != "completed" || len(quota.created) != 1 {
		t.Fatalf("quota repair = %#v, creates=%d", repair, len(quota.created))
	}

	manual, err := worker.ApplyReconciliationAction(ctx, duplicate.ID, ReconciliationActionInput{
		Action: "request_refund", Actor: "ops@example.test", Reason: "duplicate paid payment requires provider review", IdempotencyKey: "refund-review-" + duplicate.ID,
	})
	if err != nil {
		t.Fatalf("queue manual refund review: %v", err)
	}
	if manual.Status != "manual_review" {
		t.Fatalf("manual action = %#v", manual)
	}
	again, err := worker.ApplyReconciliationAction(ctx, duplicate.ID, ReconciliationActionInput{
		Action: "request_refund", Actor: "ops@example.test", Reason: "duplicate paid payment requires provider review", IdempotencyKey: "refund-review-" + duplicate.ID,
	})
	if err != nil || again.ID != manual.ID {
		t.Fatalf("manual action idempotency = %#v, %v", again, err)
	}
	var actionCount int64
	if err := db.Raw(`SELECT count(*) FROM billing.reconciliation_actions WHERE item_id = ?::uuid`, duplicate.ID).Scan(&actionCount).Error; err != nil {
		t.Fatalf("count action audit records: %v", err)
	}
	if actionCount != 1 {
		t.Fatalf("action audit count = %d, want 1", actionCount)
	}
	var subscriptionStatus string
	if err := db.Raw(`SELECT status FROM billing.subscriptions WHERE id = ?::uuid`, duplicateSubscriptionID).Scan(&subscriptionStatus).Error; err != nil {
		t.Fatalf("read duplicate subscription: %v", err)
	}
	if subscriptionStatus != "active" {
		t.Fatalf("manual refund review must not silently change entitlement, got %q", subscriptionStatus)
	}
}

type reconciliationPlan struct {
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

func loadReconciliationPlan(t *testing.T, db *gorm.DB) reconciliationPlan {
	t.Helper()
	var plan reconciliationPlan
	if err := db.Raw(`
		SELECT id::text AS id, code, name, billing_period, price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.plans WHERE code = 'basic'
	`).Scan(&plan).Error; err != nil || plan.ID == "" {
		t.Fatalf("load basic plan: %#v, %v", plan, err)
	}
	return plan
}

func insertReconciliationOrder(t *testing.T, db *gorm.DB, userID, subscriptionID, planID, amount, provider string, paymentCount int, mismatchedPayment bool) {
	t.Helper()
	orderID := platform.NewUUID()
	if err := db.WithContext(context.Background()).Exec(`
		INSERT INTO billing.orders (
			id, user_id, plan_id, subscription_id, amount, currency, status, provider, provider_order_id, created_at, paid_at
		) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::numeric, 'CNY', 'paid', ?, ?, now(), now())
	`, orderID, userID, planID, subscriptionID, amount, provider, provider+"_"+orderID).Error; err != nil {
		t.Fatalf("insert reconciliation order: %v", err)
	}
	for index := 0; index < paymentCount; index++ {
		paymentAmount := amount
		if mismatchedPayment && index == 0 {
			paymentAmount = "13.00"
		}
		if err := db.WithContext(context.Background()).Exec(`
			INSERT INTO billing.payments (id, user_id, order_id, provider, provider_payment_id, amount, currency, status, raw_payload)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::numeric, 'CNY', 'paid', '{}'::jsonb)
		`, platform.NewUUID(), userID, orderID, provider, provider+"_payment_"+platform.NewUUID(), paymentAmount).Error; err != nil {
			t.Fatalf("insert reconciliation payment: %v", err)
		}
	}
}

func reconciliationItemByType(t *testing.T, items []ReconciliationItem, mismatchType string) ReconciliationItem {
	t.Helper()
	for _, item := range items {
		if item.MismatchType == mismatchType {
			return item
		}
	}
	t.Fatalf("reconciliation item %q not found: %#v", mismatchType, items)
	return ReconciliationItem{}
}

type reconciliationQuotaClient struct {
	accounts map[string]*quotav1.TokenAccount
	created  []*quotav1.CreatePeriodAccountRequest
}

func (c *reconciliationQuotaClient) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{}, nil
}

func (c *reconciliationQuotaClient) CreatePeriodAccount(_ context.Context, req *quotav1.CreatePeriodAccountRequest, _ ...grpc.CallOption) (*quotav1.TokenAccount, error) {
	c.created = append(c.created, req)
	account := &quotav1.TokenAccount{Id: platform.NewUUID(), UserId: req.UserId, SubscriptionId: req.SubscriptionId, PlanCode: req.PlanCode, QuotaTokens: req.QuotaTokens, Status: "active", PeriodStart: req.PeriodStart, PeriodEnd: req.PeriodEnd}
	c.accounts[req.SubscriptionId] = account
	return account, nil
}

func (c *reconciliationQuotaClient) GetPeriodAccount(_ context.Context, req *quotav1.GetPeriodAccountRequest, _ ...grpc.CallOption) (*quotav1.PeriodAccountReply, error) {
	account, ok := c.accounts[req.SubscriptionId]
	if !ok {
		return &quotav1.PeriodAccountReply{Found: false}, nil
	}
	return &quotav1.PeriodAccountReply{Found: true, Account: account}, nil
}

func (c *reconciliationQuotaClient) ReserveTokens(context.Context, *quotav1.ReserveTokensRequest, ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	return &quotav1.TokenReservation{}, nil
}

func (c *reconciliationQuotaClient) SettleTokens(context.Context, *quotav1.SettleTokensRequest, ...grpc.CallOption) (*quotav1.TokenUsage, error) {
	return &quotav1.TokenUsage{}, nil
}

func (c *reconciliationQuotaClient) CancelReservation(context.Context, *quotav1.CancelReservationRequest, ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	return &quotav1.TokenReservation{}, nil
}

func (c *reconciliationQuotaClient) AdjustPeriodQuota(context.Context, *quotav1.AdjustPeriodQuotaRequest, ...grpc.CallOption) (*quotav1.QuotaAdjustment, error) {
	return &quotav1.QuotaAdjustment{}, nil
}

func (c *reconciliationQuotaClient) PrepareRefund(context.Context, *quotav1.PrepareRefundRequest, ...grpc.CallOption) (*quotav1.RefundPreparation, error) {
	return &quotav1.RefundPreparation{}, nil
}

func (c *reconciliationQuotaClient) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{}, nil
}

func (c *reconciliationQuotaClient) GetUsageTrend(context.Context, *quotav1.GetUsageTrendRequest, ...grpc.CallOption) (*quotav1.GetUsageTrendReply, error) {
	return &quotav1.GetUsageTrendReply{}, nil
}
