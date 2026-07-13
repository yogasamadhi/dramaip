package biz

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type ChatMessage = data.ChatMessage

type ChatInput struct {
	UserID         string
	RequestID      string
	IdempotencyKey string
	ClientIP       string
	Provider       string
	Model          string
	Messages       []ChatMessage
	MaxTokens      int64
}

type ChatResult struct {
	Content          string
	Provider         string
	Model            string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	ReservationID    string
	RemainingTokens  int64
	RequestID        string
	Status           string
}

type AiGatewayUsecase struct {
	data            *data.Data
	userRPMLimit    int
	dailyTokenLimit int
	costWindow      time.Duration
	userCostLimit   string
	ipCostLimit     string
	costAlertLimit  string
}

func NewAiGatewayUsecase(data *data.Data) *AiGatewayUsecase {
	return &AiGatewayUsecase{
		data:            data,
		userRPMLimit:    kratosx.EnvInt("AI_USER_RPM_LIMIT", 60),
		dailyTokenLimit: kratosx.EnvInt("AI_USER_DAILY_TOKEN_LIMIT", 2000000),
		costWindow:      kratosx.Duration(kratosx.Env("AI_COST_WINDOW", "5m"), 5*time.Minute),
		userCostLimit:   kratosx.Env("AI_USER_COST_LIMIT_CNY", "5"),
		ipCostLimit:     kratosx.Env("AI_IP_COST_LIMIT_CNY", "20"),
		costAlertLimit:  kratosx.Env("AI_REQUEST_COST_ALERT_CNY", "1"),
	}
}

func (u *AiGatewayUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *AiGatewayUsecase) Chat(ctx context.Context, input ChatInput) (ChatResult, error) {
	if input.UserID == "" {
		return ChatResult{}, status.Error(codes.InvalidArgument, "missing user id")
	}
	if len(input.Messages) == 0 {
		return ChatResult{}, status.Error(codes.InvalidArgument, "messages are required")
	}
	input.RequestID = strings.TrimSpace(input.RequestID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.IdempotencyKey == "" {
		input.IdempotencyKey = input.RequestID
	}
	if input.IdempotencyKey == "" {
		input.IdempotencyKey = platform.NewUUID()
	}
	if input.RequestID == "" {
		input.RequestID = input.IdempotencyKey
	}
	provider, ok := u.provider(input.Provider)
	if !ok {
		return ChatResult{}, status.Errorf(codes.NotFound, "provider %s is not configured", input.Provider)
	}
	model := input.Model
	if model == "" {
		model = provider.Model
	}
	requestHash, err := chatRequestHash(provider.Name, model, input.Messages, input.MaxTokens)
	if err != nil {
		return ChatResult{}, err
	}
	cached, cachedOK := u.data.GetCachedAudit(ctx, input.UserID, input.IdempotencyKey)
	audit, created, err := u.data.ClaimAudit(ctx, data.AuditRecord{
		UserID: input.UserID, RequestID: input.RequestID, IdempotencyKey: input.IdempotencyKey,
		RequestHash: requestHash, Provider: provider.Name, Model: model,
	})
	if err != nil {
		// Do not call quota or the Provider until durable idempotency is claimed.
		return ChatResult{}, err
	}
	if !created {
		if audit.RequestHash != requestHash {
			return ChatResult{}, status.Error(codes.AlreadyExists, "request id already used with different payload")
		}
		if audit.Status == "succeeded" {
			if cachedOK && cached.RequestHash == requestHash {
				return chatResultFromAudit(cached), nil
			}
			return chatResultFromAudit(audit), nil
		}
		if audit.Status == "in_progress" {
			return ChatResult{}, status.Error(codes.Aborted, "request is still in progress")
		}
		return ChatResult{}, status.Errorf(codes.FailedPrecondition, "request status %s", audit.Status)
	}
	if err := u.data.CheckRateLimits(ctx, input.UserID, u.userRPMLimit, u.dailyTokenLimit); err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	if err := u.data.ValidateProvider(provider); err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	pricing, err := u.data.PricingFor(provider, model)
	if err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	estimatedPrompt := estimateReservedTokens(input.Messages, 0)
	estimatedCompletion := input.MaxTokens
	if estimatedCompletion <= 0 {
		estimatedCompletion = estimatedPrompt
	}
	estimatedQuote, err := pricing.Quote(estimatedPrompt, estimatedCompletion)
	if err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	if err := u.data.ReserveCostBudget(ctx, data.CostGuardInput{
		AuditID: audit.ID, UserID: input.UserID, ClientIP: input.ClientIP, EstimatedCostCNY: estimatedQuote.CostCNYAmount,
		Window: u.costWindow, UserLimitCNY: u.userCostLimit, IPLimitCNY: u.ipCostLimit,
	}); err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	estimatedTokens := estimateReservedTokens(input.Messages, input.MaxTokens)
	reservation, err := u.data.Quota.ReserveTokens(ctx, &quotav1.ReserveTokensRequest{
		UserId: input.UserID, RequestId: input.RequestID, ReservedTokens: estimatedTokens,
	})
	if err != nil {
		_ = u.data.ReleaseCostBudget(ctx, audit.ID)
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	reply, err := u.data.CallProvider(ctx, provider, model, input.Messages, input.MaxTokens)
	if err != nil {
		_, _ = u.data.Quota.CancelReservation(ctx, &quotav1.CancelReservationRequest{ReservationId: reservation.Id})
		// A timed-out/failed Provider must not retain either the user quota
		// reservation or the short-window cost guard. Both operations are
		// idempotent, preserving an auditable failed attempt without blocking a
		// later, newly keyed request.
		_ = u.data.ReleaseCostBudget(ctx, audit.ID)
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	usageKnown := reply.UsageKnown
	if !usageKnown && reply.TotalTokens == 0 {
		reply.TotalTokens = estimatedTokens
	}
	if !usageKnown && reply.PromptTokens == 0 && reply.CompletionTokens == 0 {
		reply.PromptTokens = estimateReservedTokens(input.Messages, 0)
		reply.CompletionTokens = reply.TotalTokens - reply.PromptTokens
		if reply.CompletionTokens < 0 {
			reply.CompletionTokens = 0
		}
	} else if usageKnown && reply.TotalTokens == 0 {
		reply.TotalTokens = reply.PromptTokens + reply.CompletionTokens
	}
	costStatus := "actual"
	if !usageKnown {
		costStatus = "estimated"
	}
	actualQuote, err := pricing.Quote(reply.PromptTokens, reply.CompletionTokens)
	if err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	if err := u.data.RecordProviderCost(ctx, data.ProviderCostInput{
		AuditID: audit.ID, UserID: input.UserID, RequestID: input.RequestID, ReservationID: reservation.Id,
		Provider: provider.Name, Model: model, UsageKnown: usageKnown, CostStatus: costStatus, Quote: actualQuote,
		AlertThresholdCNY: u.costAlertLimit, ClientIP: input.ClientIP,
	}); err != nil {
		_, _ = u.data.Quota.SettleTokens(ctx, &quotav1.SettleTokensRequest{ReservationId: reservation.Id, RequestId: input.RequestID, Model: model, UsageKnown: false})
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	_, err = u.data.Quota.SettleTokens(ctx, &quotav1.SettleTokensRequest{
		ReservationId:    reservation.Id,
		RequestId:        input.RequestID,
		Model:            model,
		PromptTokens:     reply.PromptTokens,
		CompletionTokens: reply.CompletionTokens,
		UsageKnown:       usageKnown,
	})
	if err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: input.UserID})
	if err != nil {
		_ = u.data.FailAudit(ctx, audit.ID, err.Error())
		return ChatResult{}, err
	}
	completedAudit := data.AuditRecord{
		RequestHash: requestHash, RequestID: input.RequestID, Provider: provider.Name, Model: model, Status: "succeeded",
		ReservationID: reservation.Id, Content: reply.Content, PromptTokens: reply.PromptTokens,
		CompletionTokens: reply.CompletionTokens, TotalTokens: reply.TotalTokens, RemainingTokens: balance.RemainingTokens,
	}
	if err := u.data.CompleteAudit(ctx, audit.ID, completedAudit); err != nil {
		return ChatResult{}, err
	}
	u.data.CacheAudit(ctx, input.UserID, input.IdempotencyKey, completedAudit)
	return chatResultFromAudit(completedAudit), nil
}

func chatResultFromAudit(audit data.AuditRecord) ChatResult {
	return ChatResult{
		Content: audit.Content, Provider: audit.Provider, Model: audit.Model,
		PromptTokens: audit.PromptTokens, CompletionTokens: audit.CompletionTokens, TotalTokens: audit.TotalTokens,
		ReservationID: audit.ReservationID, RemainingTokens: audit.RemainingTokens,
		RequestID: audit.RequestID, Status: audit.Status,
	}
}

func (u *AiGatewayUsecase) provider(name string) (data.Provider, bool) {
	if name == "" {
		name = u.data.DefaultProvider
	}
	provider, ok := u.data.Providers[name]
	return provider, ok
}

func chatRequestHash(provider string, model string, messages []ChatMessage, maxTokens int64) (string, error) {
	raw, err := json.Marshal(struct {
		Provider  string
		Model     string
		Messages  []ChatMessage
		MaxTokens int64
	}{Provider: provider, Model: model, Messages: messages, MaxTokens: maxTokens})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func estimateReservedTokens(messages []ChatMessage, maxTokens int64) int64 {
	total := maxTokens
	for _, message := range messages {
		total += int64(len(message.Content)/4 + 1)
	}
	if total <= 0 {
		return 1
	}
	return total
}
