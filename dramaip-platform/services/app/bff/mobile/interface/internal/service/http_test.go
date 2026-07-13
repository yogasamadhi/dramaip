package service

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
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

func TestMobileDraftQueueIsAuthenticatedAndIdempotent(t *testing.T) {
	router := newTestHTTPService().Router()
	create := httptest.NewRequest(http.MethodPost, "/v1/mobile/drafts", bytes.NewBufferString(`{"client_id":"mobile-draft-0001","kind":"inspiration","capture_mode":"voice","title":"雨夜反转","content":"雨夜里主角发现旧手机。","ai_expansion":""}`))
	create.Header.Set("Authorization", "Bearer mobile-access")
	createRecorder := httptest.NewRecorder()
	router.ServeHTTP(createRecorder, create)
	if createRecorder.Code != http.StatusOK || !bytes.Contains(createRecorder.Body.Bytes(), []byte(`"client_id":"mobile-draft-0001"`)) {
		t.Fatalf("create draft = %d: %s", createRecorder.Code, createRecorder.Body.String())
	}
	list := httptest.NewRequest(http.MethodGet, "/v1/mobile/drafts?limit=10", nil)
	list.Header.Set("Authorization", "Bearer mobile-access")
	listRecorder := httptest.NewRecorder()
	router.ServeHTTP(listRecorder, list)
	if listRecorder.Code != http.StatusOK || !bytes.Contains(listRecorder.Body.Bytes(), []byte(`"drafts"`)) {
		t.Fatalf("list drafts = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}
	unauthorized := httptest.NewRequest(http.MethodPost, "/v1/mobile/drafts", bytes.NewBufferString(`{}`))
	unauthorizedRecorder := httptest.NewRecorder()
	router.ServeHTTP(unauthorizedRecorder, unauthorized)
	if unauthorizedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("invalid anonymous draft = %d: %s", unauthorizedRecorder.Code, unauthorizedRecorder.Body.String())
	}
}

func TestMobileExpansionUsesBoundedAuthenticatedGatewayRequest(t *testing.T) {
	router := newTestHTTPService().Router()
	request := httptest.NewRequest(http.MethodPost, "/v1/mobile/ai/expand", bytes.NewBufferString(`{"idempotency_key":"mobile-expand-0001","kind":"inspiration","content":"雨夜里主角发现旧手机。"}`))
	request.Header.Set("Authorization", "Bearer mobile-access")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"expansion":"一个短梗概"`)) {
		t.Fatalf("mobile expansion = %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Idempotency-Key") != "mobile-expand-0001" { t.Fatalf("missing expansion idempotency header") }
}

func newTestHTTPService() *HTTPService {
	return NewHTTPService(biz.NewBFFUsecase(&data.Data{Auth: fakeAuth{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Inspiration: fakeInspiration{}}))
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

type fakeInspiration struct{}

func (fakeInspiration) UpsertMobileDraft(ctx context.Context, req *inspirationv1.UpsertMobileDraftRequest, _ ...grpc.CallOption) (*inspirationv1.UpsertMobileDraftResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.ClientId != "mobile-draft-0001" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &inspirationv1.UpsertMobileDraftResponse{Draft: fakeDraft()}, nil
}

func (fakeInspiration) ListMobileDrafts(ctx context.Context, req *inspirationv1.ListMobileDraftsRequest, _ ...grpc.CallOption) (*inspirationv1.ListMobileDraftsResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &inspirationv1.ListMobileDraftsResponse{Drafts: []*inspirationv1.MobileDraft{fakeDraft()}}, nil
}

func fakeDraft() *inspirationv1.MobileDraft {
	return &inspirationv1.MobileDraft{Id: "draft-1", ClientId: "mobile-draft-0001", Kind: "inspiration", CaptureMode: "voice", Title: "雨夜反转", Content: "雨夜里主角发现旧手机。"}
}

type fakeAI struct{}

func (fakeAI) ListModels(ctx context.Context, req *aiv1.ListModelsRequest, _ ...grpc.CallOption) (*aiv1.ListModelsReply, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" { return nil, status.Error(codes.PermissionDenied, "identity mismatch") }
	return &aiv1.ListModelsReply{Models: []*aiv1.CloudModel{{Provider: "test", Model: "test-mobile", IsDefault: true}}}, nil
}

func (fakeAI) Chat(ctx context.Context, req *aiv1.ChatRequest, _ ...grpc.CallOption) (*aiv1.ChatReply, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.IdempotencyKey != "mobile-expand-0001" || len(req.Messages) != 2 || req.MaxTokens != 400 { return nil, status.Error(codes.PermissionDenied, "identity mismatch") }
	return &aiv1.ChatReply{Content: "一个短梗概", Provider: "test", Model: "test-mobile", RemainingTokens: 1_619_900}, nil
}
