package data

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

func TestBillingJobLifecycleIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_BILLING_LIFECYCLE_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_BILLING_LIFECYCLE_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-billing-lifecycle-test")
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
	if err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, name, billing_period, price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.plans WHERE code = 'basic'
	`).Scan(&plan).Error; err != nil || plan.ID == "" {
		t.Fatalf("load basic plan: %#v, %v", plan, err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	renewalSubscriptionID := platform.NewUUID()
	userID := platform.NewUUID()
	insertLifecycleSubscription(t, db, renewalSubscriptionID, userID, plan, now.AddDate(0, -1, 0), now.Add(-time.Minute), false)

	worker := &Data{DB: db}
	work, err := worker.beginRenewal(ctx, renewalSubscriptionID)
	if err != nil {
		t.Fatalf("begin renewal: %v", err)
	}
	if work.SubscriptionID != renewalSubscriptionID || work.PeriodStart != now.Add(-time.Minute) || work.Snapshot.Code != "basic" {
		t.Fatalf("renewal work = %#v", work)
	}
	var renewalState struct {
		Status string
		Start  time.Time
		End    time.Time
	}
	if err := db.WithContext(ctx).Raw(`
		SELECT status, current_period_start AS start, current_period_end AS end
		FROM billing.subscriptions WHERE id = ?::uuid
	`, renewalSubscriptionID).Scan(&renewalState).Error; err != nil {
		t.Fatalf("load renewal subscription: %v", err)
	}
	if renewalState.Status != "quota_pending" || !renewalState.Start.Equal(work.PeriodStart) || !renewalState.End.Equal(work.PeriodEnd) {
		t.Fatalf("renewal state = %#v, work=%#v", renewalState, work)
	}
	assertLifecycleCount(t, db, `SELECT count(*) FROM billing.subscription_periods WHERE subscription_id = ?::uuid`, renewalSubscriptionID, 2)

	cancelSubscriptionID := platform.NewUUID()
	insertLifecycleSubscription(t, db, cancelSubscriptionID, platform.NewUUID(), plan, now.AddDate(0, -1, 0), now.Add(-time.Minute), true)
	if err := worker.finishDueCancellations(ctx, 10); err != nil {
		t.Fatalf("finish due cancellations: %v", err)
	}
	var canceledStatus string
	if err := db.WithContext(ctx).Raw(`SELECT status FROM billing.subscriptions WHERE id = ?::uuid`, cancelSubscriptionID).Scan(&canceledStatus).Error; err != nil {
		t.Fatalf("load canceled subscription: %v", err)
	}
	if canceledStatus != "canceled" {
		t.Fatalf("canceled status = %q", canceledStatus)
	}
}

func requireFreshLifecycleDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	var hasMigrations bool
	if err := db.Raw(`SELECT to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&hasMigrations).Error; err != nil {
		t.Fatalf("check migration table: %v", err)
	}
	if !hasMigrations {
		return
	}
	var count int64
	if err := db.Raw(`SELECT count(*) FROM schema_migrations`).Scan(&count).Error; err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if count > 0 {
		t.Fatalf("POSTGRES_BILLING_LIFECYCLE_TEST_DSN must point to a fresh database; found %d migrations", count)
	}
}

func insertLifecycleSubscription(t *testing.T, db *gorm.DB, subscriptionID, userID string, plan struct {
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
}, start, end time.Time, cancelAtPeriodEnd bool) {
	t.Helper()
	if err := db.WithContext(context.Background()).Exec(`
		INSERT INTO billing.subscriptions (
			id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end,
			cancel_at_period_end, plan_code, plan_name, billing_period, plan_price, currency, monthly_token_quota,
			max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at
		) VALUES (?::uuid, ?::uuid, ?::uuid, 'simulated', ?, 'active', ?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, 'test', now())
	`, subscriptionID, userID, plan.ID, "simulated_"+subscriptionID, start, end, cancelAtPeriodEnd,
		plan.Code, plan.Name, plan.BillingPeriod, plan.Price, plan.Currency, plan.MonthlyTokenQuota,
		plan.MaxRPM, plan.MaxContextTokens, plan.ModelLevel).Error; err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	if err := db.WithContext(context.Background()).Exec(`
		INSERT INTO billing.subscription_periods (
			id, subscription_id, user_id, status, period_start, period_end, plan_id, plan_code, plan_name,
			billing_period, plan_price, currency, monthly_token_quota, max_rpm, max_context_tokens, model_level,
			plan_snapshot_source, plan_snapshot_at, source, activated_at
		) VALUES (?::uuid, ?::uuid, ?::uuid, 'active', ?, ?, ?::uuid, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, 'test', now(), 'test', now())
	`, platform.NewUUID(), subscriptionID, userID, start, end, plan.ID, plan.Code, plan.Name, plan.BillingPeriod,
		plan.Price, plan.Currency, plan.MonthlyTokenQuota, plan.MaxRPM, plan.MaxContextTokens, plan.ModelLevel).Error; err != nil {
		t.Fatalf("insert subscription period: %v", err)
	}
}

func assertLifecycleCount(t *testing.T, db *gorm.DB, query string, arg string, want int64) {
	t.Helper()
	var got int64
	if err := db.WithContext(context.Background()).Raw(query, arg).Scan(&got).Error; err != nil {
		t.Fatalf("count lifecycle rows: %v", err)
	}
	if got != want {
		t.Fatalf("lifecycle row count = %d, want %d", got, want)
	}
}
