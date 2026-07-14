package data

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type Provider struct {
	Name    string
	BaseURL string
	APIKey  string
	Model   string
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ProviderReply struct {
	Content          string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	UsageKnown       bool
}

type AuditRecord struct {
	ID               string
	UserID           string
	RequestID        string
	IdempotencyKey   string
	RequestHash      string
	Provider         string
	Model            string
	ReservationID    string
	Content          string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	RemainingTokens  int64
	Status           string
	Error            string
}

type Data struct {
	DB               *gorm.DB
	Redis            *platform.Redis
	Quota            quotav1.QuotaServiceClient
	QuotaConnClose   func() error
	Providers        map[string]Provider
	DefaultProvider  string
	HTTP             *http.Client
	ProviderCaller   func(context.Context, Provider, string, []ChatMessage, int64) (ProviderReply, error)
	providerOnce     sync.Once
	providerTimeout  time.Duration
	providerBulkhead *platform.KeyedBulkhead
	providerCircuits *platform.CircuitBreakerPool
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "ai_gateway")
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := platform.DialGRPC(ctx, cfg.Quota.GRPCEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	redis := platform.NewRedis(auditRedisConfig())
	data := &Data{
		DB:               db,
		Redis:            redis,
		Quota:            quotav1.NewQuotaServiceClient(conn),
		QuotaConnClose:   conn.Close,
		Providers:        loadProviders(cfg),
		DefaultProvider:  cfg.AI.DefaultProvider,
		HTTP:             &http.Client{Timeout: kratosx.Duration(cfg.AI.Timeout, 90*time.Second), Transport: otelhttp.NewTransport(http.DefaultTransport)},
		providerTimeout:  kratosx.Duration(cfg.AI.Timeout, 90*time.Second),
		providerBulkhead: platform.NewKeyedBulkhead(cfg.AI.ProviderMaxConcurrency),
		providerCircuits: platform.NewCircuitBreakerPool(platform.CircuitBreakerConfig{
			FailureThreshold: cfg.AI.ProviderCircuitFailures,
			ResetTimeout:     kratosx.Duration(cfg.AI.ProviderCircuitReset, 15*time.Second),
		}),
	}
	return data, func() {
		_ = conn.Close()
		_ = redis.Close()
	}, nil
}

func (d *Data) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, d.DB) },
		"quota": func(ctx context.Context) error {
			const healthUserID = "00000000-0000-4000-8000-000000000001"
			_, err := d.Quota.GetTokenBalance(platform.WithUserIdentity(ctx, healthUserID), &quotav1.GetTokenBalanceRequest{UserId: healthUserID})
			return platform.NormalizeHealthProbeError(err)
		},
	}
}

func (d *Data) GetAudit(ctx context.Context, userID string, idempotencyKey string) (AuditRecord, bool, error) {
	var row AuditRecord
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, user_id::text AS user_id, request_id, idempotency_key, request_hash, provider, model,
		       COALESCE(reservation_id::text, '') AS reservation_id,
		       COALESCE(response_payload->>'content', '') AS content,
		       prompt_tokens, completion_tokens, total_tokens, remaining_tokens, status, COALESCE(error, '') AS error
		FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND idempotency_key = ?
		LIMIT 1
	`, userID, idempotencyKey).Scan(&row).Error
	if err != nil {
		return AuditRecord{}, false, err
	}
	return row, row.ID != "", nil
}

// ClaimAudit atomically creates an in-progress audit or returns the record
// already claimed by a concurrent/retried request. PostgreSQL is the source of
// truth; Redis never participates in this decision.
func (d *Data) ClaimAudit(ctx context.Context, input AuditRecord) (AuditRecord, bool, error) {
	id := platform.NewUUID()
	result := d.DB.WithContext(ctx).Exec(`
		INSERT INTO ai_gateway.request_audits (id, user_id, request_id, idempotency_key, request_hash, provider, model, status)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?, 'in_progress')
		ON CONFLICT (user_id, idempotency_key) DO NOTHING
	`, id, input.UserID, input.RequestID, input.IdempotencyKey, input.RequestHash, input.Provider, input.Model)
	if result.Error != nil {
		return AuditRecord{}, false, result.Error
	}
	if result.RowsAffected == 1 {
		input.ID = id
		input.Status = "in_progress"
		return input, true, nil
	}
	existing, ok, err := d.GetAudit(ctx, input.UserID, input.IdempotencyKey)
	if err != nil {
		return AuditRecord{}, false, err
	}
	if !ok {
		return AuditRecord{}, false, fmt.Errorf("request audit conflict without persisted record")
	}
	return existing, false, nil
}

func (d *Data) CompleteAudit(ctx context.Context, id string, input AuditRecord) error {
	payload, err := json.Marshal(map[string]any{"content": input.Content})
	if err != nil {
		return err
	}
	return d.DB.WithContext(ctx).Exec(`
		UPDATE ai_gateway.request_audits
		SET reservation_id = NULLIF(?, '')::uuid,
		    prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, remaining_tokens = ?,
		    status = 'succeeded', error = NULL, response_payload = ?::jsonb,
		    finished_at = now(), updated_at = now()
		WHERE id = ?::uuid
	`, input.ReservationID, input.PromptTokens, input.CompletionTokens, input.TotalTokens, input.RemainingTokens, string(payload), id).Error
}

func (d *Data) FailAudit(ctx context.Context, id string, reason string) error {
	if id == "" {
		return nil
	}
	reason = compactAuditError(reason)
	return d.DB.WithContext(ctx).Exec(`
		UPDATE ai_gateway.request_audits
		SET status = 'failed', error = ?, finished_at = now(), updated_at = now()
		WHERE id = ?::uuid
	`, reason, id).Error
}

func compactAuditError(reason string) string {
	const maxAuditErrorLength = 512
	reason = strings.TrimSpace(reason)
	if len(reason) <= maxAuditErrorLength {
		return reason
	}
	return reason[:maxAuditErrorLength] + "…"
}

func (d *Data) CheckRateLimits(ctx context.Context, userID string, rpmLimit int, dailyTokenLimit int) error {
	var recentRequests int64
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND created_at >= now() - interval '1 minute'
	`, userID).Scan(&recentRequests).Error; err != nil {
		return err
	}
	// ClaimAudit has already recorded the current request. Reject only when
	// there were at least rpmLimit older requests before that claim.
	if rpmLimit > 0 && recentRequests > int64(rpmLimit) {
		return status.Error(codes.ResourceExhausted, "ai request rate limit exceeded")
	}
	var todayTokens int64
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT COALESCE(SUM(total_tokens), 0)::bigint FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND created_at >= date_trunc('day', now()) AND status = 'succeeded'
	`, userID).Scan(&todayTokens).Error; err != nil {
		return err
	}
	if dailyTokenLimit > 0 && todayTokens >= int64(dailyTokenLimit) {
		return status.Error(codes.ResourceExhausted, "daily ai token limit exceeded")
	}
	return nil
}

type auditCacheEntry struct {
	RequestHash      string `json:"request_hash"`
	RequestID        string `json:"request_id"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	ReservationID    string `json:"reservation_id"`
	Content          string `json:"content"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	RemainingTokens  int64  `json:"remaining_tokens"`
	Status           string `json:"status"`
}

const auditCacheTimeout = 200 * time.Millisecond

func auditRedisConfig() platform.RedisConfig {
	cfg := platform.RedisConfigFromEnv()
	cfg.DialTimeout = auditCacheTimeout
	cfg.ReadTimeout = auditCacheTimeout
	cfg.WriteTimeout = auditCacheTimeout
	// The cache is never authoritative, so it must not spend the request
	// budget retrying an unavailable Redis server.
	cfg.MaxRetries = -1
	return cfg
}

// GetCachedAudit is deliberately best effort. A cache outage or malformed
// value falls through to PostgreSQL, which remains authoritative.
func (d *Data) GetCachedAudit(ctx context.Context, userID string, idempotencyKey string) (AuditRecord, bool) {
	if d.Redis == nil {
		return AuditRecord{}, false
	}
	cacheCtx, cancel := context.WithTimeout(ctx, auditCacheTimeout)
	defer cancel()
	raw, err := d.Redis.Command(cacheCtx, "GET", d.auditCacheKey(userID, idempotencyKey))
	if err != nil {
		return AuditRecord{}, false
	}
	var cached auditCacheEntry
	if err := json.Unmarshal([]byte(raw), &cached); err != nil || cached.Status != "succeeded" {
		return AuditRecord{}, false
	}
	return AuditRecord{
		RequestHash: cached.RequestHash, RequestID: cached.RequestID, Provider: cached.Provider, Model: cached.Model,
		ReservationID: cached.ReservationID, Content: cached.Content, PromptTokens: cached.PromptTokens,
		CompletionTokens: cached.CompletionTokens, TotalTokens: cached.TotalTokens,
		RemainingTokens: cached.RemainingTokens, Status: cached.Status,
	}, true
}

// CacheAudit stores only the response summary needed to replay a completed
// call. It never stores input messages, prompts, keys, or provider raw output.
func (d *Data) CacheAudit(ctx context.Context, userID string, idempotencyKey string, audit AuditRecord) {
	if d.Redis == nil || audit.Status != "succeeded" {
		return
	}
	raw, err := json.Marshal(auditCacheEntry{
		RequestHash: audit.RequestHash, RequestID: audit.RequestID, Provider: audit.Provider, Model: audit.Model,
		ReservationID: audit.ReservationID, Content: audit.Content, PromptTokens: audit.PromptTokens,
		CompletionTokens: audit.CompletionTokens, TotalTokens: audit.TotalTokens,
		RemainingTokens: audit.RemainingTokens, Status: audit.Status,
	})
	if err != nil {
		return
	}
	cacheCtx, cancel := context.WithTimeout(ctx, auditCacheTimeout)
	defer cancel()
	_, _ = d.Redis.Command(cacheCtx, "SETEX", d.auditCacheKey(userID, idempotencyKey), strconv.Itoa(600), string(raw))
}

func (d *Data) auditCacheKey(userID string, idempotencyKey string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + idempotencyKey))
	return "ai:audit:" + hex.EncodeToString(sum[:])
}

func (d *Data) CallProvider(ctx context.Context, p Provider, model string, messages []ChatMessage, maxTokens int64) (reply ProviderReply, err error) {
	started := time.Now()
	defer func() {
		outcome := "succeeded"
		if err != nil {
			outcome = "failed"
		}
		platform.ObserveProvider(p.Name, outcome, time.Since(started))
	}()
	bulkhead, circuits, timeout := d.providerResilience()
	callCtx, cancel := platform.WithDefaultDeadline(ctx, timeout)
	defer cancel()
	resilienceKey := p.Name + "\x00" + model
	release, acquireErr := bulkhead.Acquire(callCtx, resilienceKey)
	if acquireErr != nil {
		return ProviderReply{}, status.Error(codes.Unavailable, "provider is busy; retry later")
	}
	defer release()
	if err := circuits.Allow(resilienceKey); err != nil {
		return ProviderReply{}, status.Error(codes.Unavailable, "provider circuit is open")
	}
	reply, err = d.callProvider(callCtx, p, model, messages, maxTokens)
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(callCtx.Err(), context.DeadlineExceeded) {
		err = status.Error(codes.DeadlineExceeded, "provider request timed out")
	}
	circuits.Record(resilienceKey, err)
	return reply, err
}

func (d *Data) providerResilience() (*platform.KeyedBulkhead, *platform.CircuitBreakerPool, time.Duration) {
	d.providerOnce.Do(func() {
		if d.providerTimeout <= 0 {
			d.providerTimeout = 90 * time.Second
		}
		if d.providerBulkhead == nil {
			d.providerBulkhead = platform.NewKeyedBulkhead(kratosx.EnvInt("AI_PROVIDER_MAX_CONCURRENCY", 8))
		}
		if d.providerCircuits == nil {
			d.providerCircuits = platform.NewCircuitBreakerPool(platform.CircuitBreakerConfig{})
		}
	})
	return d.providerBulkhead, d.providerCircuits, d.providerTimeout
}

func (d *Data) callProvider(ctx context.Context, p Provider, model string, messages []ChatMessage, maxTokens int64) (ProviderReply, error) {
	if d.ProviderCaller != nil {
		return d.ProviderCaller(ctx, p, model, messages, maxTokens)
	}
	if p.Name == "test" || p.Name == "test-openai-compatible" {
		content := "DramaIP test AI reply: " + lastUserMessage(messages)
		promptTokens := estimateMessageTokens(messages)
		completionTokens := int64(len(content)/4 + 1)
		return ProviderReply{Content: content, PromptTokens: promptTokens, CompletionTokens: completionTokens, TotalTokens: promptTokens + completionTokens, UsageKnown: true}, nil
	}
	if p.APIKey == "" || strings.Contains(p.APIKey, "replace-me") {
		return ProviderReply{}, status.Errorf(codes.FailedPrecondition, "provider %s api key is not configured", p.Name)
	}
	body := map[string]any{"model": model, "messages": messages}
	if maxTokens > 0 {
		body["max_tokens"] = maxTokens
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return ProviderReply{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.BaseURL, "/")+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return ProviderReply{}, err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := d.HTTP.Do(req)
	if err != nil {
		platform.StructuredLog(ctx, "ai-gateway-service", "error", "provider_request_failed", map[string]any{"provider": p.Name, "model": model, "error": err.Error()})
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return ProviderReply{}, status.Error(codes.DeadlineExceeded, "provider request timed out")
		}
		return ProviderReply{}, status.Error(codes.Unavailable, "provider request failed")
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 300 {
		platform.StructuredLog(ctx, "ai-gateway-service", "error", "provider_status_failed", map[string]any{"provider": p.Name, "model": model, "status": res.StatusCode, "response_bytes": len(data)})
		return ProviderReply{}, status.Errorf(codes.Unavailable, "provider status %d", res.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
			TotalTokens      int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return ProviderReply{}, err
	}
	if len(out.Choices) == 0 {
		return ProviderReply{}, status.Error(codes.Unavailable, "provider returned no choices")
	}
	total := out.Usage.TotalTokens
	if total == 0 {
		total = out.Usage.PromptTokens + out.Usage.CompletionTokens
	}
	return ProviderReply{
		Content: out.Choices[0].Message.Content, PromptTokens: out.Usage.PromptTokens,
		CompletionTokens: out.Usage.CompletionTokens, TotalTokens: total,
		UsageKnown: out.Usage.TotalTokens > 0 || out.Usage.PromptTokens > 0 || out.Usage.CompletionTokens > 0,
	}, nil
}

func (d *Data) ValidateProvider(p Provider) error {
	if p.Name == "test" || p.Name == "test-openai-compatible" || d.ProviderCaller != nil {
		return nil
	}
	if p.APIKey == "" || strings.Contains(p.APIKey, "replace-me") {
		return status.Errorf(codes.FailedPrecondition, "provider %s api key is not configured", p.Name)
	}
	return nil
}

func loadProviders(cfg *conf.Bootstrap) map[string]Provider {
	names := splitList(cfg.AI.Providers)
	out := make(map[string]Provider, len(names)+1)
	for _, name := range names {
		key := envKey(name)
		out[name] = Provider{
			Name:    name,
			BaseURL: kratosx.Env("AI_PROVIDER_"+key+"_BASE_URL", cfg.AI.BaseURL),
			APIKey:  kratosx.Env("AI_PROVIDER_"+key+"_API_KEY", cfg.AI.APIKey),
			Model:   kratosx.Env("AI_PROVIDER_"+key+"_MODEL", cfg.AI.DefaultModel),
		}
	}
	if cfg.AI.TestProviderEnabled {
		out["test"] = Provider{Name: "test", BaseURL: "test://local", Model: "test-dramaip-chat"}
	}
	return out
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func envKey(name string) string {
	var b strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToUpper(r))
		} else {
			b.WriteByte('_')
		}
	}
	return b.String()
}

func estimateMessageTokens(messages []ChatMessage) int64 {
	total := int64(0)
	for _, message := range messages {
		total += int64(len(message.Content)/4 + 1)
	}
	if total <= 0 {
		return 1
	}
	return total
}

func lastUserMessage(messages []ChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" && strings.TrimSpace(messages[i].Content) != "" {
			return strings.TrimSpace(messages[i].Content)
		}
	}
	return "ok"
}
