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
	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	snapshotv1 "github.com/dramaip/dramaip-platform/services/api/snapshot/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
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
	if body := contextRecorder.Body.String(); !bytes.Contains([]byte(body), []byte(`"plan":"studio"`)) || !bytes.Contains([]byte(body), []byte(`"remaining_tokens":1620000`)) {
		t.Fatalf("cloud context = %s", body)
	}
}

func TestDesktopWorkspacesUseAuthenticatedIdentity(t *testing.T) {
	router := newTestHTTPService().Router()
	request := httptest.NewRequest(http.MethodGet, "/v1/desktop/me/workspaces", nil)
	request.Header.Set("Authorization", "Bearer desktop-access")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"plan_code":"studio"`)) {
		t.Fatalf("workspaces = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestDesktopProductEventsAreAnonymousStrictAndBounded(t *testing.T) {
	router := newTestHTTPService().Router()
	body := `{"events":[{"installation_id":"11111111-1111-4111-8111-111111111111","event_id":"22222222-2222-4222-8222-222222222222","app_version":"2.0.0","operating_system":"darwin","event_name":"demo_opened","duration_bucket":"","result_code":""}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/desktop/analytics/events", bytes.NewBufferString(body))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted || !bytes.Contains(recorder.Body.Bytes(), []byte("22222222-2222-4222-8222-222222222222")) {
		t.Fatalf("product events = %d: %s", recorder.Code, recorder.Body.String())
	}
	unknown := httptest.NewRequest(http.MethodPost, "/v1/desktop/analytics/events", bytes.NewBufferString(`{"events":[],"project_id":"forbidden"}`))
	unknownRecorder := httptest.NewRecorder()
	router.ServeHTTP(unknownRecorder, unknown)
	if unknownRecorder.Code != http.StatusBadRequest {
		t.Fatalf("unknown analytics field = %d: %s", unknownRecorder.Code, unknownRecorder.Body.String())
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

	const requestHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	preflight := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/preflight", bytes.NewBufferString(`{"provider":"test","model":"test-dramaip-chat","context_characters":42,"message_count":2,"max_tokens":32,"request_hash":"`+requestHash+`"}`))
	preflight.Header.Set("Authorization", "Bearer desktop-access")
	preflightRecorder := httptest.NewRecorder()
	router.ServeHTTP(preflightRecorder, preflight)
	if preflightRecorder.Code != http.StatusOK || !bytes.Contains(preflightRecorder.Body.Bytes(), []byte(`"remaining_tokens":1620000`)) {
		t.Fatalf("preflight = %d: %s", preflightRecorder.Code, preflightRecorder.Body.String())
	}

	chat := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/chat", bytes.NewBufferString(`{"request_id":"desktop-call-1","idempotency_key":"desktop-call-1","provider":"test","model":"test-dramaip-chat","max_tokens":32,"preflight_request_hash":"`+requestHash+`","messages":[{"role":"system","content":"short instruction"},{"role":"user","content":"write one line"}]}`))
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
			body := `{"request_id":"desktop-` + test.name + `","idempotency_key":"desktop-` + test.name + `","provider":"test","model":"` + test.model + `","max_tokens":32,"preflight_request_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","messages":[{"role":"user","content":"single bounded prompt"}]}`
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

func TestDesktopCloudAIStopsBeforeProviderWhenQuotaIsInsufficient(t *testing.T) {
	chatCalls := 0
	router := newTestHTTPServiceWith(fakeQuota{remainingTokens: 1}, fakeAI{chatCalls: &chatCalls}).Router()
	const requestHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	body := `{"request_id":"desktop-low-quota","idempotency_key":"desktop-low-quota","provider":"test","model":"test-dramaip-chat","max_tokens":32,"preflight_request_hash":"` + requestHash + `","messages":[{"role":"user","content":"single bounded prompt"}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/desktop/ai/chat", bytes.NewBufferString(body))
	request.Header.Set("Authorization", "Bearer desktop-access")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests || !bytes.Contains(recorder.Body.Bytes(), []byte("cloud_quota_insufficient")) {
		t.Fatalf("low quota status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("provider chat calls = %d, want 0", chatCalls)
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

func TestDesktopProjectSnapshotsStayOpaqueAndUseAuthenticatedIdentity(t *testing.T) {
	router := newTestHTTPService().Router()
	create := httptest.NewRequest(http.MethodPost, "/v1/desktop/project-snapshots", bytes.NewBufferString(`{"idempotency_key":"snapshot-upload-0001","encrypted_envelope":"ZW5jcnlwdGVkLWVudmVsb3Bl"}`))
	create.Header.Set("Authorization", "Bearer desktop-access")
	createRecorder := httptest.NewRecorder()
	router.ServeHTTP(createRecorder, create)
	if createRecorder.Code != http.StatusCreated || !bytes.Contains(createRecorder.Body.Bytes(), []byte(`"encrypted_sha256"`)) || bytes.Contains(createRecorder.Body.Bytes(), []byte(`encrypted-envelope`)) {
		t.Fatalf("snapshot create = %d: %s", createRecorder.Code, createRecorder.Body.String())
	}
	if got := createRecorder.Header().Get("Idempotency-Key"); got != "snapshot-upload-0001" {
		t.Fatalf("idempotency header = %q", got)
	}

	list := httptest.NewRequest(http.MethodGet, "/v1/desktop/project-snapshots", nil)
	list.Header.Set("Authorization", "Bearer desktop-access")
	listRecorder := httptest.NewRecorder()
	router.ServeHTTP(listRecorder, list)
	if listRecorder.Code != http.StatusOK || !bytes.Contains(listRecorder.Body.Bytes(), []byte(`"id":"snapshot-1"`)) || bytes.Contains(listRecorder.Body.Bytes(), []byte(`encrypted_envelope`)) {
		t.Fatalf("snapshot list = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}

	download := httptest.NewRequest(http.MethodGet, "/v1/desktop/project-snapshots/download?id=snapshot-1", nil)
	download.Header.Set("Authorization", "Bearer desktop-access")
	downloadRecorder := httptest.NewRecorder()
	router.ServeHTTP(downloadRecorder, download)
	if downloadRecorder.Code != http.StatusOK || !bytes.Contains(downloadRecorder.Body.Bytes(), []byte(`"encrypted_envelope":"ZW5jcnlwdGVkLWVudmVsb3Bl"`)) {
		t.Fatalf("snapshot download = %d: %s", downloadRecorder.Code, downloadRecorder.Body.String())
	}

	deleted := httptest.NewRequest(http.MethodDelete, "/v1/desktop/project-snapshots?id=snapshot-1", nil)
	deleted.Header.Set("Authorization", "Bearer desktop-access")
	deletedRecorder := httptest.NewRecorder()
	router.ServeHTTP(deletedRecorder, deleted)
	if deletedRecorder.Code != http.StatusOK || !bytes.Contains(deletedRecorder.Body.Bytes(), []byte(`"snapshot_id":"snapshot-1"`)) {
		t.Fatalf("snapshot delete = %d: %s", deletedRecorder.Code, deletedRecorder.Body.String())
	}
}

func TestDesktopProjectSnapshotUploadResumesOpaqueChunks(t *testing.T) {
	router := newTestHTTPService().Router()
	start := httptest.NewRequest(http.MethodPost, "/v1/desktop/project-snapshot-uploads", bytes.NewBufferString(`{"idempotency_key":"snapshot-resume-0001","encrypted_bytes":8388609,"encrypted_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	start.Header.Set("Authorization", "Bearer desktop-access")
	startRecorder := httptest.NewRecorder()
	router.ServeHTTP(startRecorder, start)
	if startRecorder.Code != http.StatusCreated || !bytes.Contains(startRecorder.Body.Bytes(), []byte(`"received_chunk_indexes":[0]`)) || bytes.Contains(startRecorder.Body.Bytes(), []byte("opaque-chunk")) {
		t.Fatalf("upload start = %d: %s", startRecorder.Code, startRecorder.Body.String())
	}

	chunk := httptest.NewRequest(http.MethodPost, "/v1/desktop/project-snapshot-uploads/chunks", bytes.NewBufferString(`{"upload_id":"upload-1","chunk_index":0,"encrypted_chunk":"b3BhcXVlLWNodW5r","encrypted_chunk_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	chunk.Header.Set("Authorization", "Bearer desktop-access")
	chunkRecorder := httptest.NewRecorder()
	router.ServeHTTP(chunkRecorder, chunk)
	if chunkRecorder.Code != http.StatusOK || !bytes.Contains(chunkRecorder.Body.Bytes(), []byte(`"upload"`)) || bytes.Contains(chunkRecorder.Body.Bytes(), []byte("opaque-chunk")) {
		t.Fatalf("upload chunk = %d: %s", chunkRecorder.Code, chunkRecorder.Body.String())
	}

	complete := httptest.NewRequest(http.MethodPost, "/v1/desktop/project-snapshot-uploads/complete", bytes.NewBufferString(`{"upload_id":"upload-1"}`))
	complete.Header.Set("Authorization", "Bearer desktop-access")
	completeRecorder := httptest.NewRecorder()
	router.ServeHTTP(completeRecorder, complete)
	if completeRecorder.Code != http.StatusCreated || !bytes.Contains(completeRecorder.Body.Bytes(), []byte(`"snapshot"`)) {
		t.Fatalf("upload complete = %d: %s", completeRecorder.Code, completeRecorder.Body.String())
	}
}

func newTestHTTPService() *HTTPService {
	return newTestHTTPServiceWith(fakeQuota{}, fakeAI{})
}

func newTestHTTPServiceWith(quota fakeQuota, ai fakeAI) *HTTPService {
	return NewHTTPService(biz.NewBFFUsecase(&data.Data{Auth: fakeAuth{}, Billing: fakeBilling{}, Quota: quota, AI: ai, Inspiration: fakeInspiration{}, Snapshot: fakeSnapshot{}, User: fakeUser{}, Reporting: fakeReporting{}}))
}

type fakeReporting struct{}

func (fakeReporting) RecordProductEvents(_ context.Context, request *reportingv1.RecordProductEventsRequest, _ ...grpc.CallOption) (*reportingv1.RecordProductEventsResponse, error) {
	accepted := make([]string, 0, len(request.Events))
	for _, event := range request.Events {
		accepted = append(accepted, event.EventId)
	}
	return &reportingv1.RecordProductEventsResponse{AcceptedEventIds: accepted}, nil
}

type fakeUser struct{}

func (fakeUser) ListWorkspaces(_ context.Context, request *userv1.ListWorkspacesRequest, _ ...grpc.CallOption) (*userv1.ListWorkspacesReply, error) {
	if request.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "wrong user")
	}
	return &userv1.ListWorkspacesReply{Workspaces: []*userv1.Workspace{{
		Id: "workspace-studio-1", OwnerUserId: request.UserId, Name: "样片工作区", PlanCode: "studio",
		IncludedSeats: 5, ActiveMemberCount: 1, CurrentUserRole: "owner",
		ReviewStorageBytes: 5_000_000_000, ReviewRetentionDays: 30,
	}}}, nil
}

func (fakeUser) SetWorkspacePlan(_ context.Context, request *userv1.SetWorkspacePlanRequest, _ ...grpc.CallOption) (*userv1.Workspace, error) {
	return &userv1.Workspace{
		Id: request.WorkspaceId, OwnerUserId: "u1", Name: "样片工作区", PlanCode: request.PlanCode,
		IncludedSeats: request.IncludedSeats, ActiveMemberCount: 1, CurrentUserRole: "owner",
		ReviewStorageBytes: request.ReviewStorageBytes, ReviewRetentionDays: request.ReviewRetentionDays,
	}, nil
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
	return &billingv1.Subscription{
		Id: "sub-1", UserId: "u1", PlanCode: "studio", Status: "active",
		Entitlements: &billingv1.PlanEntitlements{
			IncludedSeats: 5, ByokEnabled: true, OfflineReviewEnabled: true,
			AdvancedExportEnabled: true, CloudReviewEnabled: true,
			ReviewStorageBytes: 5_000_000_000, ReviewRetentionDays: 30,
		},
	}, nil
}

type fakeQuota struct{ remainingTokens int64 }

func (f fakeQuota) GetTokenBalance(ctx context.Context, req *quotav1.GetTokenBalanceRequest, _ ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	remainingTokens := f.remainingTokens
	if remainingTokens == 0 {
		remainingTokens = 1_620_000
	}
	return &quotav1.TokenBalance{Plan: "pro", QuotaTokens: 2_000_000, UsedTokens: 2_000_000 - remainingTokens, RemainingTokens: remainingTokens}, nil
}

type fakeAI struct{ chatCalls *int }

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
	return &aiv1.PreflightReply{Model: &aiv1.CloudModel{Provider: "test", Model: "test-dramaip-chat", IsDefault: true}, EstimatedTokens: req.ContextCharacters/4 + req.MaxTokens, RequestHash: req.RequestHash}, nil
}

func (f fakeAI) Chat(ctx context.Context, req *aiv1.ChatRequest, _ ...grpc.CallOption) (*aiv1.ChatReply, error) {
	if f.chatCalls != nil {
		(*f.chatCalls)++
	}
	if platform.UserIdentity(ctx) != req.UserId || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	if req.Model == "timeout" {
		return nil, status.Error(codes.DeadlineExceeded, "provider timeout")
	}
	if req.Model == "unavailable" {
		return nil, status.Error(codes.Unavailable, "provider unavailable")
	}
	if req.IdempotencyKey != "desktop-call-1" || req.ClientIp != "198.51.100.42" || req.PreflightRequestHash != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &aiv1.ChatReply{Content: "cloud result", Provider: "test", Model: "test-dramaip-chat", RequestId: req.RequestId, TotalTokens: 12, RemainingTokens: 1_619_988, Status: "succeeded"}, nil
}

type fakeInspiration struct{}

func (fakeInspiration) ListMobileDrafts(ctx context.Context, req *inspirationv1.ListMobileDraftsRequest, _ ...grpc.CallOption) (*inspirationv1.ListMobileDraftsResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &inspirationv1.ListMobileDraftsResponse{Drafts: []*inspirationv1.MobileDraft{fakeMobileDraft()}}, nil
}

func (fakeInspiration) RecordMobileDraftAdoption(ctx context.Context, req *inspirationv1.RecordMobileDraftAdoptionRequest, _ ...grpc.CallOption) (*inspirationv1.RecordMobileDraftAdoptionResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.DraftId != "draft-1" || req.IdempotencyKey != "desktop-adopt-0001" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &inspirationv1.RecordMobileDraftAdoptionResponse{Draft: fakeMobileDraft()}, nil
}

func fakeMobileDraft() *inspirationv1.MobileDraft {
	return &inspirationv1.MobileDraft{Id: "draft-1", ClientId: "mobile-draft-0001", Kind: "inspiration", CaptureMode: "voice", Title: "雨夜反转", Content: "雨夜里主角发现旧手机。"}
}

type fakeSnapshot struct{}

func (fakeSnapshot) CreateProjectSnapshot(ctx context.Context, req *snapshotv1.CreateProjectSnapshotRequest, _ ...grpc.CallOption) (*snapshotv1.CreateProjectSnapshotResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.IdempotencyKey != "snapshot-upload-0001" || string(req.EncryptedEnvelope) != "encrypted-envelope" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.CreateProjectSnapshotResponse{Snapshot: fakeProjectSnapshot()}, nil
}

func (fakeSnapshot) StartProjectSnapshotUpload(ctx context.Context, req *snapshotv1.StartProjectSnapshotUploadRequest, _ ...grpc.CallOption) (*snapshotv1.StartProjectSnapshotUploadResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.IdempotencyKey != "snapshot-resume-0001" || req.EncryptedBytes != 8<<20+1 {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.StartProjectSnapshotUploadResponse{Upload: fakeProjectSnapshotUpload()}, nil
}

func (fakeSnapshot) UploadProjectSnapshotChunk(ctx context.Context, req *snapshotv1.UploadProjectSnapshotChunkRequest, _ ...grpc.CallOption) (*snapshotv1.UploadProjectSnapshotChunkResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.UploadId != "upload-1" || req.ChunkIndex != 0 || string(req.EncryptedChunk) != "opaque-chunk" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.UploadProjectSnapshotChunkResponse{Upload: fakeProjectSnapshotUpload()}, nil
}

func (fakeSnapshot) CompleteProjectSnapshotUpload(ctx context.Context, req *snapshotv1.CompleteProjectSnapshotUploadRequest, _ ...grpc.CallOption) (*snapshotv1.CompleteProjectSnapshotUploadResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.UploadId != "upload-1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.CompleteProjectSnapshotUploadResponse{Snapshot: fakeProjectSnapshot()}, nil
}

func (fakeSnapshot) ListProjectSnapshots(ctx context.Context, req *snapshotv1.ListProjectSnapshotsRequest, _ ...grpc.CallOption) (*snapshotv1.ListProjectSnapshotsResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.ListProjectSnapshotsResponse{Snapshots: []*snapshotv1.ProjectSnapshot{fakeProjectSnapshot()}}, nil
}

func (fakeSnapshot) GetProjectSnapshot(ctx context.Context, req *snapshotv1.GetProjectSnapshotRequest, _ ...grpc.CallOption) (*snapshotv1.GetProjectSnapshotResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.SnapshotId != "snapshot-1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.GetProjectSnapshotResponse{Snapshot: fakeProjectSnapshot(), EncryptedEnvelope: []byte("encrypted-envelope")}, nil
}

func (fakeSnapshot) DeleteProjectSnapshot(ctx context.Context, req *snapshotv1.DeleteProjectSnapshotRequest, _ ...grpc.CallOption) (*snapshotv1.DeleteProjectSnapshotResponse, error) {
	if platform.UserIdentity(ctx) != "u1" || req.UserId != "u1" || req.SnapshotId != "snapshot-1" {
		return nil, status.Error(codes.PermissionDenied, "identity mismatch")
	}
	return &snapshotv1.DeleteProjectSnapshotResponse{SnapshotId: req.SnapshotId, DeletedAt: "2026-07-20T00:00:00Z"}, nil
}

func fakeProjectSnapshotUpload() *snapshotv1.ProjectSnapshotUpload {
	return &snapshotv1.ProjectSnapshotUpload{Id: "upload-1", EncryptedBytes: 8<<20 + 1, EncryptedSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ReceivedChunkIndexes: []int32{0}, CreatedAt: "2026-07-20T00:00:00Z", ExpiresAt: "2026-07-21T00:00:00Z"}
}

func fakeProjectSnapshot() *snapshotv1.ProjectSnapshot {
	return &snapshotv1.ProjectSnapshot{Id: "snapshot-1", EncryptedBytes: 18, EncryptedSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", CreatedAt: "2026-07-20T00:00:00Z", ExpiresAt: "2026-08-19T00:00:00Z"}
}
