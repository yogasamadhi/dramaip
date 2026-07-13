package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDesktopTokenExchangeAndContext(t *testing.T) {
	router := newTestHTTPService().Router()
	exchange := httptest.NewRequest(http.MethodPost, "/v1/desktop/auth/token", bytes.NewBufferString(`{"authorization_code":"one-time-code","code_verifier":"verifier","redirect_uri":"http://127.0.0.1:43123/callback","device_id":"desktop-12345678"}`))
	exchangeRecorder := httptest.NewRecorder()
	router.ServeHTTP(exchangeRecorder, exchange)
	if exchangeRecorder.Code != http.StatusOK {
		t.Fatalf("exchange status = %d: %s", exchangeRecorder.Code, exchangeRecorder.Body.String())
	}
	var session map[string]any
	if err := json.NewDecoder(exchangeRecorder.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	if session["access_token"] == "" || session["refresh_token"] == "" || session["user"] == nil {
		t.Fatalf("desktop exchange session = %#v", session)
	}

	contextRequest := httptest.NewRequest(http.MethodGet, "/v1/desktop/me/cloud-context", nil)
	contextRequest.Header.Set("Authorization", "Bearer desktop-access")
	contextRecorder := httptest.NewRecorder()
	router.ServeHTTP(contextRecorder, contextRequest)
	if contextRecorder.Code != http.StatusOK {
		t.Fatalf("cloud context status = %d: %s", contextRecorder.Code, contextRecorder.Body.String())
	}
	if body := contextRecorder.Body.String(); !bytes.Contains([]byte(body), []byte(`"plan":"pro"`)) || !bytes.Contains([]byte(body), []byte(`"remaining_tokens":1620000`)) {
		t.Fatalf("cloud context = %s", body)
	}
}

func TestDesktopTokenExchangeRejectsInvalidPayloadAndContextRequiresBearer(t *testing.T) {
	router := newTestHTTPService().Router()
	badPayload := httptest.NewRequest(http.MethodPost, "/v1/desktop/auth/token", bytes.NewBufferString(`{"authorization_code":"code","unexpected":true}`))
	badRecorder := httptest.NewRecorder()
	router.ServeHTTP(badRecorder, badPayload)
	if badRecorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid payload status = %d: %s", badRecorder.Code, badRecorder.Body.String())
	}
	contextRequest := httptest.NewRequest(http.MethodGet, "/v1/desktop/me/cloud-context", nil)
	contextRecorder := httptest.NewRecorder()
	router.ServeHTTP(contextRecorder, contextRequest)
	if contextRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing bearer status = %d: %s", contextRecorder.Code, contextRecorder.Body.String())
	}
}

func newTestHTTPService() *HTTPService {
	return NewHTTPService(biz.NewBFFUsecase(&data.Data{Auth: fakeAuth{}, Billing: fakeBilling{}, Quota: fakeQuota{}}))
}

type fakeAuth struct{}

func (fakeAuth) ExchangeDesktopAuthorizationCode(_ context.Context, req *authv1.ExchangeDesktopAuthorizationCodeRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AuthorizationCode != "one-time-code" || req.CodeVerifier != "verifier" || req.RedirectUri != "http://127.0.0.1:43123/callback" || req.DeviceId != "desktop-12345678" {
		return nil, status.Error(codes.InvalidArgument, "invalid exchange")
	}
	return desktopSession(), nil
}

func (fakeAuth) Refresh(context.Context, *authv1.RefreshRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return desktopSession(), nil
}

func (fakeAuth) Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error) {
	return &authv1.LogoutReply{Ok: true}, nil
}

func (fakeAuth) ValidateAccessToken(_ context.Context, req *authv1.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AccessToken != "desktop-access" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &authv1.AuthReply{UserId: "u1", Email: "creator@example.com", Name: "Creator"}, nil
}

func desktopSession() *authv1.AuthReply {
	return &authv1.AuthReply{AccessToken: "desktop-access", RefreshToken: "desktop-refresh", ExpiresIn: 900, TokenType: "Bearer", UserId: "u1", Email: "creator@example.com", Name: "Creator"}
}

type fakeBilling struct{}

func (fakeBilling) GetSubscription(ctx context.Context, req *billingv1.GetSubscriptionRequest, _ ...grpc.CallOption) (*billingv1.Subscription, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &billingv1.Subscription{Id: "sub-1", UserId: "u1", PlanCode: "pro", Status: "active"}, nil
}

type fakeQuota struct{}

func (fakeQuota) GetTokenBalance(ctx context.Context, req *quotav1.GetTokenBalanceRequest, _ ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &quotav1.TokenBalance{Plan: "pro", QuotaTokens: 2_000_000, UsedTokens: 380_000, RemainingTokens: 1_620_000}, nil
}
