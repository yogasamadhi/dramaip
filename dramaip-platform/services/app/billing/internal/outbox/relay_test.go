package outbox

import (
	"testing"
	"time"
)

func TestRetryBackoffIsBounded(t *testing.T) {
	base := 5 * time.Second
	for attempts, want := range map[int]time.Duration{
		0: 5 * time.Second,
		1: 10 * time.Second,
		2: 20 * time.Second,
		6: 5 * time.Minute,
		9: 5 * time.Minute,
	} {
		if got := retryBackoff(base, attempts); got != want {
			t.Fatalf("retryBackoff(%s, %d) = %s, want %s", base, attempts, got, want)
		}
	}
	if got := retryBackoff(0, 10); got != 0 {
		t.Fatalf("zero base retryBackoff = %s, want 0", got)
	}
}
