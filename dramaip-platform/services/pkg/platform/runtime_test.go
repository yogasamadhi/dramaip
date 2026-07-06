package platform

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestEnvHelpers(t *testing.T) {
	t.Setenv("DRAMAIP_TEST_STRING", "value")
	t.Setenv("DRAMAIP_TEST_INT", "42")
	t.Setenv("DRAMAIP_TEST_BAD_INT", "nope")
	t.Setenv("DRAMAIP_TEST_DURATION", "7")

	if got := Env("DRAMAIP_TEST_STRING", "fallback"); got != "value" {
		t.Fatalf("Env() = %q", got)
	}
	if got := Env("DRAMAIP_TEST_MISSING", "fallback"); got != "fallback" {
		t.Fatalf("Env() fallback = %q", got)
	}
	if got := EnvInt("DRAMAIP_TEST_INT", 3); got != 42 {
		t.Fatalf("EnvInt() = %d", got)
	}
	if got := EnvInt("DRAMAIP_TEST_BAD_INT", 3); got != 3 {
		t.Fatalf("EnvInt() bad fallback = %d", got)
	}
	if got := EnvDurationSeconds("DRAMAIP_TEST_DURATION", 3); got != 7*time.Second {
		t.Fatalf("EnvDurationSeconds() = %s", got)
	}
}

func TestPostgresDSN(t *testing.T) {
	t.Setenv("POSTGRES_HOST", "db")
	t.Setenv("POSTGRES_USER", "user")
	t.Setenv("POSTGRES_PASSWORD", "secret")
	t.Setenv("POSTGRES_DB", "app")
	t.Setenv("POSTGRES_PORT", "15432")
	t.Setenv("POSTGRES_SSLMODE", "require")
	t.Setenv("TIMEZONE", "UTC")

	got := PostgresDSN()
	for _, want := range []string{
		"host=db",
		"user=user",
		"password=secret",
		"dbname=app",
		"port=15432",
		"sslmode=require",
		"TimeZone=UTC",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("PostgresDSN() = %q, missing %q", got, want)
		}
	}

	t.Setenv("POSTGRES_DSN", "postgres://example")
	if got := PostgresDSN(); got != "postgres://example" {
		t.Fatalf("PostgresDSN() override = %q", got)
	}
}

func TestNewUUID(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		id := NewUUID()
		if !pattern.MatchString(id) {
			t.Fatalf("NewUUID() = %q", id)
		}
		if seen[id] {
			t.Fatalf("NewUUID() generated duplicate %q", id)
		}
		seen[id] = true
	}
}

func TestHealthServer(t *testing.T) {
	server := HealthServer(":0", "test-service", map[string]func(context.Context) error{
		"ok": func(context.Context) error { return nil },
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("health body = %s", rec.Body.String())
	}
}

func TestHealthServerFailure(t *testing.T) {
	server := HealthServer(":0", "test-service", map[string]func(context.Context) error{
		"bad": func(context.Context) error { return errors.New("down") },
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("health status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"ok":false`) {
		t.Fatalf("health body = %s", rec.Body.String())
	}
}

func TestMetricsEndpoint(t *testing.T) {
	server := HealthServer(":0", "test-service", nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)

	server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("metrics status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/plain") {
		t.Fatalf("metrics content type = %q", got)
	}
	if !strings.Contains(rec.Body.String(), `dramaip_service_up{service="test-service"} 1`) {
		t.Fatalf("metrics body = %s", rec.Body.String())
	}
}
