package data

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// TestWechatWebhookInboxIntegration exercises migration 026 against real
// PostgreSQL. It proves a provider event is first retained in the inbox, then
// advances exactly once into the pre-existing payment activation saga.
func TestWechatWebhookInboxIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_WECHAT_WEBHOOK_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_WECHAT_WEBHOOK_TEST_DSN is not set")
	}
	db := openFreshWebhookDB(t, dsn)
	repo := NewBillingRepo(&Data{DB: db})
	ctx := context.Background()
	userID := platform.NewUUID()
	orderID := platform.NewUUID()
	providerOrderID := "wxorderwechatwebhookintegration0001"
	checkout, err := repo.CreateWechatCheckout(ctx, userID, "basic", orderID, providerOrderID, "weixin://fixture", time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateWechatCheckout: %v", err)
	}
	if checkout.OrderID != orderID || checkout.Provider != "wechat_pay" {
		t.Fatalf("checkout = %#v", checkout)
	}
	rawBody := []byte(`{"id":"wechat-event-1","event_type":"TRANSACTION.SUCCESS"}`)
	event := WechatWebhookEvent{
		ProviderEventID: "wechat-event-1", ProviderOrderID: providerOrderID,
		ProviderTransactionID: "wechat-transaction-1", RawBody: rawBody,
		SignatureTimestamp: "1700000000", SignatureNonce: "nonce", SignatureSerial: "serial",
	}
	receipt, err := repo.RecordWechatWebhook(ctx, event)
	if err != nil || receipt.Processed {
		t.Fatalf("RecordWechatWebhook = %#v, %v", receipt, err)
	}
	queryPayload := []byte(`{"out_trade_no":"` + providerOrderID + `","transaction_id":"wechat-transaction-1","trade_state":"SUCCESS"}`)
	if err := repo.MarkWechatWebhookQueryConfirmed(ctx, event.ProviderEventID, queryPayload); err != nil {
		t.Fatalf("MarkWechatWebhookQueryConfirmed: %v", err)
	}
	if _, err := repo.ConfirmWechatPayment(ctx, providerOrderID, event.ProviderEventID, event.ProviderTransactionID, 3899, "CNY", rawBody); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("wrong payment amount error = %v, want FailedPrecondition", err)
	}
	result, err := repo.ConfirmWechatPayment(ctx, providerOrderID, event.ProviderEventID, event.ProviderTransactionID, 3900, "CNY", rawBody)
	if err != nil {
		t.Fatalf("ConfirmWechatPayment: %v", err)
	}
	if result.Subscription.Provider != "wechat_pay" || result.Subscription.UserID != userID || result.Subscription.Status != "quota_pending" {
		t.Fatalf("wechat confirmation result = %#v", result)
	}
	replayReceipt, err := repo.RecordWechatWebhook(ctx, event)
	if err != nil || !replayReceipt.Processed {
		t.Fatalf("replayed RecordWechatWebhook = %#v, %v", replayReceipt, err)
	}
	replayed, err := repo.ConfirmWechatPayment(ctx, providerOrderID, event.ProviderEventID, event.ProviderTransactionID, 3900, "CNY", rawBody)
	if err != nil || replayed.Subscription.ID != result.Subscription.ID {
		t.Fatalf("replayed ConfirmWechatPayment = %#v, %v", replayed, err)
	}
	assertCount(t, db, "wechat webhook inbox rows", `SELECT count(*) FROM billing.webhook_events WHERE provider = 'wechat_pay' AND provider_event_id = ?`, "wechat-event-1", 1)
	assertCount(t, db, "wechat payment rows", `SELECT count(*) FROM billing.payments WHERE order_id = ?::uuid AND provider = 'wechat_pay'`, orderID, 1)
	var status string
	if err := db.Raw(`SELECT verification_status FROM billing.webhook_events WHERE provider = 'wechat_pay' AND provider_event_id = 'wechat-event-1'`).Scan(&status).Error; err != nil {
		t.Fatalf("load webhook status: %v", err)
	}
	if status != "processed" {
		t.Fatalf("webhook status = %q, want processed", status)
	}
}

func openFreshWebhookDB(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-wechat-webhook-test")
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
		var applied int64
		if err := db.Raw(`SELECT count(*) FROM schema_migrations`).Scan(&applied).Error; err != nil {
			t.Fatalf("count applied migrations: %v", err)
		}
		if applied > 0 {
			t.Fatalf("POSTGRES_WECHAT_WEBHOOK_TEST_DSN must be fresh; found %d migrations", applied)
		}
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations"))
	if err := platform.RunMigrations(db, migrations); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	return db
}
