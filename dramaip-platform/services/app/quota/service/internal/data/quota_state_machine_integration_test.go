package data

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/quota/internal/ledger"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// TestQuotaStateMachineIntegration validates the native-SQL reservation
// ledger against a fresh PostgreSQL instance. It covers the quota job's shared
// maintenance functions as well as the service repository write path.
func TestQuotaStateMachineIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_QUOTA_STATE_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_QUOTA_STATE_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-quota-state-test")
	}
	db, err := platform.OpenPostgres()
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	requireFreshQuotaStateDatabase(t, db)
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations"))
	if err := platform.RunMigrations(db, migrations); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	ctx := context.Background()
	repo := NewQuotaRepo(&Data{DB: db})
	t.Run("concurrent reservations respect quota and duplicate request is idempotent", func(t *testing.T) {
		userID := platform.NewUUID()
		seedQuotaAccount(t, db, userID, 100)

		var wg sync.WaitGroup
		var mu sync.Mutex
		successes := 0
		failures := 0
		var first TokenReservation
		firstRequestID := ""
		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				res, err := repo.ReserveTokens(ctx, userID, fmt.Sprintf("quota-race-%d", i), 20)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					successes++
					if first.ID == "" {
						first = res
						firstRequestID = fmt.Sprintf("quota-race-%d", i)
					}
					return
				}
				if status.Code(err) != codes.ResourceExhausted {
					t.Errorf("reserve %d error = %v", i, err)
					return
				}
				failures++
			}(i)
		}
		wg.Wait()
		if successes != 5 || failures != 5 {
			t.Fatalf("reservations success=%d failure=%d, want 5/5", successes, failures)
		}
		if got := quotaUsedTokens(t, db, userID); got != 100 {
			t.Fatalf("used tokens after concurrent reserves = %d, want 100", got)
		}
		if first.ID == "" {
			t.Fatal("first reservation was not recorded")
		}
		replayed, err := repo.ReserveTokens(ctx, userID, firstRequestID, 20)
		if err != nil {
			t.Fatalf("replay reservation: %v", err)
		}
		if replayed.ID != first.ID || replayed.Status != "reserved" {
			t.Fatalf("replayed reservation = %#v, want %#v", replayed, first)
		}
		if got := quotaUsedTokens(t, db, userID); got != 100 {
			t.Fatalf("replayed reservation changed used tokens to %d", got)
		}
	})

	t.Run("settlement is idempotent and overage remains charged", func(t *testing.T) {
		userID := platform.NewUUID()
		seedQuotaAccount(t, db, userID, 100)
		reservation, err := repo.ReserveTokens(ctx, userID, "quota-settle-exact", 50)
		if err != nil {
			t.Fatalf("reserve exact settlement: %v", err)
		}
		settled, err := repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: reservation.ID, RequestID: "quota-settle-exact", Model: "test", PromptTokens: 10, CompletionTokens: 20, UsageKnown: true,
		})
		if err != nil || settled.Status != "settled" || settled.TotalTokens != 30 {
			t.Fatalf("settle exact = %#v, %v", settled, err)
		}
		if got := quotaUsedTokens(t, db, userID); got != 30 {
			t.Fatalf("used tokens after exact settlement = %d, want 30", got)
		}
		replayed, err := repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: reservation.ID, RequestID: "quota-settle-exact", Model: "ignored", PromptTokens: 1, CompletionTokens: 1, UsageKnown: true,
		})
		if err != nil || replayed.ID != settled.ID || replayed.TotalTokens != 30 {
			t.Fatalf("replayed settlement = %#v, %v", replayed, err)
		}
		if got := quotaUsedTokens(t, db, userID); got != 30 {
			t.Fatalf("replayed settlement changed used tokens to %d", got)
		}

		overageUserID := platform.NewUUID()
		seedQuotaAccount(t, db, overageUserID, 100)
		overageReservation, err := repo.ReserveTokens(ctx, overageUserID, "quota-settle-overage", 20)
		if err != nil {
			t.Fatalf("reserve overage settlement: %v", err)
		}
		overage, err := repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: overageReservation.ID, RequestID: "quota-settle-overage", Model: "test", PromptTokens: 80, CompletionTokens: 70, UsageKnown: true,
		})
		if status.Code(err) != codes.ResourceExhausted || overage.ID == "" || overage.Status != "over_quota_settled" {
			t.Fatalf("overage settlement = %#v, %v", overage, err)
		}
		if got := quotaUsedTokens(t, db, overageUserID); got != 20 {
			t.Fatalf("overage settlement released or overcharged reservation: got %d, want 20", got)
		}
	})

	t.Run("unknown usage is reconciled precisely or finalized conservatively", func(t *testing.T) {
		userID := platform.NewUUID()
		seedQuotaAccount(t, db, userID, 100)
		reservation, err := repo.ReserveTokens(ctx, userID, "quota-settle-retry", 40)
		if err != nil {
			t.Fatalf("reserve unknown settlement: %v", err)
		}
		pending, err := repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: reservation.ID, RequestID: "quota-settle-retry", Model: "test", UsageKnown: false,
		})
		if err != nil || pending.Status != "settlement_pending" {
			t.Fatalf("mark pending settlement = %#v, %v", pending, err)
		}
		reconciled, err := repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: reservation.ID, RequestID: "quota-settle-retry", Model: "test", PromptTokens: 10, CompletionTokens: 15, UsageKnown: true,
		})
		if err != nil || reconciled.Status != "settled" || reconciled.TotalTokens != 25 {
			t.Fatalf("reconcile pending settlement = %#v, %v", reconciled, err)
		}
		if got := quotaUsedTokens(t, db, userID); got != 25 {
			t.Fatalf("precise pending retry used tokens = %d, want 25", got)
		}

		fallbackUserID := platform.NewUUID()
		seedQuotaAccount(t, db, fallbackUserID, 100)
		fallbackReservation, err := repo.ReserveTokens(ctx, fallbackUserID, "quota-settle-unknown", 40)
		if err != nil {
			t.Fatalf("reserve fallback settlement: %v", err)
		}
		pending, err = repo.SettleTokens(ctx, SettleTokensInput{
			ReservationID: fallbackReservation.ID, RequestID: "quota-settle-unknown", Model: "test", UsageKnown: false,
		})
		if err != nil || pending.Status != "settlement_pending" {
			t.Fatalf("mark fallback pending settlement = %#v, %v", pending, err)
		}
		if _, err := repo.CancelReservation(ctx, fallbackReservation.ID); status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("cancel pending reservation error = %v, want FailedPrecondition", err)
		}
		if got := quotaUsedTokens(t, db, fallbackUserID); got != 40 {
			t.Fatalf("cancel pending reservation released tokens: got %d, want 40", got)
		}
		if err := db.WithContext(ctx).Exec(`UPDATE quota.token_reservations SET expires_at = now() - interval '1 hour' WHERE id = ?::uuid`, fallbackReservation.ID).Error; err != nil {
			t.Fatalf("expire pending lease: %v", err)
		}
		withQuotaLedgerTransaction(t, db, func(tx *gorm.DB) error {
			return ledger.ReclaimExpiredReservations(ctx, tx)
		})
		if statusValue := reservationStatus(t, db, fallbackReservation.ID); statusValue != "settlement_pending" {
			t.Fatalf("pending reservation was reclaimed as %q", statusValue)
		}
		if got := quotaUsedTokens(t, db, fallbackUserID); got != 40 {
			t.Fatalf("pending reservation released tokens: got %d, want 40", got)
		}
		if err := db.WithContext(ctx).Exec(`UPDATE quota.token_reservations SET settlement_deadline = now() - interval '1 second' WHERE id = ?::uuid`, fallbackReservation.ID).Error; err != nil {
			t.Fatalf("advance settlement deadline: %v", err)
		}
		withQuotaLedgerTransaction(t, db, func(tx *gorm.DB) error {
			return ledger.FinalizePendingSettlements(ctx, tx)
		})
		if statusValue := reservationStatus(t, db, fallbackReservation.ID); statusValue != "settled_estimate" {
			t.Fatalf("pending reservation status = %q, want settled_estimate", statusValue)
		}
		var usage TokenUsage
		if err := db.WithContext(ctx).Raw(`
			SELECT id::text AS id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at::text AS created_at
			FROM quota.token_usage_logs WHERE request_id = 'quota-settle-unknown'
		`).Scan(&usage).Error; err != nil {
			t.Fatalf("load estimated usage: %v", err)
		}
		if usage.Status != "settled_estimate" || usage.TotalTokens != 40 {
			t.Fatalf("estimated usage = %#v", usage)
		}
	})

	t.Run("expired lease is released and period account creation is idempotent", func(t *testing.T) {
		userID := platform.NewUUID()
		seedQuotaAccount(t, db, userID, 100)
		reservation, err := repo.ReserveTokens(ctx, userID, "quota-expired-lease", 25)
		if err != nil {
			t.Fatalf("reserve expiring lease: %v", err)
		}
		if err := db.WithContext(ctx).Exec(`UPDATE quota.token_reservations SET expires_at = now() - interval '1 second' WHERE id = ?::uuid`, reservation.ID).Error; err != nil {
			t.Fatalf("advance lease expiry: %v", err)
		}
		withQuotaLedgerTransaction(t, db, func(tx *gorm.DB) error {
			return ledger.ReclaimExpiredReservations(ctx, tx)
		})
		if statusValue := reservationStatus(t, db, reservation.ID); statusValue != "expired" {
			t.Fatalf("expired reservation status = %q", statusValue)
		}
		if got := quotaUsedTokens(t, db, userID); got != 0 {
			t.Fatalf("expired reservation left used tokens = %d", got)
		}

		subscriptionID := platform.NewUUID()
		periodStart := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339Nano)
		periodEnd := time.Now().UTC().Add(32 * 24 * time.Hour).Format(time.RFC3339Nano)
		first, err := repo.CreatePeriodAccount(ctx, testPeriodAccountInput(userID, subscriptionID, periodStart, periodEnd, 200, "Basic"))
		if err != nil {
			t.Fatalf("create first period account: %v", err)
		}
		second, err := repo.CreatePeriodAccount(ctx, testPeriodAccountInput(userID, subscriptionID, periodStart, periodEnd, 1, "Changed"))
		if err != nil {
			t.Fatalf("replay period account: %v", err)
		}
		if first.ID != second.ID || second.QuotaTokens != 200 {
			t.Fatalf("period account replay = %#v, want original %#v", second, first)
		}
	})
}

func requireFreshQuotaStateDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	var hasMigrationTable bool
	if err := db.Raw(`SELECT to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&hasMigrationTable).Error; err != nil {
		t.Fatalf("check test database state: %v", err)
	}
	if !hasMigrationTable {
		return
	}
	var applied int64
	if err := db.Raw(`SELECT count(*) FROM schema_migrations`).Scan(&applied).Error; err != nil {
		t.Fatalf("count applied migrations: %v", err)
	}
	if applied > 0 {
		t.Fatalf("POSTGRES_QUOTA_STATE_TEST_DSN must point at a fresh isolated database; found %d applied migrations", applied)
	}
}

func seedQuotaAccount(t *testing.T, db *gorm.DB, userID string, quotaTokens int64) string {
	t.Helper()
	accountID := platform.NewUUID()
	if err := db.WithContext(context.Background()).Exec(`
		INSERT INTO quota.token_accounts (
			id, user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
			period_start, period_end, quota_tokens, max_rpm, max_context_tokens, model_level,
			plan_snapshot_source, plan_snapshot_at, used_tokens, status
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, 'test', 'Test plan', 'monthly', 0, 'CNY',
			now() - interval '1 minute', now() + interval '1 day', ?, 10, 100000, 'standard',
			'test', now(), 0, 'active'
		)
	`, accountID, userID, platform.NewUUID(), quotaTokens).Error; err != nil {
		t.Fatalf("seed quota account: %v", err)
	}
	return accountID
}

func testPeriodAccountInput(userID string, subscriptionID string, periodStart string, periodEnd string, quotaTokens int64, planName string) CreatePeriodAccountInput {
	return CreatePeriodAccountInput{
		UserID: userID, SubscriptionID: subscriptionID, PlanCode: "test", PlanName: planName,
		BillingPeriod: "monthly", PlanPrice: "0", Currency: "CNY", QuotaTokens: quotaTokens,
		MaxRPM: 10, MaxContextTokens: 100000, ModelLevel: "standard", PlanSnapshotSource: "test",
		PlanSnapshotAt: time.Now().UTC().Format(time.RFC3339Nano), PeriodStart: periodStart, PeriodEnd: periodEnd,
	}
}

func quotaUsedTokens(t *testing.T, db *gorm.DB, userID string) int64 {
	t.Helper()
	var used int64
	if err := db.WithContext(context.Background()).Raw(`
		SELECT used_tokens FROM quota.token_accounts
		WHERE user_id = ?::uuid AND status = 'active'
		ORDER BY period_start DESC LIMIT 1
	`, userID).Scan(&used).Error; err != nil {
		t.Fatalf("load used tokens: %v", err)
	}
	return used
}

func reservationStatus(t *testing.T, db *gorm.DB, reservationID string) string {
	t.Helper()
	var statusValue string
	if err := db.WithContext(context.Background()).Raw(`SELECT status FROM quota.token_reservations WHERE id = ?::uuid`, reservationID).Scan(&statusValue).Error; err != nil {
		t.Fatalf("load reservation status: %v", err)
	}
	return statusValue
}

func withQuotaLedgerTransaction(t *testing.T, db *gorm.DB, fn func(*gorm.DB) error) {
	t.Helper()
	if err := db.WithContext(context.Background()).Transaction(func(tx *gorm.DB) error { return fn(tx) }); err != nil {
		t.Fatalf("run quota ledger maintenance: %v", err)
	}
}
