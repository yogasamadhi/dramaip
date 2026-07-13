package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
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

func TestDesktopCloudAIUsesAuthenticatedIdentityAndBoundedContext(t *testing.T) {
	router := newTestHTTPService().Router()
	models := httptest.NewRequest(http.MethodGet, "/v1/desktop/ai/models", nil)
	models.Header.Set("Authorization", "Bearer desktop-access")
	modelsRecorder := httptest.NewRecorder()
	router.ServeHTTP(modelsRecorder, models)
	if modelsRecorder.Code != http.StatusOK || !bytes.Contains(modelsRecorder.Body.Bytes(), []byte(`"provider":"test"`)) {
		t.Fatalf("models = %d: %s", modelsRecorder.Code, modelsRecorder.Body.String())
	}

	preflight := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/preflight", bytes.NewBufferString(`{"provider":"test","model":"test-dramaip-chat","context_characters":42,"message_count":2,"max_tokens":32}`))
	preflight.Header.Set("Authorization", "Bearer desktop-access")
	preflightRecorder := httptest.NewRecorder()
	router.ServeHTTP(preflightRecorder, preflight)
	if preflightRecorder.Code != http.StatusOK || !bytes.Contains(preflightRecorder.Body.Bytes(), []byte(`"remaining_tokens":1620000`)) {
		t.Fatalf("preflight = %d: %s", preflightRecorder.Code, preflightRecorder.Body.String())
	}

	chat := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/chat", bytes.NewBufferString(`{"request_id":"desktop-call-1","idempotency_key":"desktop-call-1","provider":"test","model":"test-dramaip-chat","max_tokens":32,"messages":[{"role":"system","content":"short instruction"},{"role":"user","content":"write one line"}]}`))
	chat.Header.Set("Authorization", "Bearer desktop-access")
	chat.Header.Set("X-Forwarded-For", "198.51.100.42")
	chatRecorder := httptest.NewRecorder()
	router.ServeHTTP(chatRecorder, chat)
	if chatRecorder.Code != http.StatusOK || !bytes.Contains(chatRecorder.Body.Bytes(), []byte(`"content":"cloud result"`)) {
		t.Fatalf("chat = %d: %s", chatRecorder.Code, chatRecorder.Body.String())
	}
	if got := chatRecorder.Header().Get("Idempotency-Key"); got != "desktop-call-1" {
		t.Fatalf("idempotency header = %q", got)
	}

	oversized := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/chat", bytes.NewBufferString(`{"request_id":"desktop-call-2","idempotency_key":"desktop-call-2","provider":"test","model":"test-dramaip-chat","max_tokens":32,"messages":[{"role":"user","content":""}]}`))
	oversized.Header.Set("Authorization", "Bearer desktop-access")
	oversizedRecorder := httptest.NewRecorder()
	router.ServeHTTP(oversizedRecorder, oversized)
	if oversizedRecorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid cloud chat = %d: %s", oversizedRecorder.Code, oversizedRecorder.Body.String())
	}
}

func TestDesktopCloudAIMapsGatewayFailuresWithoutRetry(t *testing.T) {
	router := newTestHTTPService().Router()
	for _, test := range []struct {
		name       string
		model      string
		wantStatus int
	}{
		{name: "deadline", model: "timeout", wantStatus: http.StatusGatewayTimeout},
		{name: "unavailable", model: "unavailable", wantStatus: http.StatusServiceUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"request_id":"desktop-` + test.name + `","idempotency_key":"desktop-` + test.name + `","provider":"test","model":"` + test.model + `","max_tokens":32,"messages":[{"role":"user","content":"single bounded prompt"}]}`
			request := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/chat", bytes.NewBufferString(body))
			request.Header.Set("Authorization", "Bearer desktop-access")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestDesktopMobileHandoffRequiresIdentityAndRecordsExplicitAdoption(t *testing.T) {
	router := newTestHTTPService().Router()
	list := httptest.NewRequest(http.MethodGet, "/v1/desktop/mobile-handoff?limit=10", nil)
	list.Header.Set("Authorization", "Bearer desktop-access")
	listRecorder := httptest.NewRecorder()
	router.ServeHTTP(listRecorder, list)
	if listRecorder.Code != http.StatusOK || !bytes.Contains(listRecorder.Body.Bytes(), []byte(`"title":"雨夜反转"`)) {
		t.Fatalf("handoff list = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}

	adopt := httptest.NewRequest(http.MethodPost, "/v1/desktop/mobile-handoff/adopt", bytes.NewBufferString(`{"draft_id":"draft-1","idempotency_key":"desktop-adopt-0001"}`))
	adopt.Header.Set("Authorization", "Bearer desktop-access")
	adoptRecorder := httptest.NewRecorder()
	router.ServeHTTP(adoptRecorder, adopt)
	if adoptRecorder.Code != http.StatusOK || !bytes.Contains(adoptRecorder.Body.Bytes(), []byte(`"capture_mode":"voice"`)) {
		t.Fatalf("handoff adoption = %d: %s", adoptRecorder.Code, adoptRecorder.Body.String())
	}
}

func newTestHTTPService() *HTTPService {
	return NewHTTPService(biz.NewBFFUsecase(&data.Data{Auth: fakeAuth{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Inspiration: fakeInspiration{}}))
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

type fakeAI struct{}

func (fakeAI) ListModels(ctx context.Context, req *aiv1.ListModelsRequest, _ ...grpc.CallOption) (*aiv1.ListModelsReply, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &aiv1.ListModelsReply{Models: []*aiv1.CloudModel{{Provider: "test", Model: "test-dramaip-chat", IsDefault: true}}}, nil
}

func (fakeAI) Preflight(ctx context.Context, req *aiv1.PreflightRequest, _ ...grpc.CallOption) (*aiv1.PreflightReply, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" || req.ContextCharacters < 1 || req.MessageCount < 1 || req.MaxTokens < 1 {
		return nil, status.Error(codes.InvalidArgument, "invalid preflight")
	}
	return &aiv1.PreflightReply{Model: &aiv1.CloudModel{Provider: "test", Model: "test-dramaip-chat", IsDefault: true}, EstimatedTokens: req.ContextCharacters/4 + req.MaxTokens}, nil
}

func (fakeAI) Chat(ctx context.Context, req *aiv1.ChatRequest, _ ...grpc.CallOption) (*aiv1.ChatReply, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	if req.Model == "timeout" {
		return nil, status.Error(codes.DeadlineExceeded, "provider timeout")
	}
	if req.Model == "unavailable" {
		return nil, status.Error(codes.Unavailable, "provider unavailable")
	}
	if req.IdempotencyKey != "desktop-call-1" || req.ClientIp != "198.51.100.42" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &aiv1.ChatReply{Content: "cloud result", Provider: "test", Model: "test-dramaip-chat", RequestId: req.RequestId, TotalTokens: 12, RemainingTokens: 1_619_988, Status: "succeeded"}, nil
}

type fakeInspiration struct{}

func (fakeInspiration) ListMobileDrafts(ctx context.Context, req *inspirationv1.ListMobileDraftsRequest, _ ...grpc.CallOption) (*inspirationv1.ListMobileDraftsResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" { return nil, status.Error(codes.PermissionDenied, "identity mismatch") }
	return &inspirationv1.ListMobileDraftsResponse{Drafts: []*inspirationv1.MobileDraft{fakeMobileDraft()}}, nil
}

func (fakeInspiration) RecordMobileDraftAdoption(ctx context.Context, req *inspirationv1.RecordMobileDraftAdoptionRequest, _ ...grpc.CallOption) (*inspirationv1.RecordMobileDraftAdoptionResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.DraftId != "draft-1" || req.IdempotencyKey != "desktop-adopt-0001" { return nil, status.Error(codes.PermissionDenied, "identity mismatch") }
	return &inspirationv1.RecordMobileDraftAdoptionResponse{Draft: fakeMobileDraft()}, nil
}

func fakeMobileDraft() *inspirationv1.MobileDraft {
	return &inspirationv1.MobileDraft{Id: "draft-1", ClientId: "mobile-draft-0001", Kind: "inspiration", CaptureMode: "voice", Title: "雨夜反转", Content: "雨夜里主角发现旧手机。"}
}
