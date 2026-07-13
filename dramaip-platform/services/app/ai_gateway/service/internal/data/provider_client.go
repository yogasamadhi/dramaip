package data

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
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
}

type AuditRecord struct {
	ID               string
	UserID           string
	RequestID        string
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
	DB              *gorm.DB
	Quota           quotav1.QuotaServiceClient
	QuotaConnClose  func() error
	Providers       map[string]Provider
	DefaultProvider string
	HTTP            *http.Client
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
	data := &Data{
		DB:              db,
		Quota:           quotav1.NewQuotaServiceClient(conn),
		QuotaConnClose:  conn.Close,
		Providers:       loadProviders(cfg),
		DefaultProvider: cfg.AI.DefaultProvider,
		HTTP:            &http.Client{Timeout: kratosx.Duration(cfg.AI.Timeout, 90*time.Second), Transport: otelhttp.NewTransport(http.DefaultTransport)},
	}
	return data, func() { _ = conn.Close() }, nil
}

func (d *Data) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, d.DB) },
		"quota": func(ctx context.Context) error {
			const healthUserID = "00000000-0000-4000-8000-000000000001"
			_, err := d.Quota.GetTokenBalance(platform.WithUserIdentity(ctx, healthUserID), &quotav1.GetTokenBalanceRequest{UserId: healthUserID})
			return err
		},
	}
}

func (d *Data) GetAudit(ctx context.Context, userID string, requestID string) (AuditRecord, bool, error) {
	var row AuditRecord
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, user_id::text AS user_id, request_id, request_hash, provider, model,
		       COALESCE(reservation_id::text, '') AS reservation_id,
		       COALESCE(response_payload->>'content', '') AS content,
		       prompt_tokens, completion_tokens, total_tokens, remaining_tokens, status, COALESCE(error, '') AS error
		FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND request_id = ?
		LIMIT 1
	`, userID, requestID).Scan(&row).Error
	if err != nil {
		return AuditRecord{}, false, err
	}
	return row, row.ID != "", nil
}

func (d *Data) CreateAudit(ctx context.Context, input AuditRecord) (string, error) {
	id := platform.NewUUID()
	return id, d.DB.WithContext(ctx).Exec(`
		INSERT INTO ai_gateway.request_audits (id, user_id, request_id, request_hash, provider, model, status)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, 'in_progress')
	`, id, input.UserID, input.RequestID, input.RequestHash, input.Provider, input.Model).Error
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
	return d.DB.WithContext(ctx).Exec(`
		UPDATE ai_gateway.request_audits
		SET status = 'failed', error = ?, finished_at = now(), updated_at = now()
		WHERE id = ?::uuid
	`, reason, id).Error
}

func (d *Data) CheckRateLimits(ctx context.Context, userID string, rpmLimit int, dailyTokenLimit int) error {
	var recentRequests int64
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM ai_gateway.request_audits
		WHERE user_id = ?::uuid AND created_at >= now() - interval '1 minute'
	`, userID).Scan(&recentRequests).Error; err != nil {
		return err
	}
	if rpmLimit > 0 && recentRequests >= int64(rpmLimit) {
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

func (d *Data) CallProvider(ctx context.Context, p Provider, model string, messages []ChatMessage, maxTokens int64) (ProviderReply, error) {
	if p.Name == "test" || p.Name == "test-openai-compatible" {
		content := "DramaIP test AI reply: " + lastUserMessage(messages)
		promptTokens := estimateMessageTokens(messages)
		completionTokens := int64(len(content)/4 + 1)
		return ProviderReply{Content: content, PromptTokens: promptTokens, CompletionTokens: completionTokens, TotalTokens: promptTokens + completionTokens}, nil
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
		return ProviderReply{}, status.Error(codes.Unavailable, err.Error())
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 300 {
		platform.StructuredLog(ctx, "ai-gateway-service", "error", "provider_status_failed", map[string]any{"provider": p.Name, "model": model, "status": res.StatusCode, "error": string(data)})
		return ProviderReply{}, status.Errorf(codes.Unavailable, "provider status %d: %s", res.StatusCode, string(data))
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
	return ProviderReply{Content: out.Choices[0].Message.Content, PromptTokens: out.Usage.PromptTokens, CompletionTokens: out.Usage.CompletionTokens, TotalTokens: total}, nil
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
