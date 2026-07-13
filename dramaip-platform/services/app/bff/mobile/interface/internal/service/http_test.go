package service

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMobileSessionAndBriefUseAuthenticatedIdentity(t *testing.T) {
	router := newTestHTTPService().Router()
	login := httptest.NewRequest(http.MethodPost, "/v1/mobile/auth/login", bytes.NewBufferString(`{"email":"creator@example.com","password":"correct-password","device_id":"mobile-device-1"}`))
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, login)
	if loginRecorder.Code != http.StatusOK || !bytes.Contains(loginRecorder.Body.Bytes(), []byte(`"refresh_token":"mobile-refresh"`)) {
		t.Fatalf("login = %d: %s", loginRecorder.Code, loginRecorder.Body.String())
	}
	if got := loginRecorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("login cache-control = %q", got)
	}

	brief := httptest.NewRequest(http.MethodGet, "/v1/mobile/me/brief", nil)
	brief.Header.Set("Authorization", "Bearer mobile-access")
	briefRecorder := httptest.NewRecorder()
	router.ServeHTTP(briefRecorder, brief)
	if briefRecorder.Code != http.StatusOK || !bytes.Contains(briefRecorder.Body.Bytes(), []byte(`"display_name":"Creator"`)) || !bytes.Contains(briefRecorder.Body.Bytes(), []byte(`"remaining_tokens":1620000`)) {
		t.Fatalf("brief = %d: %s", briefRecorder.Code, briefRecorder.Body.String())
	}
	if bytes.Contains(briefRecorder.Body.Bytes(), []byte("creator@example.com")) || bytes.Contains(briefRecorder.Body.Bytes(), []byte("quota_tokens")) {
		t.Fatalf("brief leaked non-mobile fields: %s", briefRecorder.Body.String())
	}

	refresh := httptest.NewRequest(http.MethodPost, "/v1/mobile/auth/refresh", bytes.NewBufferString(`{"refresh_token":"mobile-refresh"}`))
	refreshRecorder := httptest.NewRecorder()
	router.ServeHTTP(refreshRecorder, refresh)
	if refreshRecorder.Code != http.StatusOK || !bytes.Contains(refreshRecorder.Body.Bytes(), []byte(`"access_token":"mobile-access"`)) {
		t.Fatalf("refresh = %d: %s", refreshRecorder.Code, refreshRecorder.Body.String())
	}
}

func TestMobileBriefRequiresBearerAndRejectsInvalidSessionPayload(t *testing.T) {
	router := newTestHTTPService().Router()
	brief := httptest.NewRequest(http.MethodGet, "/v1/mobile/me/brief", nil)
	briefRecorder := httptest.NewRecorder()
	router.ServeHTTP(briefRecorder, brief)
	if briefRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("brief without bearer = %d: %s", briefRecorder.Code, briefRecorder.Body.String())
	}
	bad := httptest.NewRequest(http.MethodPost, "/v1/mobile/auth/login", bytes.NewBufferString(`{"email":"creator@example.com","password":"correct-password","device_id":"x","unexpected":true}`))
	badRecorder := httptest.NewRecorder()
	router.ServeHTTP(badRecorder, bad)
	if badRecorder.Code != http.StatusBadRequest {
		t.Fatalf("bad login payload = %d: %s", badRecorder.Code, badRecorder.Body.String())
	}
}

func TestMobileMetricsAreAvailableWithoutSession(t *testing.T) {
	router := newTestHTTPService().Router()
	metrics := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, metrics)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte("dramaip_mobile_bff_http_requests_total")) {
		t.Fatalf("metrics = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func newTestHTTPService() *HTTPService {
	return NewHTTPService(biz.NewBFFUsecase(&data.Data{Auth: fakeAuth{}, Billing: fakeBilling{}, Quota: fakeQuota{}}))
}

type fakeAuth struct{}

func (fakeAuth) Login(_ context.Context, req *authv1.LoginRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.Email != "creator@example.com" || req.Password != "correct-password" || req.DeviceId != "mobile-device-1" {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	return mobileSession(), nil
}

func (fakeAuth) Refresh(_ context.Context, req *authv1.RefreshRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.RefreshToken != "mobile-refresh" {
		return nil, status.Error(codes.Unauthenticated, "invalid refresh token")
	}
	return mobileSession(), nil
}

func (fakeAuth) Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error) {
	return &authv1.LogoutReply{Ok: true}, nil
}

func (fakeAuth) ValidateAccessToken(_ context.Context, req *authv1.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AccessToken != "mobile-access" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &authv1.AuthReply{UserId: "u1", Email: "creator@example.com", Name: "Creator"}, nil
}

func mobileSession() *authv1.AuthReply {
	return &authv1.AuthReply{AccessToken: "mobile-access", RefreshToken: "mobile-refresh", ExpiresIn: 900, TokenType: "Bearer", UserId: "u1", Name: "Creator"}
}

type fakeBilling struct{}

func (fakeBilling) GetSubscription(ctx context.Context, req *billingv1.GetSubscriptionRequest, _ ...grpc.CallOption) (*billingv1.Subscription, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &billingv1.Subscription{UserId: "u1", PlanCode: "pro", Status: "active"}, nil
}

type fakeQuota struct{}

func (fakeQuota) GetTokenBalance(ctx context.Context, req *quotav1.GetTokenBalanceRequest, _ ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &quotav1.TokenBalance{Plan: "pro", QuotaTokens: 2_000_000, UsedTokens: 380_000, RemainingTokens: 1_620_000}, nil
}
