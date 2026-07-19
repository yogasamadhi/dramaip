package biz

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
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
	UserID               string
	RequestID            string
	IdempotencyKey       string
	ClientIP             string
	Provider             string
	Model                string
	Messages             []ChatMessage
	MaxTokens            int64
	PreflightRequestHash string
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

// CloudModel is the public, non-secret description of an AI Gateway model.
// Provider API keys and base URLs never leave the gateway process.
type CloudModel struct {
	Provider  string
	Model     string
	IsDefault bool
}

type PreflightInput struct {
	UserID            string
	Provider          string
	Model             string
	ContextCharacters int64
	MessageCount      int64
	MaxTokens         int64
	RequestHash       string
}

type PreflightResult struct {
	Model           CloudModel
	EstimatedTokens int64
	RequestHash     string
}

const (
	maxDesktopContextCharacters int64 = 24_000
	maxDesktopMessageCount      int64 = 8
	maxDesktopCompletionTokens  int64 = 8_192
)

type AiGatewayUsecase struct {
	data            *data.Data
	userRPMLimit    int
	dailyTokenLimit int
	costWindow      time.Duration
	userCostLimit   string
	ipCostLimit     string
	costAlertLimit  string
	activeMu        sync.Mutex
	activeCalls     map[string]context.CancelFunc
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
		activeCalls:     make(map[string]context.CancelFunc),
	}
}

func (u *AiGatewayUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

// ListModels returns only providers that are both callable and priced. A
// desktop client therefore cannot select an unconfigured or unbillable model
// and cannot infer any provider credential material.
func (u *AiGatewayUsecase) ListModels() []CloudModel {
	names := make([]string, 0, len(u.data.Providers))
	for name := range u.data.Providers {
		names = append(names, name)
	}
	sort.Strings(names)
	models := make([]CloudModel, 0, len(names))
	for _, name := range names {
		provider := u.data.Providers[name]
		if provider.Model == "" || u.data.ValidateProvider(provider) != nil {
			continue
		}
		if _, err := u.data.PricingFor(provider, provider.Model); err != nil {
			continue
		}
		models = append(models, CloudModel{
			Provider:  provider.Name,
			Model:     provider.Model,
			IsDefault: provider.Name == u.data.DefaultProvider,
		})
	}
	if len(models) > 0 && !hasDefaultModel(models) {
		models[0].IsDefault = true
	}
	return models
}

// Preflight validates the desktop's deliberately content-free context summary
// before a chargeable call. Actual prompt content is sent only to Chat after
// this check succeeds.
func (u *AiGatewayUsecase) Preflight(input PreflightInput) (PreflightResult, error) {
	if strings.TrimSpace(input.UserID) == "" {
		return PreflightResult{}, status.Error(codes.InvalidArgument, "missing user id")
	}
	if input.ContextCharacters < 1 || input.ContextCharacters > maxDesktopContextCharacters {
		return PreflightResult{}, status.Error(codes.InvalidArgument, "desktop context exceeds limit")
	}
	if input.MessageCount < 1 || input.MessageCount > maxDesktopMessageCount {
		return PreflightResult{}, status.Error(codes.InvalidArgument, "desktop message count exceeds limit")
	}
	if input.MaxTokens < 1 || input.MaxTokens > maxDesktopCompletionTokens {
		return PreflightResult{}, status.Error(codes.InvalidArgument, "desktop max tokens exceeds limit")
	}
	if !validRequestHash(input.RequestHash) {
		return PreflightResult{}, status.Error(codes.InvalidArgument, "invalid desktop request hash")
	}
	model, err := u.resolveCloudModel(input.Provider, input.Model)
	if err != nil {
		return PreflightResult{}, err
	}
	return PreflightResult{
		Model:           model,
		EstimatedTokens: input.ContextCharacters/4 + input.MessageCount + input.MaxTokens,
		RequestHash:     input.RequestHash,
	}, nil
}

func (u *AiGatewayUsecase) Chat(ctx context.Context, input ChatInput) (ChatResult, error) {
	return u.chat(ctx, input, nil)
}

// ChatStream executes the same durable claim, preflight binding, quota
// reservation and settlement as Chat. The only difference is that real
// provider deltas are surfaced through emit while the request is active.
func (u *AiGatewayUsecase) ChatStream(ctx context.Context, input ChatInput, emit func(string) error) (ChatResult, error) {
	input = normalizeChatInput(input)
	key := activeChatKey(input.UserID, input.IdempotencyKey)
	streamCtx, cancel := context.WithCancel(ctx)
	if !u.registerActiveCall(key, cancel) {
		cancel()
		return u.chat(ctx, input, emit)
	}
	defer func() {
		u.unregisterActiveCall(key)
		cancel()
	}()
	return u.chat(streamCtx, input, emit)
}

// CancelChat is intentionally idempotent. An active call receives a context
// cancellation; its stream path then releases quota/cost reservations before
// the durable audit becomes canceled. Finished calls only report their stored
// state and never re-invoke a provider.
func (u *AiGatewayUsecase) CancelChat(ctx context.Context, userID, idempotencyKey string) (string, error) {
	userID = strings.TrimSpace(userID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if userID == "" || idempotencyKey == "" {
		return "", status.Error(codes.InvalidArgument, "missing chat cancellation identity")
	}
	key := activeChatKey(userID, idempotencyKey)
	u.activeMu.Lock()
	cancel := u.activeCalls[key]
	u.activeMu.Unlock()
	if cancel != nil {
		cancel()
		return "cancellation_requested", nil
	}
	audit, ok, err := u.data.GetAudit(ctx, userID, idempotencyKey)
	if err != nil {
		return "", err
	}
	if !ok {
		return "not_found", nil
	}
	return audit.Status, nil
}

// ChatStatus is owner-scoped by the service/auth identity and contains only
// the already-audited output summary. Request prompts are deliberately absent.
func (u *AiGatewayUsecase) ChatStatus(ctx context.Context, userID, idempotencyKey string) (ChatResult, error) {
	userID = strings.TrimSpace(userID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if userID == "" || idempotencyKey == "" {
		return ChatResult{}, status.Error(codes.InvalidArgument, "missing chat status identity")
	}
	audit, ok, err := u.data.GetAudit(ctx, userID, idempotencyKey)
	if err != nil {
		return ChatResult{}, err
	}
	if !ok {
		return ChatResult{}, status.Error(codes.NotFound, "chat request not found")
	}
	return chatResultFromAudit(audit), nil
}

func (u *AiGatewayUsecase) chat(ctx context.Context, input ChatInput, emit func(string) error) (ChatResult, error) {
	if input.UserID == "" {
		return ChatResult{}, status.Error(codes.InvalidArgument, "missing user id")
	}
	if len(input.Messages) == 0 {
		return ChatResult{}, status.Error(codes.InvalidArgument, "messages are required")
	}
	input = normalizeChatInput(input)
	selected, err := u.resolveCloudModel(input.Provider, input.Model)
	if err != nil {
		return ChatResult{}, err
	}
	provider := u.data.Providers[selected.Provider]
	model := selected.Model
	requestHash, err := chatRequestHash(provider.Name, model, input.Messages, input.MaxTokens)
	if err != nil {
		return ChatResult{}, err
	}
	if !validRequestHash(input.PreflightRequestHash) || input.PreflightRequestHash != requestHash {
		return ChatResult{}, status.Error(codes.FailedPrecondition, "cloud_preflight_request_mismatch")
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
	var reply data.ProviderReply
	if emit != nil {
		reply, err = u.data.CallProviderStream(ctx, provider, model, input.Messages, input.MaxTokens, emit)
	} else {
		reply, err = u.data.CallProvider(ctx, provider, model, input.Messages, input.MaxTokens)
	}
	if err != nil {
		cleanupCtx, cleanup := cancellationCleanupContext(ctx)
		defer cleanup()
		_, _ = u.data.Quota.CancelReservation(cleanupCtx, &quotav1.CancelReservationRequest{ReservationId: reservation.Id})
		// A timed-out/failed Provider must not retain either the user quota
		// reservation or the short-window cost guard. Both operations are
		// idempotent, preserving an auditable failed attempt without blocking a
		// later, newly keyed request.
		_ = u.data.ReleaseCostBudget(cleanupCtx, audit.ID)
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			_ = u.data.CancelAudit(cleanupCtx, audit.ID, "author canceled generation")
			return ChatResult{}, status.Error(codes.Canceled, "chat generation canceled")
		}
		_ = u.data.FailAudit(cleanupCtx, audit.ID, err.Error())
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

func normalizeChatInput(input ChatInput) ChatInput {
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
	return input
}

func activeChatKey(userID, idempotencyKey string) string {
	return userID + "\x00" + idempotencyKey
}

func (u *AiGatewayUsecase) registerActiveCall(key string, cancel context.CancelFunc) bool {
	u.activeMu.Lock()
	defer u.activeMu.Unlock()
	if _, exists := u.activeCalls[key]; exists {
		return false
	}
	u.activeCalls[key] = cancel
	return true
}

func (u *AiGatewayUsecase) unregisterActiveCall(key string) {
	u.activeMu.Lock()
	delete(u.activeCalls, key)
	u.activeMu.Unlock()
}

func cancellationCleanupContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
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

func (u *AiGatewayUsecase) resolveCloudModel(providerName string, requestedModel string) (CloudModel, error) {
	provider, ok := u.provider(strings.TrimSpace(providerName))
	if !ok {
		return CloudModel{}, status.Errorf(codes.NotFound, "provider %s is not configured", providerName)
	}
	if err := u.data.ValidateProvider(provider); err != nil {
		return CloudModel{}, err
	}
	model := strings.TrimSpace(requestedModel)
	if model == "" {
		model = provider.Model
	}
	if model == "" {
		return CloudModel{}, status.Error(codes.FailedPrecondition, "provider model is not configured")
	}
	if _, err := u.data.PricingFor(provider, model); err != nil {
		return CloudModel{}, err
	}
	return CloudModel{Provider: provider.Name, Model: model, IsDefault: provider.Name == u.data.DefaultProvider}, nil
}

func hasDefaultModel(models []CloudModel) bool {
	for _, model := range models {
		if model.IsDefault {
			return true
		}
	}
	return false
}

func chatRequestHash(provider string, model string, messages []ChatMessage, maxTokens int64) (string, error) {
	hashMessages := make([]platform.CloudAIHashMessage, 0, len(messages))
	for _, message := range messages {
		hashMessages = append(hashMessages, platform.CloudAIHashMessage{Role: message.Role, Content: message.Content})
	}
	return platform.CloudAIRequestHash(provider, model, maxTokens, hashMessages)
}

func validRequestHash(value string) bool {
	return platform.ValidCloudAIRequestHash(value)
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
