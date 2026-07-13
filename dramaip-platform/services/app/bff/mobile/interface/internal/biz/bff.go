package biz

import (
	"context"
	"strings"
	"unicode/utf8"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type BFFUsecase struct{ data *data.Data }

func NewBFFUsecase(data *data.Data) *BFFUsecase { return &BFFUsecase{data: data} }

func (u *BFFUsecase) Login(ctx context.Context, email, password, deviceID string) (*authv1.AuthReply, error) {
	return u.data.Auth.Login(ctx, &authv1.LoginRequest{Email: strings.TrimSpace(email), Password: password, DeviceId: strings.TrimSpace(deviceID)})
}

func (u *BFFUsecase) Refresh(ctx context.Context, refreshToken string) (*authv1.AuthReply, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, status.Error(codes.InvalidArgument, "missing_refresh_token")
	}
	return u.data.Auth.Refresh(ctx, &authv1.RefreshRequest{RefreshToken: strings.TrimSpace(refreshToken)})
}

func (u *BFFUsecase) Logout(ctx context.Context, refreshToken, accessToken, deviceID string) (*authv1.LogoutReply, error) {
	return u.data.Auth.Logout(ctx, &authv1.LogoutRequest{RefreshToken: strings.TrimSpace(refreshToken), AccessToken: strings.TrimSpace(accessToken), DeviceId: strings.TrimSpace(deviceID)})
}

func (u *BFFUsecase) Brief(ctx context.Context, accessToken string) (*authv1.AuthReply, *billingv1.Subscription, *quotav1.TokenBalance, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, nil, nil, err
	}
	subscription, err := u.data.Billing.GetSubscription(ctx, &billingv1.GetSubscriptionRequest{UserId: identity.UserId})
	if err != nil {
		return nil, nil, nil, err
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: identity.UserId})
	if err != nil {
		return nil, nil, nil, err
	}
	return identity, subscription, balance, nil
}

func (u *BFFUsecase) UpsertDraft(ctx context.Context, accessToken, clientID, kind, captureMode, title, content, aiExpansion string) (*inspirationv1.MobileDraft, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	reply, err := u.data.Inspiration.UpsertMobileDraft(ctx, &inspirationv1.UpsertMobileDraftRequest{
		UserId: identity.UserId, ClientId: strings.TrimSpace(clientID), Kind: strings.TrimSpace(kind), CaptureMode: strings.TrimSpace(captureMode),
		Title: strings.TrimSpace(title), Content: strings.TrimSpace(content), AiExpansion: strings.TrimSpace(aiExpansion),
	})
	if err != nil {
		return nil, err
	}
	if reply.Draft == nil {
		return nil, status.Error(codes.Unavailable, "mobile_draft_reply_invalid")
	}
	return reply.Draft, nil
}

func (u *BFFUsecase) ListDrafts(ctx context.Context, accessToken string, limit int32) ([]*inspirationv1.MobileDraft, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	reply, err := u.data.Inspiration.ListMobileDrafts(ctx, &inspirationv1.ListMobileDraftsRequest{UserId: identity.UserId, Limit: limit})
	if err != nil {
		return nil, err
	}
	return reply.Drafts, nil
}

// Expand uses the existing gateway, which keeps quota, idempotency and the
// Provider boundary centralized. Only the user-selected short text is sent;
// project databases, file paths, audio and device metadata never leave mobile.
func (u *BFFUsecase) Expand(ctx context.Context, accessToken, idempotencyKey, kind, content string) (*aiv1.ChatReply, error) {
	idempotencyKey, kind, content = strings.TrimSpace(idempotencyKey), strings.TrimSpace(kind), strings.TrimSpace(content)
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || !validDraftKind(kind) || content == "" || utf8.RuneCountInString(content) > 1_500 {
		return nil, status.Error(codes.InvalidArgument, "invalid_mobile_expansion")
	}
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	models, err := u.data.AI.ListModels(ctx, &aiv1.ListModelsRequest{UserId: identity.UserId})
	if err != nil {
		return nil, err
	}
	model := selectDefaultModel(models.Models)
	if model == nil {
		return nil, status.Error(codes.Unavailable, "mobile_ai_model_unavailable")
	}
	return u.data.AI.Chat(ctx, &aiv1.ChatRequest{
		UserId: identity.UserId, RequestId: idempotencyKey, IdempotencyKey: idempotencyKey, Provider: model.Provider, Model: model.Model, MaxTokens: 400,
		Messages: []*aiv1.ChatMessage{
			{Role: "system", Content: "将一条移动端轻量草稿扩写为简洁故事梗概，不添加未提供的个人信息。"},
			{Role: "user", Content: "草稿类型：" + kind + "\n内容：" + content},
		},
	})
}

func validDraftKind(value string) bool {
	return value == "inspiration" || value == "character" || value == "project"
}

func selectDefaultModel(models []*aiv1.CloudModel) *aiv1.CloudModel {
	for _, model := range models {
		if model != nil && model.IsDefault && model.Provider != "" && model.Model != "" {
			return model
		}
	}
	for _, model := range models {
		if model != nil && model.Provider != "" && model.Model != "" {
			return model
		}
	}
	return nil
}

func (u *BFFUsecase) authenticate(ctx context.Context, accessToken string) (*authv1.AuthReply, context.Context, error) {
	accessToken = strings.TrimSpace(accessToken)
	if !strings.HasPrefix(accessToken, "Bearer ") {
		return nil, nil, status.Error(codes.Unauthenticated, "missing_bearer_token")
	}
	identity, err := u.data.Auth.ValidateAccessToken(ctx, &authv1.ValidateAccessTokenRequest{AccessToken: strings.TrimSpace(strings.TrimPrefix(accessToken, "Bearer "))})
	if err != nil {
		return nil, nil, err
	}
	if identity.UserId == "" {
		return nil, nil, status.Error(codes.Unauthenticated, "invalid_token")
	}
	return identity, platform.WithUserIdentity(ctx, identity.UserId), nil
}
