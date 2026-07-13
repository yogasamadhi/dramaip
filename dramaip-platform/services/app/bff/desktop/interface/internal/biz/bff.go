package biz

import (
	"context"
	"strings"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type BFFUsecase struct{ data *data.Data }

func NewBFFUsecase(data *data.Data) *BFFUsecase { return &BFFUsecase{data: data} }

func (u *BFFUsecase) Exchange(ctx context.Context, code, verifier, redirectURI, deviceID string) (*authv1.AuthReply, error) {
	return u.data.Auth.ExchangeDesktopAuthorizationCode(ctx, &authv1.ExchangeDesktopAuthorizationCodeRequest{
		AuthorizationCode: strings.TrimSpace(code), CodeVerifier: strings.TrimSpace(verifier), RedirectUri: strings.TrimSpace(redirectURI), DeviceId: strings.TrimSpace(deviceID),
	})
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

func (u *BFFUsecase) Context(ctx context.Context, accessToken string) (*authv1.AuthReply, *billingv1.Subscription, *quotav1.TokenBalance, error) {
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

func (u *BFFUsecase) ListCloudModels(ctx context.Context, accessToken string) (*aiv1.ListModelsReply, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return u.data.AI.ListModels(ctx, &aiv1.ListModelsRequest{UserId: identity.UserId})
}

func (u *BFFUsecase) PreflightCloudAI(ctx context.Context, accessToken string, provider, model string, contextCharacters, messageCount, maxTokens int64) (*aiv1.PreflightReply, *quotav1.TokenBalance, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, nil, err
	}
	preflight, err := u.data.AI.Preflight(ctx, &aiv1.PreflightRequest{
		UserId: identity.UserId, Provider: strings.TrimSpace(provider), Model: strings.TrimSpace(model),
		ContextCharacters: contextCharacters, MessageCount: messageCount, MaxTokens: maxTokens,
	})
	if err != nil {
		return nil, nil, err
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: identity.UserId})
	if err != nil {
		return nil, nil, err
	}
	return preflight, balance, nil
}

func (u *BFFUsecase) ChatCloudAI(ctx context.Context, accessToken, requestID, idempotencyKey, clientIP, provider, model string, messages []*aiv1.ChatMessage, maxTokens int64) (*aiv1.ChatReply, error) {
	identity, ctx, err := u.authenticate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return u.data.AI.Chat(ctx, &aiv1.ChatRequest{
		UserId: identity.UserId, RequestId: strings.TrimSpace(requestID), IdempotencyKey: strings.TrimSpace(idempotencyKey), ClientIp: strings.TrimSpace(clientIP),
		Provider: strings.TrimSpace(provider), Model: strings.TrimSpace(model), Messages: messages, MaxTokens: maxTokens,
	})
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
