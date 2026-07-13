package data

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/internal/activation"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/outbox"
	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

// TestCheckoutSnapshotSurvivesPlanChangeIntegration proves that confirmation
// creates a subscription from the checkout snapshot, not the mutable plan.
// POSTGRES_SNAPSHOT_TEST_DSN must point at an isolated PostgreSQL instance
// whose DDL login can create the runtime roles required by migration 018.
func TestCheckoutSnapshotSurvivesPlanChangeIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_SNAPSHOT_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_SNAPSHOT_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-snapshot-test")
	}
	db, err := platform.OpenPostgres()
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	var hasMigrationTable bool
	if err := db.Raw(`SELECT to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&hasMigrationTable).Error; err != nil {
		t.Fatalf("check test database state: %v", err)
	}
	if hasMigrationTable {
		var appliedMigrations int64
		if err := db.Raw(`SELECT count(*) FROM schema_migrations`).Scan(&appliedMigrations).Error; err != nil {
			t.Fatalf("count applied migrations: %v", err)
		}
		if appliedMigrations > 0 {
			t.Fatalf("POSTGRES_SNAPSHOT_TEST_DSN must point at a fresh isolated database; found %d applied migrations", appliedMigrations)
		}
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations"))
	preSnapshotMigrations := t.TempDir()
	copyMigrationsBefore(t, migrations, preSnapshotMigrations, 19)
	if err := platform.RunMigrations(db, preSnapshotMigrations); err != nil {
		t.Fatalf("run migrations before snapshot migration: %v", err)
	}

	ctx := context.Background()
	var purchased snapshotRow
	if err := db.WithContext(ctx).Raw(`
		SELECT code, name, billing_period, price::text AS price, currency, monthly_token_quota,
		       max_rpm, max_context_tokens, model_level
		FROM billing.plans WHERE code = 'basic'
	`).Scan(&purchased).Error; err != nil {
		t.Fatalf("load plan: %v", err)
	}
	if purchased.Code == "" {
		t.Fatal("basic plan is missing")
	}
	var planID string
	if err := db.WithContext(ctx).Raw(`SELECT id::text FROM billing.plans WHERE code = 'basic'`).Scan(&planID).Error; err != nil {
		t.Fatalf("load basic plan id: %v", err)
	}
	if planID == "" {
		t.Fatal("basic plan id is missing")
	}

	legacyUserID := platform.NewUUID()
	legacySubscriptionID := platform.NewUUID()
	legacyOrderID := platform.NewUUID()
	legacyAccountID := platform.NewUUID()
	if err := db.WithContext(ctx).Exec(`
		INSERT INTO billing.subscriptions (
			id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, 'legacy', 'legacy-subscription', 'active',
			'2026-06-01T00:00:00Z'::timestamptz, '2026-07-01T00:00:00Z'::timestamptz
		)
	`, legacySubscriptionID, legacyUserID, planID).Error; err != nil {
		t.Fatalf("create pre-019 subscription: %v", err)
	}
	if err := db.WithContext(ctx).Exec(`
		INSERT INTO billing.orders (
			id, user_id, plan_id, subscription_id, amount, currency, status, provider, provider_order_id,
			created_at, paid_at
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::numeric, ?, 'paid', 'legacy', 'legacy-order',
			'2026-06-01T00:00:00Z'::timestamptz, '2026-06-01T00:00:00Z'::timestamptz
		)
	`, legacyOrderID, legacyUserID, planID, legacySubscriptionID, purchased.Price, purchased.Currency).Error; err != nil {
		t.Fatalf("create pre-019 order: %v", err)
	}
	if err := db.WithContext(ctx).Exec(`
		INSERT INTO quota.token_accounts (
			id, user_id, subscription_id, plan_code, period_start, period_end, quota_tokens, used_tokens, status
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, ?, '2026-06-01T00:00:00Z'::timestamptz,
			'2026-07-01T00:00:00Z'::timestamptz, ?, 0, 'active'
		)
	`, legacyAccountID, legacyUserID, legacySubscriptionID, purchased.Code, purchased.MonthlyTokenQuota).Error; err != nil {
		t.Fatalf("create pre-019 quota account: %v", err)
	}
	if err := platform.RunMigrations(db, migrations); err != nil {
		t.Fatalf("apply snapshot migration: %v", err)
	}

	assertSnapshotRow(t, db, "legacy order", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.orders WHERE id = ?::uuid
	`, legacyOrderID, purchased)
	assertSnapshotRow(t, db, "legacy subscription", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.subscriptions WHERE id = ?::uuid
	`, legacySubscriptionID, purchased)
	assertSnapshotRow(t, db, "legacy quota account", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       quota_tokens AS monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM quota.token_accounts WHERE id = ?::uuid
	`, legacyAccountID, purchased)
	for _, row := range []struct {
		name  string
		table string
		id    string
	}{
		{name: "legacy order", table: "billing.orders", id: legacyOrderID},
		{name: "legacy subscription", table: "billing.subscriptions", id: legacySubscriptionID},
		{name: "legacy quota account", table: "quota.token_accounts", id: legacyAccountID},
	} {
		var source string
		if err := db.WithContext(ctx).Raw(`SELECT plan_snapshot_source FROM `+row.table+` WHERE id = ?::uuid`, row.id).Scan(&source).Error; err != nil {
			t.Fatalf("load %s snapshot source: %v", row.name, err)
		}
		if source != "legacy_backfill" {
			t.Fatalf("%s snapshot source = %q, want legacy_backfill", row.name, source)
		}
	}

	repo := NewBillingRepo(&Data{DB: db})
	userID := platform.NewUUID()
	checkout, err := repo.CreateCheckout(ctx, userID, purchased.Code, "simulated")
	if err != nil {
		t.Fatalf("create checkout: %v", err)
	}
	if err := db.WithContext(ctx).Exec(`
		UPDATE billing.plans
		SET name = 'Changed after checkout', price = 777, monthly_token_quota = 7,
		    max_rpm = 1, max_context_tokens = 1, model_level = 'changed', updated_at = now()
		WHERE code = 'basic'
	`).Error; err != nil {
		t.Fatalf("change plan after checkout: %v", err)
	}

	result, err := repo.ConfirmSimulatedPayment(ctx, userID, checkout.OrderID)
	if err != nil {
		t.Fatalf("confirm simulated payment: %v", err)
	}
	assertSnapshotRow(t, db, "order", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.orders WHERE id = ?::uuid
	`, checkout.OrderID, purchased)

	assertSnapshotRow(t, db, "subscription", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM billing.subscriptions WHERE id = ?::uuid
	`, result.Subscription.ID, purchased)
	if result.Subscription.PlanCode != purchased.Code || result.QuotaTokens != purchased.MonthlyTokenQuota {
		t.Fatalf("payment result used mutable plan: %#v", result)
	}

	// The quota service receives this same snapshot through its RPC. Persist a
	// period account using that contract shape to ensure migration 019 also
	// keeps the historical entitlement on the quota side of the boundary.
	accountID := platform.NewUUID()
	if err := db.WithContext(ctx).Exec(`
		INSERT INTO quota.token_accounts (
			id, user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
			period_start, period_end, quota_tokens, max_rpm, max_context_tokens, model_level,
			plan_snapshot_source, plan_snapshot_at, used_tokens, status
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::numeric, ?,
			'2026-07-01T00:00:00Z'::timestamptz, '2026-08-01T00:00:00Z'::timestamptz,
			?, ?, ?, ?, 'checkout', now(), 0, 'active'
		)
	`, accountID, userID, result.Subscription.ID,
		purchased.Code, purchased.Name, purchased.BillingPeriod, purchased.Price, purchased.Currency,
		purchased.MonthlyTokenQuota, purchased.MaxRPM, purchased.MaxContextTokens, purchased.ModelLevel).Error; err != nil {
		t.Fatalf("create quota account from subscription snapshot: %v", err)
	}
	assertSnapshotRow(t, db, "quota account", `
		SELECT plan_code AS code, plan_name AS name, billing_period, plan_price::text AS price, currency,
		       quota_tokens AS monthly_token_quota, max_rpm, max_context_tokens, model_level
		FROM quota.token_accounts WHERE id = ?::uuid
	`, accountID, purchased)

	// Payment confirmation is idempotent at the order lock: a repeated provider
	// callback returns the same subscription and never creates another payment
	// or payment.succeeded event.
	replayed, err := repo.ConfirmSimulatedPayment(ctx, userID, checkout.OrderID)
	if err != nil {
		t.Fatalf("replay simulated payment: %v", err)
	}
	if replayed.Subscription.ID != result.Subscription.ID {
		t.Fatalf("replayed subscription = %q, want %q", replayed.Subscription.ID, result.Subscription.ID)
	}
	assertCount(t, db, "payment rows", `SELECT count(*) FROM billing.payments WHERE order_id = ?::uuid`, checkout.OrderID, 1)
	assertCount(t, db, "payment success outbox rows", `SELECT count(*) FROM billing.outbox_events WHERE aggregate_id = (SELECT id FROM billing.payments WHERE order_id = ?::uuid) AND event_type = 'payment.succeeded.v1'`, checkout.OrderID, 1)
	scheduled, err := repo.CancelSubscription(ctx, userID, result.Subscription.ID, false)
	if err != nil {
		t.Fatalf("schedule cancellation while quota pending: %v", err)
	}
	if scheduled.Status != "quota_pending" || !scheduled.CancelAtPeriodEnd {
		t.Fatalf("scheduled pending subscription = %#v", scheduled)
	}

	// Quota is provisioned outside the payment transaction. Once it succeeds,
	// activation and subscription.activated.v1 are one local transaction and
	// are safe to repeat.
	if err := activation.ActivateSubscription(ctx, db, result.Subscription.ID); err != nil {
		t.Fatalf("activate subscription: %v", err)
	}
	if err := activation.ActivateSubscription(ctx, db, result.Subscription.ID); err != nil {
		t.Fatalf("repeat activation: %v", err)
	}
	var activatedStatus string
	if err := db.WithContext(ctx).Raw(`SELECT status FROM billing.subscriptions WHERE id = ?::uuid`, result.Subscription.ID).Scan(&activatedStatus).Error; err != nil {
		t.Fatalf("load activated subscription: %v", err)
	}
	if activatedStatus != "active" {
		t.Fatalf("subscription status = %q, want active", activatedStatus)
	}
	assertCount(t, db, "subscription activation outbox rows", `SELECT count(*) FROM billing.outbox_events WHERE aggregate_type = 'billing.subscription' AND aggregate_id = ?::uuid AND event_type = 'subscription.activated.v1'`, result.Subscription.ID, 1)

	// A publisher-confirm loss can leave an event delivered but unmarked. The
	// relay retains the same event IDs, releases leases, and a restarted worker
	// retries them. An expired lease represents a process crash after claiming.
	failingPublisher := &recordingPublisher{err: errors.New("publisher confirmation lost")}
	if err := outbox.Relay(ctx, db, failingPublisher, platform.NewUUID(), 100, 30*time.Second, 0); err == nil {
		t.Fatal("relay with lost publisher confirmation unexpectedly succeeded")
	}
	if len(failingPublisher.eventIDs) != 3 {
		t.Fatalf("failed relay event count = %d, want 3", len(failingPublisher.eventIDs))
	}
	assertCount(t, db, "unpublished retry rows", `SELECT count(*) FROM billing.outbox_events WHERE published_at IS NULL AND publish_attempts = 1`, "", 3)
	if err := db.WithContext(ctx).Exec(`
		UPDATE billing.outbox_events
		SET lease_id = ?::uuid, lease_expires_at = now() - interval '1 second'
		WHERE aggregate_id = ?::uuid AND event_type = 'subscription.activated.v1'
	`, platform.NewUUID(), result.Subscription.ID).Error; err != nil {
		t.Fatalf("simulate crashed relay lease: %v", err)
	}
	successfulPublisher := &recordingPublisher{}
	if err := outbox.Relay(ctx, db, successfulPublisher, platform.NewUUID(), 100, 30*time.Second, 0); err != nil {
		t.Fatalf("restart relay: %v", err)
	}
	if !sameEventIDs(failingPublisher.eventIDs, successfulPublisher.eventIDs) {
		t.Fatalf("relay retry changed event identities: first=%v retry=%v", failingPublisher.eventIDs, successfulPublisher.eventIDs)
	}
	assertCount(t, db, "published outbox rows", `SELECT count(*) FROM billing.outbox_events WHERE published_at IS NOT NULL`, "", 3)
	if err := outbox.Relay(ctx, db, successfulPublisher, platform.NewUUID(), 100, 30*time.Second, 0); err != nil {
		t.Fatalf("empty relay: %v", err)
	}
	if len(successfulPublisher.eventIDs) != 3 {
		t.Fatalf("published events after empty relay = %d, want 3", len(successfulPublisher.eventIDs))
	}
}

type recordingPublisher struct {
	err      error
	eventIDs []string
}

func (p *recordingPublisher) Publish(_ context.Context, envelope *envelopev1.EventEnvelope) error {
	p.eventIDs = append(p.eventIDs, envelope.GetEventId())
	return p.err
}

func assertCount(t *testing.T, db interface {
	WithContext(context.Context) *gorm.DB
}, name, query, id string, want int64) {
	t.Helper()
	var got int64
	var err error
	if id == "" {
		err = db.WithContext(context.Background()).Raw(query).Scan(&got).Error
	} else {
		err = db.WithContext(context.Background()).Raw(query, id).Scan(&got).Error
	}
	if err != nil {
		t.Fatalf("count %s: %v", name, err)
	}
	if got != want {
		t.Fatalf("%s = %d, want %d", name, got, want)
	}
}

func sameEventIDs(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	seen := map[string]int{}
	for _, id := range left {
		seen[id]++
	}
	for _, id := range right {
		seen[id]--
	}
	for _, count := range seen {
		if count != 0 {
			return false
		}
	}
	return true
}

type snapshotRow struct {
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

func assertSnapshotEqual(t *testing.T, name string, want snapshotRow, got snapshotRow) {
	t.Helper()
	if got != want {
		t.Fatalf("%s snapshot = %#v, want %#v", name, got, want)
	}
}

func assertSnapshotRow(t *testing.T, db interface {
	WithContext(context.Context) *gorm.DB
}, name string, query string, id string, want snapshotRow) {
	t.Helper()
	var got snapshotRow
	if err := db.WithContext(context.Background()).Raw(query, id).Scan(&got).Error; err != nil {
		t.Fatalf("load %s snapshot: %v", name, err)
	}
	assertSnapshotEqual(t, name, want, got)
}

func copyMigrationsBefore(t *testing.T, source string, destination string, before int) {
	t.Helper()
	if err := filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".up.sql") {
			return nil
		}
		versionText, _, _ := strings.Cut(entry.Name(), "_")
		version, err := strconv.Atoi(versionText)
		if err != nil {
			return err
		}
		if version >= before {
			return nil
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		return os.WriteFile(target, raw, 0o600)
	}); err != nil {
		t.Fatalf("prepare pre-snapshot migration replay: %v", err)
	}
}

func TestPlanSnapshotMigrationKeepsCompatibilityBoundary(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations", "platform", "019_plan_entitlement_snapshots.up.sql"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read snapshot migration: %v", err)
	}
	sql := string(raw)
	for _, want := range []string{
		"CREATE TRIGGER trg_billing_orders_capture_legacy_plan_snapshot",
		"CREATE TRIGGER trg_billing_subscriptions_capture_legacy_plan_snapshot",
		"CREATE TRIGGER trg_quota_accounts_capture_legacy_snapshot",
		"plan_snapshot_source",
		"plan_snapshot_at",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("snapshot migration missing %q", want)
		}
	}
}
