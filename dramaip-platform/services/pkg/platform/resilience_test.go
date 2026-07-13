package platform

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWithDefaultDeadlinePreservesShorterCallerDeadline(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelParent()
	ctx, cancel := WithDefaultDeadline(parent, time.Second)
	defer cancel()
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > 50*time.Millisecond {
		t.Fatalf("deadline = %v, ok = %v", deadline, ok)
	}
}

func TestWithDefaultDeadlineCapsLongerCallerDeadline(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), time.Hour)
	defer cancelParent()
	ctx, cancel := WithDefaultDeadline(parent, 20*time.Millisecond)
	defer cancel()
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > 50*time.Millisecond {
		t.Fatalf("deadline = %v, ok = %v", deadline, ok)
	}
}

func TestRetryableGRPCMethodOnlyAllowsQueries(t *testing.T) {
	for method, want := range map[string]bool{
		"/quota.v1.Quota/GetTokenBalance":    true,
		"/billing.v1.Billing/ListPlans":      true,
		"/auth.v1.Auth/ValidateAccessToken":  true,
		"/quota.v1.Quota/ReserveTokens":      false,
		"/billing.v1.Billing/CreateCheckout": false,
	} {
		if got := RetryableGRPCMethod(method); got != want {
			t.Fatalf("RetryableGRPCMethod(%q) = %v, want %v", method, got, want)
		}
	}
}

func TestUnaryClientResilienceRetriesQueriesButNotCommands(t *testing.T) {
	queryAttempts := 0
	query := UnaryClientResilienceInterceptor("quota")
	err := query(context.Background(), "/quota.v1.Quota/GetTokenBalance", nil, nil, nil, func(context.Context, string, any, any, *grpc.ClientConn, ...grpc.CallOption) error {
		queryAttempts++
		if queryAttempts == 1 {
			return status.Error(codes.Unavailable, "transient")
		}
		return nil
	})
	if err != nil || queryAttempts != 2 {
		t.Fatalf("query result = %v after %d attempts", err, queryAttempts)
	}

	commandAttempts := 0
	command := UnaryClientResilienceInterceptor("quota-command")
	err = command(context.Background(), "/quota.v1.Quota/ReserveTokens", nil, nil, nil, func(context.Context, string, any, any, *grpc.ClientConn, ...grpc.CallOption) error {
		commandAttempts++
		return status.Error(codes.Unavailable, "transient")
	})
	if status.Code(err) != codes.Unavailable || commandAttempts != 1 {
		t.Fatalf("command result = %v after %d attempts", err, commandAttempts)
	}
}

func TestCircuitBreakerOpensAndHalfOpenProbeCloses(t *testing.T) {
	breaker := NewCircuitBreaker(CircuitBreakerConfig{FailureThreshold: 2, ResetTimeout: time.Millisecond})
	transient := status.Error(codes.Unavailable, "downstream unavailable")
	for range 2 {
		if err := breaker.Allow(); err != nil {
			t.Fatalf("initial Allow() = %v", err)
		}
		breaker.Record(transient)
	}
	if err := breaker.Allow(); !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("open breaker Allow() = %v, want ErrCircuitOpen", err)
	}
	time.Sleep(2 * time.Millisecond)
	if err := breaker.Allow(); err != nil {
		t.Fatalf("half-open probe Allow() = %v", err)
	}
	breaker.Record(nil)
	if err := breaker.Allow(); err != nil {
		t.Fatalf("closed breaker Allow() = %v", err)
	}
}

func TestKeyedBulkheadIsolatedByModelKey(t *testing.T) {
	bulkhead := NewKeyedBulkhead(1)
	release, err := bulkhead.Acquire(context.Background(), "provider-a")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := bulkhead.Acquire(ctx, "provider-a"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("same provider Acquire() = %v, want deadline", err)
	}
	releaseOther, err := bulkhead.Acquire(context.Background(), "provider-b")
	if err != nil {
		t.Fatalf("independent provider Acquire() = %v", err)
	}
	releaseOther()
}
