package biz

import (
	"context"
	"strings"

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
	accessToken = strings.TrimSpace(accessToken)
	if !strings.HasPrefix(accessToken, "Bearer ") {
		return nil, nil, nil, status.Error(codes.Unauthenticated, "missing_bearer_token")
	}
	identity, err := u.data.Auth.ValidateAccessToken(ctx, &authv1.ValidateAccessTokenRequest{AccessToken: strings.TrimSpace(strings.TrimPrefix(accessToken, "Bearer "))})
	if err != nil {
		return nil, nil, nil, err
	}
	if identity.UserId == "" {
		return nil, nil, nil, status.Error(codes.Unauthenticated, "invalid_token")
	}
	ctx = platform.WithUserIdentity(ctx, identity.UserId)
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
