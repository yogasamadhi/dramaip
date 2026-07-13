package platform

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPrometheusMetricsAreBoundedAndCorrelated(t *testing.T) {
	resetMetricsForTest()
	t.Cleanup(resetMetricsForTest)

	ObserveHTTP("POST", "/v1/me/orders/01234567-89ab-cdef-0123-456789abcdef", 503, 150*time.Millisecond)
	ObserveProvider("openai-compatible", "failed", 2*time.Second)
	RecordBusinessEvent("payment_confirmation", "failed")
	RecordQuotaReservation("rejected")
	SetOutboxPending(23)
	RecordCostAlert("high_request_cost")
	ReportError(context.Background(), "POST /v1/me/orders/:id", status.Error(codes.Unavailable, "upstream detail must not be a metric label"))

	var output bytes.Buffer
	WritePrometheus(&output, "billing-service")
	text := output.String()
	for _, expected := range []string{
		`dramaip_service_up{service="billing-service"} 1`,
		`dramaip_requests_total{service="billing-service",operation="post /v1/me/orders/:id",outcome="error",transport="http"} 1`,
		`dramaip_request_duration_seconds_sum{service="billing-service",operation="post /v1/me/orders/:id",outcome="error",transport="http"} 0.15`,
		`dramaip_request_duration_seconds_bucket{service="billing-service",operation="post /v1/me/orders/:id",outcome="error",transport="http",le="0.25"} 1`,
		`dramaip_request_duration_seconds_bucket{service="billing-service",operation="post /v1/me/orders/:id",outcome="error",transport="http",le="+Inf"} 1`,
		`dramaip_provider_requests_total{service="billing-service",outcome="failed",provider="openai-compatible"} 1`,
		`dramaip_business_events_total{service="billing-service",event="payment_confirmation",outcome="failed"} 1`,
		`dramaip_quota_reservations_total{service="billing-service",outcome="rejected"} 1`,
		`dramaip_outbox_pending_events{service="billing-service"} 23`,
		`dramaip_provider_cost_alerts_total{service="billing-service",event="high_request_cost"} 1`,
		`dramaip_errors_total{service="billing-service",class="unavailable",operation="post /v1/me/orders/:id"} 1`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing metric %q in:\n%s", expected, text)
		}
	}
	if strings.Contains(text, "01234567-89ab-cdef-0123-456789abcdef") || strings.Contains(text, "upstream detail") {
		t.Fatalf("metrics leaked unbounded identifier or error detail:\n%s", text)
	}
}

func TestNormalizeHTTPRoute(t *testing.T) {
	for path, want := range map[string]string{
		"/":                             "/",
		"/v1/me/notifications/123/read": "/v1/me/notifications/:id/read",
		"/v1/me/orders/01234567-89ab-cdef-0123-456789abcdef": "/v1/me/orders/:id",
		"/v1/plans": "/v1/plans",
	} {
		if got := NormalizeHTTPRoute(path); got != want {
			t.Fatalf("NormalizeHTTPRoute(%q) = %q, want %q", path, got, want)
		}
	}
	if got := errorClass(errors.New("raw provider error")); got != "internal" {
		t.Fatalf("errorClass() = %q", got)
	}
}
