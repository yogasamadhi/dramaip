package events

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExamplesParseAndValidate(t *testing.T) {
	examplesDir := filepath.Join(serviceRoot(t), "events", "examples")
	entries, err := os.ReadDir(examplesDir)
	if err != nil {
		t.Fatalf("ReadDir(%q): %v", examplesDir, err)
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(examplesDir, entry.Name()))
			if err != nil {
				t.Fatalf("ReadFile: %v", err)
			}
			envelope, err := ParseEnvelope(raw)
			if err != nil {
				t.Fatalf("ParseEnvelope: %v", err)
			}
			roundTrip, err := MarshalEnvelope(envelope)
			if err != nil {
				t.Fatalf("MarshalEnvelope: %v", err)
			}
			if _, err := ParseEnvelope(roundTrip); err != nil {
				t.Fatalf("round-trip ParseEnvelope: %v", err)
			}
		})
	}
}

func TestParseEnvelopeAllowsCompatibleUnknownFields(t *testing.T) {
	raw := []byte(`{
		"eventId":"event-1",
		"eventType":"payment.succeeded.v1",
		"schemaVersion":1,
		"aggregateType":"billing.payment",
		"aggregateId":"payment-1",
		"occurredAt":"2026-07-13T00:00:00Z",
		"paymentSucceeded":{
			"paymentId":"payment-1",
			"orderId":"order-1",
			"subscriptionId":"subscription-1",
			"userId":"user-1",
			"planCode":"pro-monthly",
			"provider":"simulated",
			"amount":"29.90",
			"currency":"CNY",
			"futureOptionalField":"ignored by an older consumer"
		}
	}`)

	envelope, err := ParseEnvelope(raw)
	if err != nil {
		t.Fatalf("ParseEnvelope: %v", err)
	}
	if envelope.GetPaymentSucceeded().GetOrderId() != "order-1" {
		t.Fatalf("known event field was not preserved: %+v", envelope.GetPaymentSucceeded())
	}
}

func TestValidateEnvelopeRejectsPayloadRouteMismatch(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(serviceRoot(t), "events", "examples", "payment_succeeded.v1.json"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	envelope, err := ParseEnvelope(raw)
	if err != nil {
		t.Fatalf("ParseEnvelope: %v", err)
	}
	envelope.EventType = NotificationRequestedEventType
	if err := ValidateEnvelope(envelope); err == nil || !strings.Contains(err.Error(), "requires event_type") {
		t.Fatalf("ValidateEnvelope() error = %v, want event type mismatch", err)
	}
}

func serviceRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}
