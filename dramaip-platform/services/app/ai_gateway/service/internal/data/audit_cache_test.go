package data

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

func TestAuditCacheStoresOnlyReplaySummary(t *testing.T) {
	server := miniredis.RunT(t)
	redis := platform.NewRedis(platform.RedisConfig{Addr: server.Addr()})
	defer redis.Close()
	d := &Data{Redis: redis}
	d.CacheAudit(context.Background(), "user-1", "key-1", AuditRecord{
		RequestHash: "hash-1", RequestID: "trace-1", Provider: "test", Model: "model",
		ReservationID: "reservation-1", Content: "safe response", PromptTokens: 2,
		CompletionTokens: 3, TotalTokens: 5, RemainingTokens: 95, Status: "succeeded",
	})
	raw, err := redis.Command(context.Background(), "GET", d.auditCacheKey("user-1", "key-1"))
	if err != nil {
		t.Fatalf("read audit cache: %v", err)
	}
	var summary map[string]any
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatalf("decode audit cache: %v", err)
	}
	for _, prohibited := range []string{"messages", "prompt", "api_key", "error"} {
		if _, ok := summary[prohibited]; ok {
			t.Fatalf("cache contains prohibited %q field: %s", prohibited, raw)
		}
	}
	cached, ok := d.GetCachedAudit(context.Background(), "user-1", "key-1")
	if !ok || cached.Content != "safe response" || cached.RequestHash != "hash-1" {
		t.Fatalf("cached audit = %#v, ok=%t", cached, ok)
	}
}

func TestCompactAuditError(t *testing.T) {
	long := strings.Repeat("x", 600)
	if got := compactAuditError(long); len(got) != 515 || !strings.HasSuffix(got, "…") {
		t.Fatalf("compactAuditError length/suffix = %d/%q", len(got), got[len(got)-3:])
	}
}

func TestProviderPricingUsesModelSnapshotAndExchangeRate(t *testing.T) {
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_INPUT_PRICE_PER_MILLION", "0.40")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_OUTPUT_PRICE_PER_MILLION", "0.80")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_CURRENCY", "USD")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_EXCHANGE_RATE_TO_CNY", "7")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_INPUT_PRICE_PER_MILLION", "0.15")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_OUTPUT_PRICE_PER_MILLION", "0.60")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_CURRENCY", "USD")
	t.Setenv("AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_EXCHANGE_RATE_TO_CNY", "7.2")
	d := &Data{}
	pricing, err := d.PricingFor(Provider{Name: "openai-compatible"}, "gpt-4o-mini")
	if err != nil {
		t.Fatalf("PricingFor: %v", err)
	}
	quote, err := pricing.Quote(1_000_000, 2_000_000)
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if quote.CostAmount != "1.350000000000" || quote.CostCNYAmount != "9.720000000000" || quote.PricingSource != "env:input=AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_INPUT_PRICE_PER_MILLION;output=AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_OUTPUT_PRICE_PER_MILLION;currency=AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_CURRENCY;exchange=AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_EXCHANGE_RATE_TO_CNY" {
		t.Fatalf("quote = %#v", quote)
	}
	fallback, err := d.PricingFor(Provider{Name: "openai-compatible"}, "gpt-4.1-mini")
	if err != nil {
		t.Fatalf("fallback PricingFor: %v", err)
	}
	fallbackQuote, err := fallback.Quote(1_000_000, 1_000_000)
	if err != nil {
		t.Fatalf("fallback Quote: %v", err)
	}
	if fallbackQuote.CostAmount != "1.200000000000" || fallbackQuote.CostCNYAmount != "8.400000000000" || fallbackQuote.PricingSource != "env:input=AI_PROVIDER_OPENAI_COMPATIBLE_INPUT_PRICE_PER_MILLION;output=AI_PROVIDER_OPENAI_COMPATIBLE_OUTPUT_PRICE_PER_MILLION;currency=AI_PROVIDER_OPENAI_COMPATIBLE_CURRENCY;exchange=AI_PROVIDER_OPENAI_COMPATIBLE_EXCHANGE_RATE_TO_CNY" {
		t.Fatalf("fallback quote = %#v", fallbackQuote)
	}
}
