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
