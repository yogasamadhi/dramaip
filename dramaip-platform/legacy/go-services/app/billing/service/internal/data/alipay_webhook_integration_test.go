package data

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestAlipayWebhookInboxIntegration reuses the real PostgreSQL inbox and the
// existing payment activation saga. It proves the Alipay provider cannot
// duplicate a payment/subscription when its stable notify_id is retried.
func TestAlipayWebhookInboxIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_ALIPAY_WEBHOOK_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_ALIPAY_WEBHOOK_TEST_DSN is not set")
	}
	db := openFreshWebhookDB(t, dsn)
	repo := NewBillingRepo(&Data{DB: db})
	ctx := context.Background()
	userID := platform.NewUUID()
	orderID := platform.NewUUID()
	checkout, err := repo.CreateAlipayCheckout(ctx, userID, "basic", orderID, orderID, "alipayqr://fixture", time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateAlipayCheckout: %v", err)
	}
	if checkout.OrderID != orderID || checkout.Provider != "alipay" {
		t.Fatalf("checkout = %#v", checkout)
	}
	rawBody := []byte("app_id=app-1&out_trade_no=" + orderID + "&trade_no=trade-1")
	event := AlipayWebhookEvent{
		ProviderEventID: "alipay-notify-1", ProviderOrderID: orderID,
		ProviderTransactionID: "alipay-trade-1", RawBody: rawBody,
		AuditPayload: []byte(`{"notify_id":"alipay-notify-1","trade_status":"TRADE_SUCCESS"}`),
		NotifyTime:   "2026-07-13 12:00:00", SignType: "RSA2",
	}
	receipt, err := repo.RecordAlipayWebhook(ctx, event)
	if err != nil || receipt.Processed {
		t.Fatalf("RecordAlipayWebhook = %#v, %v", receipt, err)
	}
	queryPayload := []byte(`{"out_trade_no":"` + orderID + `","trade_no":"alipay-trade-1","trade_status":"TRADE_SUCCESS"}`)
	if err := repo.MarkAlipayWebhookQueryConfirmed(ctx, event.ProviderEventID, queryPayload); err != nil {
		t.Fatalf("MarkAlipayWebhookQueryConfirmed: %v", err)
	}
	if _, err := repo.ConfirmAlipayPayment(ctx, orderID, event.ProviderEventID, event.ProviderTransactionID, 3899, "CNY", event.AuditPayload); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("wrong payment amount error = %v, want FailedPrecondition", err)
	}
	result, err := repo.ConfirmAlipayPayment(ctx, orderID, event.ProviderEventID, event.ProviderTransactionID, 3900, "CNY", event.AuditPayload)
	if err != nil {
		t.Fatalf("ConfirmAlipayPayment: %v", err)
	}
	if result.Subscription.Provider != "alipay" || result.Subscription.UserID != userID || result.Subscription.Status != "quota_pending" {
		t.Fatalf("alipay confirmation result = %#v", result)
	}
	replayReceipt, err := repo.RecordAlipayWebhook(ctx, event)
	if err != nil || !replayReceipt.Processed {
		t.Fatalf("replayed RecordAlipayWebhook = %#v, %v", replayReceipt, err)
	}
	replayed, err := repo.ConfirmAlipayPayment(ctx, orderID, event.ProviderEventID, event.ProviderTransactionID, 3900, "CNY", event.AuditPayload)
	if err != nil || replayed.Subscription.ID != result.Subscription.ID {
		t.Fatalf("replayed ConfirmAlipayPayment = %#v, %v", replayed, err)
	}
	assertCount(t, db, "alipay webhook inbox rows", `SELECT count(*) FROM billing.webhook_events WHERE provider = 'alipay' AND provider_event_id = ?`, event.ProviderEventID, 1)
	assertCount(t, db, "alipay payment rows", `SELECT count(*) FROM billing.payments WHERE order_id = ?::uuid AND provider = 'alipay'`, orderID, 1)
	var verificationStatus string
	if err := db.Raw(`SELECT verification_status FROM billing.webhook_events WHERE provider = 'alipay' AND provider_event_id = ?`, event.ProviderEventID).Scan(&verificationStatus).Error; err != nil {
		t.Fatalf("load webhook status: %v", err)
	}
	if verificationStatus != "processed" {
		t.Fatalf("webhook status = %q, want processed", verificationStatus)
	}
}
