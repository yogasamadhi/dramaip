package data

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCheckoutDeliveryMigrationPersistsPaymentRecoveryFields(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations", "billing", "036_billing_checkout_delivery.up.sql"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read checkout delivery migration: %v", err)
	}
	for _, want := range []string{"payment_url", "payment_expires_at", "idx_billing_orders_pending_expiry"} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("checkout delivery migration missing %q", want)
		}
	}
}
