package data

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCallProviderTimeoutIsBounded(t *testing.T) {
	d := &Data{
		providerTimeout: 5 * time.Millisecond,
		ProviderCaller: func(ctx context.Context, _ Provider, _ string, _ []ChatMessage, _ int64) (ProviderReply, error) {
			<-ctx.Done()
			return ProviderReply{}, ctx.Err()
		},
	}
	_, err := d.CallProvider(context.Background(), Provider{Name: "slow"}, "test", nil, 0)
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("CallProvider() code = %s, want DeadlineExceeded: %v", status.Code(err), err)
	}
}

func TestCallProviderBulkheadIsolatedByModel(t *testing.T) {
	started := make(chan struct{})
	releaseSlow := make(chan struct{})
	d := &Data{
		providerTimeout:  200 * time.Millisecond,
		providerBulkhead: platform.NewKeyedBulkhead(1),
		providerCircuits: platform.NewCircuitBreakerPool(platform.CircuitBreakerConfig{}),
		ProviderCaller: func(ctx context.Context, _ Provider, model string, _ []ChatMessage, _ int64) (ProviderReply, error) {
			if model == "slow-model" {
				select {
				case started <- struct{}{}:
				default:
				}
				select {
				case <-releaseSlow:
					return ProviderReply{Content: "slow"}, nil
				case <-ctx.Done():
					return ProviderReply{}, ctx.Err()
				}
			}
			return ProviderReply{Content: "fast"}, nil
		},
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = d.CallProvider(context.Background(), Provider{Name: "shared"}, "slow-model", nil, 0)
	}()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := d.CallProvider(ctx, Provider{Name: "shared"}, "slow-model", nil, 0); status.Code(err) != codes.Unavailable {
		t.Fatalf("saturated provider code = %s, want Unavailable: %v", status.Code(err), err)
	}
	fast, err := d.CallProvider(context.Background(), Provider{Name: "shared"}, "fast-model", nil, 0)
	if err != nil || fast.Content != "fast" {
		t.Fatalf("independent provider = %+v, %v", fast, err)
	}
	close(releaseSlow)
	wg.Wait()
}

func TestCallProviderCircuitOpensAfterTransientFailures(t *testing.T) {
	d := &Data{
		providerCircuits: platform.NewCircuitBreakerPool(platform.CircuitBreakerConfig{FailureThreshold: 2, ResetTimeout: time.Hour}),
		ProviderCaller: func(context.Context, Provider, string, []ChatMessage, int64) (ProviderReply, error) {
			return ProviderReply{}, status.Error(codes.Unavailable, "provider unavailable")
		},
	}
	for range 2 {
		_, _ = d.CallProvider(context.Background(), Provider{Name: "broken"}, "test", nil, 0)
	}
	_, err := d.CallProvider(context.Background(), Provider{Name: "broken"}, "test", nil, 0)
	if status.Code(err) != codes.Unavailable || err.Error() != "rpc error: code = Unavailable desc = provider circuit is open" {
		t.Fatalf("open circuit error = %v", err)
	}
}
