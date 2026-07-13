package biz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// TestAIRequestIdempotencyIntegration exercises the durable claim before any
// quota/provider side effect. The Redis client deliberately points to no
// server, proving that cache failures fall back to the PostgreSQL audit.
func TestAIRequestIdempotencyIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_AI_IDEMPOTENCY_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_AI_IDEMPOTENCY_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range platform.DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-ai-idempotency-test")
	}
	db, err := platform.OpenPostgres()
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	requireFreshAIIdempotencyDatabase(t, db)
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "migrations"))
	if err := platform.RunMigrations(db, migrations); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	quota := &countingQuota{}
	providerStarted := make(chan struct{})
	providerRelease := make(chan struct{})
	var providerCalls int64
	var startedOnce sync.Once
	gatewayData := &data.Data{
		DB: db,
		Redis: platform.NewRedis(platform.RedisConfig{
			Addr: "127.0.0.1:1", DialTimeout: 200 * time.Millisecond,
			ReadTimeout: 200 * time.Millisecond, WriteTimeout: 200 * time.Millisecond, MaxRetries: -1,
		}),
		Quota:           quota,
		Providers:       map[string]data.Provider{"test": {Name: "test", Model: "test-model"}},
		DefaultProvider: "test",
		ProviderCaller: func(context.Context, data.Provider, string, []data.ChatMessage, int64) (data.ProviderReply, error) {
			atomic.AddInt64(&providerCalls, 1)
			startedOnce.Do(func() { close(providerStarted) })
			<-providerRelease
			return data.ProviderReply{Content: "minimal replay summary", PromptTokens: 3, CompletionTokens: 5, TotalTokens: 8, UsageKnown: true}, nil
		},
	}
	defer gatewayData.Redis.Close()
	uc := NewAiGatewayUsecase(gatewayData)
	userID := platform.NewUUID()
	input := ChatInput{
		UserID: userID, RequestID: "trace-1", IdempotencyKey: "retry-key-1", Provider: "test", MaxTokens: 16,
		Messages: []ChatMessage{{Role: "user", Content: "unique input that must not be persisted"}},
	}

	first := make(chan error, 1)
	go func() {
		_, err := uc.Chat(context.Background(), input)
		first <- err
	}()
	<-providerStarted
	if _, err := uc.Chat(context.Background(), input); status.Code(err) != codes.Aborted {
		t.Fatalf("concurrent same-key request error = %v, want Aborted", err)
	}
	close(providerRelease)
	if err := <-first; err != nil {
		t.Fatalf("initial chat: %v", err)
	}

	replayed, err := uc.Chat(context.Background(), input)
	if err != nil {
		t.Fatalf("replay after Redis failure: %v", err)
	}
	if replayed.Content != "minimal replay summary" || replayed.Status != "succeeded" {
		t.Fatalf("replayed result = %#v", replayed)
	}
	if calls := atomic.LoadInt64(&providerCalls); calls != 1 {
		t.Fatalf("provider calls = %d, want 1", calls)
	}
	if quota.reserveCalls != 1 || quota.settleCalls != 1 {
		t.Fatalf("quota side effects reserve=%d settle=%d, want 1/1", quota.reserveCalls, quota.settleCalls)
	}

	mismatched := input
	mismatched.Messages = []ChatMessage{{Role: "user", Content: "different payload"}}
	if _, err := uc.Chat(context.Background(), mismatched); status.Code(err) != codes.AlreadyExists {
		t.Fatalf("same key with different payload error = %v, want AlreadyExists", err)
	}
	if calls := atomic.LoadInt64(&providerCalls); calls != 1 {
		t.Fatalf("payload mismatch called provider %d times, want 1", calls)
	}

	var persisted struct {
		IdempotencyKey string
		Payload        string
	}
	if err := db.Raw(`
		SELECT idempotency_key, COALESCE(response_payload::text, '') AS payload
		FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND idempotency_key = ?
	`, userID, input.IdempotencyKey).Scan(&persisted).Error; err != nil {
		t.Fatalf("read persisted audit: %v", err)
	}
	if persisted.IdempotencyKey != input.IdempotencyKey {
		t.Fatalf("persisted idempotency key = %q", persisted.IdempotencyKey)
	}
	if strings.Contains(persisted.Payload, "unique input that must not be persisted") {
		t.Fatalf("audit response payload leaked prompt: %s", persisted.Payload)
	}

	// Once the audit database is unavailable, ClaimAudit fails before quota or
	// Provider work. This is intentionally a conservative reject.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close test db: %v", err)
	}
	before := atomic.LoadInt64(&providerCalls)
	_, err = uc.Chat(context.Background(), ChatInput{
		UserID: platform.NewUUID(), IdempotencyKey: "database-down", Provider: "test",
		Messages: []ChatMessage{{Role: "user", Content: "must not reach provider"}},
	})
	if err == nil {
		t.Fatal("database outage chat unexpectedly succeeded")
	}
	if after := atomic.LoadInt64(&providerCalls); after != before {
		t.Fatalf("database outage called provider %d additional times", after-before)
	}
}

func requireFreshAIIdempotencyDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	var hasMigrationTable bool
	if err := db.Raw(`SELECT to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&hasMigrationTable).Error; err != nil {
		t.Fatalf("check migration state: %v", err)
	}
	if !hasMigrationTable {
		return
	}
	var applied int64
	if err := db.Raw(`SELECT count(*) FROM schema_migrations`).Scan(&applied).Error; err != nil {
		t.Fatalf("count applied migrations: %v", err)
	}
	if applied != 0 {
		t.Fatalf("POSTGRES_AI_IDEMPOTENCY_TEST_DSN must point at a fresh isolated database; found %d applied migrations", applied)
	}
}

type countingQuota struct {
	mu           sync.Mutex
	reserveCalls int
	settleCalls  int
}

func (q *countingQuota) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{RemainingTokens: 992}, nil
}

func (q *countingQuota) CreatePeriodAccount(context.Context, *quotav1.CreatePeriodAccountRequest, ...grpc.CallOption) (*quotav1.TokenAccount, error) {
	return nil, status.Error(codes.Unimplemented, "not used")
}

func (q *countingQuota) ReserveTokens(_ context.Context, req *quotav1.ReserveTokensRequest, _ ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.reserveCalls++
	return &quotav1.TokenReservation{Id: platform.NewUUID(), ReservedTokens: req.ReservedTokens, Status: "reserved"}, nil
}

func (q *countingQuota) SettleTokens(_ context.Context, req *quotav1.SettleTokensRequest, _ ...grpc.CallOption) (*quotav1.TokenUsage, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.settleCalls++
	return &quotav1.TokenUsage{Id: fmt.Sprintf("usage-%d", q.settleCalls), RequestId: req.RequestId, TotalTokens: req.PromptTokens + req.CompletionTokens, Status: "settled"}, nil
}

func (q *countingQuota) CancelReservation(context.Context, *quotav1.CancelReservationRequest, ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	return &quotav1.TokenReservation{}, nil
}

func (q *countingQuota) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{}, nil
}

func (q *countingQuota) GetUsageTrend(context.Context, *quotav1.GetUsageTrendRequest, ...grpc.CallOption) (*quotav1.GetUsageTrendReply, error) {
	return &quotav1.GetUsageTrendReply{}, nil
}
