package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type provider struct {
	Name    string
	BaseURL string
	APIKey  string
	Model   string
}

type service struct {
	providers       map[string]provider
	defaultProvider string
	quota           drpc.QuotaServiceClient
	http            *http.Client
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	quotaConn, err := drpc.Dial(ctx, platform.Env("QUOTA_GRPC_ENDPOINT", "localhost:9104"))
	if err != nil {
		log.Fatalf("connect quota: %v", err)
	}
	svc := &service{
		providers:       loadProviders(),
		defaultProvider: platform.Env("AI_PROVIDER_DEFAULT", platform.Env("AI_DEFAULT_PROVIDER", "openai-compatible")),
		quota:           drpc.NewQuotaServiceClient(quotaConn),
		http:            &http.Client{Timeout: time.Duration(platform.EnvInt("AI_PROVIDER_TIMEOUT_SECONDS", 90)) * time.Second},
	}
	health := platform.HealthServer(platform.Env("AI_GATEWAY_HTTP_ADDR", ":8105"), "ai-gateway-service", map[string]func(context.Context) error{
		"quota": func(ctx context.Context) error {
			_, err := svc.quota.GetTokenBalance(ctx, &drpc.GetTokenBalanceRequest{UserID: "00000000-0000-4000-8000-000000000001"})
			return err
		},
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("ai-gateway health server stopped: %v", err)
		}
	}()
	if err := platform.ServeGRPC(platform.Env("AI_GATEWAY_GRPC_ADDR", ":9105"), func(server *grpc.Server) {
		drpc.RegisterAiGatewayServiceServer(server, svc)
	}); err != nil {
		log.Fatalf("ai-gateway gRPC failed: %v", err)
	}
}

func (s *service) Chat(ctx context.Context, req *drpc.ChatRequest) (*drpc.ChatReply, error) {
	if req.UserID == "" || len(req.Messages) == 0 {
		return nil, status.Error(codes.InvalidArgument, "missing user or messages")
	}
	providerName := req.Provider
	if providerName == "" {
		providerName = s.defaultProvider
	}
	p, ok := s.providers[providerName]
	if !ok {
		return nil, status.Errorf(codes.InvalidArgument, "unknown provider %s", providerName)
	}
	model := req.Model
	if model == "" {
		model = p.Model
	}
	if model == "" {
		return nil, status.Error(codes.InvalidArgument, "missing model")
	}
	requestID := req.RequestID
	if requestID == "" {
		requestID = platform.NewUUID()
	}
	reservation, err := s.quota.ReserveTokens(ctx, &drpc.ReserveTokensRequest{
		UserID: req.UserID, RequestID: requestID, ReservedTokens: estimateTokens(req),
	})
	if err != nil {
		return nil, err
	}
	reply, err := s.callProvider(ctx, p, model, req.Messages, req.MaxTokens)
	if err != nil {
		_, _ = s.quota.CancelReservation(ctx, &drpc.CancelReservationRequest{ReservationID: reservation.ID})
		return nil, err
	}
	_, err = s.quota.SettleTokens(ctx, &drpc.SettleTokensRequest{
		ReservationID: reservation.ID, RequestID: requestID, Model: model,
		PromptTokens: reply.PromptTokens, CompletionTokens: reply.CompletionTokens,
	})
	if err != nil {
		return nil, err
	}
	balance, _ := s.quota.GetTokenBalance(ctx, &drpc.GetTokenBalanceRequest{UserID: req.UserID})
	remaining := int64(0)
	if balance != nil {
		remaining = balance.RemainingTokens
	}
	reply.Provider = providerName
	reply.Model = model
	reply.ReservationID = reservation.ID
	reply.RemainingTokens = remaining
	return reply, nil
}

func (s *service) callProvider(ctx context.Context, p provider, model string, messages []drpc.ChatMessage, maxTokens int64) (*drpc.ChatReply, error) {
	if p.APIKey == "" || strings.Contains(p.APIKey, "replace-me") {
		return nil, status.Errorf(codes.FailedPrecondition, "provider %s api key is not configured", p.Name)
	}
	body := map[string]any{"model": model, "messages": messages}
	if maxTokens > 0 {
		body["max_tokens"] = maxTokens
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.BaseURL, "/")+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.http.Do(req)
	if err != nil {
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 300 {
		return nil, status.Errorf(codes.Unavailable, "provider status %d: %s", res.StatusCode, string(data))
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
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, status.Error(codes.Unavailable, "provider returned no choices")
	}
	total := out.Usage.TotalTokens
	if total == 0 {
		total = out.Usage.PromptTokens + out.Usage.CompletionTokens
	}
	return &drpc.ChatReply{
		Content: out.Choices[0].Message.Content, PromptTokens: out.Usage.PromptTokens,
		CompletionTokens: out.Usage.CompletionTokens, TotalTokens: total,
	}, nil
}

func loadProviders() map[string]provider {
	names := splitList(platform.Env("AI_PROVIDERS", platform.Env("AI_PROVIDER_DEFAULT", "openai-compatible")))
	out := make(map[string]provider, len(names))
	for _, name := range names {
		key := envKey(name)
		base := platform.Env("AI_PROVIDER_"+key+"_BASE_URL", platform.Env("AI_PROVIDER_BASE_URL", "https://api.openai.com/v1"))
		apiKey := platform.Env("AI_PROVIDER_"+key+"_API_KEY", platform.Env("AI_PROVIDER_API_KEY", ""))
		model := platform.Env("AI_PROVIDER_"+key+"_MODEL", platform.Env("AI_DEFAULT_MODEL", "gpt-4o-mini"))
		out[name] = provider{Name: name, BaseURL: base, APIKey: apiKey, Model: model}
	}
	return out
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
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

func estimateTokens(req *drpc.ChatRequest) int64 {
	total := req.MaxTokens
	for _, message := range req.Messages {
		total += int64(len(message.Content)/4 + 1)
	}
	if total <= 0 {
		return 512
	}
	return total
}

func (p provider) String() string {
	return fmt.Sprintf("%s(%s)", p.Name, p.BaseURL)
}
