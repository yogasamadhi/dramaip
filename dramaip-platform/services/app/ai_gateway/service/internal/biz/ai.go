package biz

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type ChatMessage = data.ChatMessage

type ChatInput struct {
	UserID    string
	RequestID string
	Provider  string
	Model     string
	Messages  []ChatMessage
	MaxTokens int64
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
}

func NewAiGatewayUsecase(data *data.Data) *AiGatewayUsecase {
	return &AiGatewayUsecase{
		data:            data,
		userRPMLimit:    kratosx.EnvInt("AI_USER_RPM_LIMIT", 60),
		dailyTokenLimit: kratosx.EnvInt("AI_USER_DAILY_TOKEN_LIMIT", 2000000),
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
	if input.RequestID == "" {
		input.RequestID = platform.NewUUID()
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
	if existing, ok, err := u.data.GetAudit(ctx, input.UserID, input.RequestID); err != nil {
		return ChatResult{}, err
	} else if ok {
		if existing.RequestHash != requestHash {
			return ChatResult{}, status.Error(codes.AlreadyExists, "request id already used with different payload")
		}
		if existing.Status == "succeeded" {
			return ChatResult{
				Content: existing.Content, Provider: existing.Provider, Model: existing.Model,
				PromptTokens: existing.PromptTokens, CompletionTokens: existing.CompletionTokens, TotalTokens: existing.TotalTokens,
				ReservationID: existing.ReservationID, RemainingTokens: existing.RemainingTokens, RequestID: input.RequestID, Status: existing.Status,
			}, nil
		}
		return ChatResult{}, status.Errorf(codes.FailedPrecondition, "request status %s", existing.Status)
	}
	if err := u.data.CheckRateLimits(ctx, input.UserID, u.userRPMLimit, u.dailyTokenLimit); err != nil {
		return ChatResult{}, err
	}
	auditID, err := u.data.CreateAudit(ctx, data.AuditRecord{
		UserID: input.UserID, RequestID: input.RequestID, RequestHash: requestHash, Provider: provider.Name, Model: model,
	})
	if err != nil {
		return ChatResult{}, err
	}
	estimatedTokens := estimateReservedTokens(input.Messages, input.MaxTokens)
	reservation, err := u.data.Quota.ReserveTokens(ctx, &quotav1.ReserveTokensRequest{
		UserId: input.UserID, RequestId: input.RequestID, ReservedTokens: estimatedTokens,
	})
	if err != nil {
		_ = u.data.FailAudit(ctx, auditID, err.Error())
		return ChatResult{}, err
	}
	reply, err := u.data.CallProvider(ctx, provider, model, input.Messages, input.MaxTokens)
	if err != nil {
		_, _ = u.data.Quota.CancelReservation(ctx, &quotav1.CancelReservationRequest{ReservationId: reservation.Id})
		_ = u.data.FailAudit(ctx, auditID, err.Error())
		return ChatResult{}, err
	}
	if reply.TotalTokens == 0 {
		reply.TotalTokens = estimatedTokens
	}
	if reply.PromptTokens == 0 && reply.CompletionTokens == 0 {
		reply.PromptTokens = estimateReservedTokens(input.Messages, 0)
		reply.CompletionTokens = reply.TotalTokens - reply.PromptTokens
		if reply.CompletionTokens < 0 {
			reply.CompletionTokens = 0
		}
	}
	_, err = u.data.Quota.SettleTokens(ctx, &quotav1.SettleTokensRequest{
		ReservationId:    reservation.Id,
		RequestId:        input.RequestID,
		Model:            model,
		PromptTokens:     reply.PromptTokens,
		CompletionTokens: reply.CompletionTokens,
	})
	if err != nil {
		_ = u.data.FailAudit(ctx, auditID, err.Error())
		return ChatResult{}, err
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: input.UserID})
	if err != nil {
		_ = u.data.FailAudit(ctx, auditID, err.Error())
		return ChatResult{}, err
	}
	if err := u.data.CompleteAudit(ctx, auditID, data.AuditRecord{
		ReservationID: reservation.Id, Content: reply.Content, PromptTokens: reply.PromptTokens,
		CompletionTokens: reply.CompletionTokens, TotalTokens: reply.TotalTokens, RemainingTokens: balance.RemainingTokens,
	}); err != nil {
		return ChatResult{}, err
	}
	return ChatResult{
		Content: reply.Content, Provider: provider.Name, Model: model,
		PromptTokens: reply.PromptTokens, CompletionTokens: reply.CompletionTokens, TotalTokens: reply.TotalTokens,
		ReservationID: reservation.Id, RemainingTokens: balance.RemainingTokens, RequestID: input.RequestID, Status: "succeeded",
	}, nil
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
