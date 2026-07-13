package platform

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	defaultRPCDeadline       = 10 * time.Second
	defaultAIChatDeadline    = 95 * time.Second
	defaultCircuitReset      = 15 * time.Second
	defaultCircuitFailures   = 3
	maxIdempotentRPCAttempts = 3
)

var ErrCircuitOpen = errors.New("downstream circuit is open")

var retryJitterSequence uint64

// WithDefaultDeadline preserves a caller's shorter deadline and applies a
// bounded fallback when callers forgot one. It is used at both gRPC client and
// server boundaries so a downstream cannot hold a request forever.
func WithDefaultDeadline(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= timeout {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func rpcDeadline(method string) time.Duration {
	if strings.HasSuffix(method, "/Chat") {
		return resilienceDuration("AI_RPC_TIMEOUT", defaultAIChatDeadline)
	}
	return resilienceDuration("GRPC_REQUEST_TIMEOUT", defaultRPCDeadline)
}

func resilienceDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(Env(key, ""))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

// RetryableGRPCMethod deliberately accepts query-shaped RPCs only. Commands
// remain single-shot even if their transport error is transient; their
// idempotency belongs to the domain/outbox protocol, never a blind client
// retry.
func RetryableGRPCMethod(method string) bool {
	name := method[strings.LastIndex(method, "/")+1:]
	return strings.HasPrefix(name, "Get") || strings.HasPrefix(name, "List") || strings.HasPrefix(name, "Validate")
}

func IsTransientError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return !errors.Is(err, context.Canceled)
	}
	switch status.Code(err) {
	case codes.Unavailable, codes.DeadlineExceeded:
		return true
	default:
		return false
	}
}

type CircuitBreakerConfig struct {
	FailureThreshold int
	ResetTimeout     time.Duration
}

type circuitState uint8

const (
	circuitClosed circuitState = iota
	circuitOpen
	circuitHalfOpen
)

// CircuitBreaker opens only on transport failures. Business rejections prove
// that the peer is reachable and reset the failure streak instead of taking a
// service offline.
type CircuitBreaker struct {
	mu       sync.Mutex
	config   CircuitBreakerConfig
	state    circuitState
	failures int
	retryAt  time.Time
	probing  bool
}

func NewCircuitBreaker(config CircuitBreakerConfig) *CircuitBreaker {
	if config.FailureThreshold <= 0 {
		config.FailureThreshold = defaultCircuitFailures
	}
	if config.ResetTimeout <= 0 {
		config.ResetTimeout = defaultCircuitReset
	}
	return &CircuitBreaker{config: config}
}

func (b *CircuitBreaker) Allow() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	if b.state == circuitClosed {
		return nil
	}
	if b.state == circuitOpen && now.Before(b.retryAt) {
		return ErrCircuitOpen
	}
	if b.state == circuitOpen {
		b.state = circuitHalfOpen
	}
	if b.probing {
		return ErrCircuitOpen
	}
	b.probing = true
	return nil
}

func (b *CircuitBreaker) Record(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probing = false
	if !IsTransientError(err) {
		b.state = circuitClosed
		b.failures = 0
		b.retryAt = time.Time{}
		return
	}
	b.failures++
	if b.state == circuitHalfOpen || b.failures >= b.config.FailureThreshold {
		b.state = circuitOpen
		b.retryAt = time.Now().Add(b.config.ResetTimeout)
	}
}

// CircuitBreakerPool keeps independent breaker state for each downstream or
// Provider/model key. A failure of one model cannot open another model's circuit.
type CircuitBreakerPool struct {
	mu       sync.Mutex
	config   CircuitBreakerConfig
	breakers map[string]*CircuitBreaker
}

func NewCircuitBreakerPool(config CircuitBreakerConfig) *CircuitBreakerPool {
	return &CircuitBreakerPool{config: config, breakers: map[string]*CircuitBreaker{}}
}

func (p *CircuitBreakerPool) breaker(key string) *CircuitBreaker {
	p.mu.Lock()
	defer p.mu.Unlock()
	if breaker := p.breakers[key]; breaker != nil {
		return breaker
	}
	breaker := NewCircuitBreaker(p.config)
	p.breakers[key] = breaker
	return breaker
}

func (p *CircuitBreakerPool) Allow(key string) error {
	return p.breaker(key).Allow()
}

func (p *CircuitBreakerPool) Record(key string, err error) {
	p.breaker(key).Record(err)
}

// KeyedBulkhead gives each Provider/model key an independent bounded slot pool.
// Waiting respects the request deadline, so a saturated model does not
// accumulate unbounded goroutines or delay a different model.
type KeyedBulkhead struct {
	mu       sync.Mutex
	capacity int
	lanes    map[string]chan struct{}
}

func NewKeyedBulkhead(capacity int) *KeyedBulkhead {
	if capacity <= 0 {
		capacity = 1
	}
	return &KeyedBulkhead{capacity: capacity, lanes: map[string]chan struct{}{}}
}

func (b *KeyedBulkhead) lane(key string) chan struct{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	if lane := b.lanes[key]; lane != nil {
		return lane
	}
	lane := make(chan struct{}, b.capacity)
	b.lanes[key] = lane
	return lane
}

func (b *KeyedBulkhead) Acquire(ctx context.Context, key string) (func(), error) {
	lane := b.lane(key)
	select {
	case lane <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-lane }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func UnaryClientResilienceInterceptor(target string) grpc.UnaryClientInterceptor {
	breaker := NewCircuitBreaker(CircuitBreakerConfig{})
	return func(ctx context.Context, method string, req any, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		callCtx, cancel := WithDefaultDeadline(ctx, rpcDeadline(method))
		defer cancel()
		attempts := 1
		if RetryableGRPCMethod(method) {
			attempts = maxIdempotentRPCAttempts
		}
		var lastErr error
		for attempt := 0; attempt < attempts; attempt++ {
			if err := breaker.Allow(); err != nil {
				return status.Error(codes.Unavailable, ErrCircuitOpen.Error())
			}
			err := invoker(callCtx, method, req, reply, cc, opts...)
			breaker.Record(err)
			if err == nil || !IsTransientError(err) || attempt+1 == attempts {
				return err
			}
			lastErr = err
			backoff := retryBackoff(attempt)
			select {
			case <-time.After(backoff):
			case <-callCtx.Done():
				return callCtx.Err()
			}
		}
		return lastErr
	}
}

func retryBackoff(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	if attempt > 2 {
		attempt = 2
	}
	base := time.Duration(1<<attempt) * 25 * time.Millisecond
	// A small deterministic sequence spreads concurrent clients without a
	// global random source or a new dependency. It is intentionally bounded so
	// retries still fit inside the caller's deadline.
	jitter := time.Duration(atomic.AddUint64(&retryJitterSequence, 1)%25) * time.Millisecond
	return base + jitter
}

func UnaryServerDeadlineInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		callCtx, cancel := WithDefaultDeadline(ctx, rpcDeadline(info.FullMethod))
		defer cancel()
		return handler(callCtx, req)
	}
}
