package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestBFFHTTPFlow(t *testing.T) {
	router := newTestHTTPService().Router()
	session := loginForSession(t, router)
	token := session.accessToken

	getJSON(t, router, http.MethodGet, "/v1/plans", "", http.StatusOK, func(got map[string]any) {
		if len(got["plans"].([]any)) != 2 {
			t.Fatalf("plans = %+v", got)
		}
	})
	getJSON(t, router, http.MethodGet, "/v1/me/dashboard", token, http.StatusOK, func(got map[string]any) {
		if got["email"] != "creator@example.com" || got["plan"] != "pro" {
			t.Fatalf("dashboard = %+v", got)
		}
	})
	getJSON(t, router, http.MethodGet, "/v1/me/profile", token, http.StatusOK, func(got map[string]any) {
		if got["display_name"] != "Development Creator" {
			t.Fatalf("profile = %+v", got)
		}
	})
	patchJSON(t, router, "/v1/me/profile", token, `{"display_name":"Updated Creator","locale":"zh-CN","timezone":"Asia/Shanghai"}`, http.StatusOK)
	postJSON(t, router, "/v1/billing/checkout", token, `{"plan_id":"pro","channel":"alipay"}`, http.StatusOK)
	postJSON(t, router, "/v1/billing/sandbox/confirm-payment", token, `{"checkout_id":"order"}`, http.StatusOK)
	postJSON(t, router, "/v1/ai/chat", token, `{"request_id":"req_1","messages":[{"role":"user","content":"hi"}],"max_tokens":16}`, http.StatusOK)
	getJSON(t, router, http.MethodGet, "/v1/me/notifications", token, http.StatusOK, func(got map[string]any) {
		if _, ok := got["notifications"].([]any); !ok {
			t.Fatalf("notifications = %+v", got)
		}
	})
	postJSON(t, router, "/v1/me/notifications/n1/read", token, `{}`, http.StatusOK)
	getJSON(t, router, http.MethodGet, "/v1/me/account-report", token, http.StatusOK, func(got map[string]any) {
		if got["order_summary"] == nil || got["usage_summary"] == nil {
			t.Fatalf("account report = %+v", got)
		}
	})
	postJSON(t, router, "/v1/auth/logout", token, `{}`, http.StatusOK)
	refresh := httptest.NewRequest(http.MethodPost, "/v1/auth/refresh", nil)
	refresh.AddCookie(session.refreshCookie)
	refresh.AddCookie(session.csrfCookie)
	refresh.Header.Set(csrfHeader, session.csrfCookie.Value)
	refreshRecorder := httptest.NewRecorder()
	router.ServeHTTP(refreshRecorder, refresh)
	if refreshRecorder.Code != http.StatusOK {
		t.Fatalf("refresh status = %d: %s", refreshRecorder.Code, refreshRecorder.Body.String())
	}
}

func TestCheckoutForwardsExplicitProviderAndExpiresAt(t *testing.T) {
	billing := &captureCheckoutBilling{}
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: billing, Quota: fakeQuota{}, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()
	session := loginForSession(t, router)
	req := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":"pro","channel":"wechat_pay"}`))
	req.Header.Set("Authorization", "Bearer "+session.accessToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("checkout status = %d: %s", rec.Code, rec.Body.String())
	}
	if billing.request == nil || billing.request.GetProvider() != "wechat_pay" || billing.request.GetPlanId() != "pro" {
		t.Fatalf("billing checkout request = %#v", billing.request)
	}
	var response map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response["checkout_url"] != "weixin://pay.example/order" || response["expires_at"] != "2026-07-20T12:30:00Z" {
		t.Fatalf("checkout response = %#v", response)
	}
}

func TestOrderResponseExposesExpiryWithoutInventingStatus(t *testing.T) {
	response := orderResponse(&billingv1.Order{Id: "order", Provider: "alipay", Status: "expired", ExpiresAt: "2026-07-20T12:30:00Z"})
	if response["status"] != "expired" || response["expires_at"] != "2026-07-20T12:30:00Z" {
		t.Fatalf("order response = %#v", response)
	}
}

func TestChatUsesIdempotencyHeader(t *testing.T) {
	ai := &captureAI{}
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: ai, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()
	req := httptest.NewRequest(http.MethodPost, "/v1/ai/chat", bytes.NewBufferString(`{"request_id":"trace-42","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer token")
	req.Header.Set("Idempotency-Key", "header-key-42")
	req.Header.Set("X-Forwarded-For", "198.51.100.10, 203.0.113.42")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("chat status = %d: %s", rec.Code, rec.Body.String())
	}
	if ai.request == nil || ai.request.RequestId != "trace-42" || ai.request.IdempotencyKey != "header-key-42" || ai.request.ClientIp != "203.0.113.42" {
		t.Fatalf("forwarded chat request = %#v", ai.request)
	}
	if got := rec.Header().Get("Idempotency-Key"); got != "header-key-42" {
		t.Fatalf("response Idempotency-Key = %q", got)
	}
}

func TestUsageQueryParametersReachBFFDependenciesAndRemainBounded(t *testing.T) {
	quota := &captureUsageQuota{}
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: quota, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()

	usage := httptest.NewRequest(http.MethodGet, "/v1/me/token-usage?limit=23", nil)
	usage.Header.Set("Authorization", "Bearer token")
	usage.Header.Set(platform.ContractVersionHeader, platform.PublicContractVersion)
	usageRecorder := httptest.NewRecorder()
	router.ServeHTTP(usageRecorder, usage)
	if usageRecorder.Code != http.StatusOK || quota.tokenUsageLimit != 23 || usageRecorder.Header().Get(platform.ContractVersionHeader) != platform.PublicContractVersion {
		t.Fatalf("usage parameter forwarding = status=%d limit=%d headers=%v", usageRecorder.Code, quota.tokenUsageLimit, usageRecorder.Header())
	}

	trend := httptest.NewRequest(http.MethodGet, "/v1/me/usage-trend?days=31", nil)
	trend.Header.Set("Authorization", "Bearer token")
	trendRecorder := httptest.NewRecorder()
	router.ServeHTTP(trendRecorder, trend)
	if trendRecorder.Code != http.StatusOK || quota.usageTrendDays != 31 {
		t.Fatalf("trend parameter forwarding = status=%d days=%d", trendRecorder.Code, quota.usageTrendDays)
	}

	invalid := httptest.NewRequest(http.MethodGet, "/v1/me/token-usage?limit=101", nil)
	invalid.Header.Set("Authorization", "Bearer token")
	invalidRecorder := httptest.NewRecorder()
	router.ServeHTTP(invalidRecorder, invalid)
	if invalidRecorder.Code != http.StatusBadRequest || !bytes.Contains(invalidRecorder.Body.Bytes(), []byte(`"trace_id"`)) {
		t.Fatalf("invalid usage limit = %d: %s", invalidRecorder.Code, invalidRecorder.Body.String())
	}

	bootstrap := httptest.NewRequest(http.MethodGet, "/v1/me/account-bootstrap?usage_limit=29&trend_days=30", nil)
	bootstrap.Header.Set("Authorization", "Bearer token")
	bootstrapRecorder := httptest.NewRecorder()
	router.ServeHTTP(bootstrapRecorder, bootstrap)
	if bootstrapRecorder.Code != http.StatusOK || quota.tokenUsageLimit != 29 || quota.usageTrendDays != 30 {
		t.Fatalf("bootstrap parameter forwarding = status=%d limit=%d days=%d: %s", bootstrapRecorder.Code, quota.tokenUsageLimit, quota.usageTrendDays, bootstrapRecorder.Body.String())
	}
	var bootstrapBody map[string]any
	if err := json.NewDecoder(bootstrapRecorder.Body).Decode(&bootstrapBody); err != nil {
		t.Fatal(err)
	}
	if bootstrapBody["usage_limit"] != float64(29) || bootstrapBody["trend_days"] != float64(30) {
		t.Fatalf("bootstrap response windows = %#v", bootstrapBody)
	}
}

func TestAccountBootstrapKeepsPartialFailureExplicit(t *testing.T) {
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: unavailableBalanceQuota{}, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()
	req := httptest.NewRequest(http.MethodGet, "/v1/me/account-bootstrap", nil)
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("bootstrap status = %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Sections map[string]struct {
			Status      string `json:"status"`
			LastUpdated string `json:"last_updated"`
			TraceID     string `json:"trace_id"`
			ErrorCode   string `json:"error_code"`
			Data        any    `json:"data"`
		} `json:"sections"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	balance := got.Sections["token_balance"]
	if balance.Status != "unavailable" || balance.ErrorCode != "upstream_unavailable" || balance.TraceID == "" || balance.LastUpdated == "" || balance.Data != nil {
		t.Fatalf("token balance section = %#v", balance)
	}
	if orders := got.Sections["orders"]; orders.Status != "ready" || orders.Data == nil {
		t.Fatalf("available orders were blocked by quota failure: %#v", orders)
	}
	legacy := httptest.NewRequest(http.MethodGet, "/v1/me/account-report", nil)
	legacy.Header.Set("Authorization", "Bearer token")
	legacyRecorder := httptest.NewRecorder()
	router.ServeHTTP(legacyRecorder, legacy)
	if legacyRecorder.Code != http.StatusServiceUnavailable || !bytes.Contains(legacyRecorder.Body.Bytes(), []byte(`trace_id`)) {
		t.Fatalf("legacy aggregate must not fabricate a zero report = %d: %s", legacyRecorder.Code, legacyRecorder.Body.String())
	}
}

func TestPaymentConfirmationDefersNotificationToEventConsumer(t *testing.T) {
	notification := &fakeNotification{rows: map[string]*notificationv1.Notification{}}
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Notification: notification,
	})
	if _, err := uc.SimulatedConfirmPayment(context.Background(), "u1", "order"); err != nil {
		t.Fatalf("SimulatedConfirmPayment() error = %v", err)
	}
	if notification.createCalls != 0 {
		t.Fatalf("synchronous notification creates = %d, want 0", notification.createCalls)
	}
}

func TestCookieSessionAndCSRF(t *testing.T) {
	router := newTestHTTPService().Router()
	session := loginForSession(t, router)
	if !session.accessCookie.HttpOnly || !session.refreshCookie.HttpOnly || session.csrfCookie.HttpOnly {
		t.Fatalf("cookie HttpOnly attributes access=%t refresh=%t csrf=%t", session.accessCookie.HttpOnly, session.refreshCookie.HttpOnly, session.csrfCookie.HttpOnly)
	}
	if session.accessCookie.SameSite != http.SameSiteLaxMode || session.refreshCookie.Path != "/v1/auth" || session.accessCookie.Secure {
		t.Fatalf("cookie policy access=%+v refresh=%+v", session.accessCookie, session.refreshCookie)
	}
	legacyRefresh := httptest.NewRequest(http.MethodPost, "/v1/auth/refresh", bytes.NewBufferString(`{"refresh_token":"legacy-browser-token"}`))
	legacyRecorder := httptest.NewRecorder()
	router.ServeHTTP(legacyRecorder, legacyRefresh)
	if legacyRecorder.Code != http.StatusUnauthorized || !strings.Contains(legacyRecorder.Body.String(), "missing_refresh_cookie") {
		t.Fatalf("legacy refresh body status = %d: %s", legacyRecorder.Code, legacyRecorder.Body.String())
	}

	profile := httptest.NewRequest(http.MethodGet, "/v1/me/profile", nil)
	profile.AddCookie(session.accessCookie)
	profileRecorder := httptest.NewRecorder()
	router.ServeHTTP(profileRecorder, profile)
	if profileRecorder.Code != http.StatusOK {
		t.Fatalf("cookie profile status = %d: %s", profileRecorder.Code, profileRecorder.Body.String())
	}

	blocked := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":"pro"}`))
	blocked.AddCookie(session.accessCookie)
	blockedRecorder := httptest.NewRecorder()
	router.ServeHTTP(blockedRecorder, blocked)
	if blockedRecorder.Code != http.StatusForbidden || !strings.Contains(blockedRecorder.Body.String(), "csrf_rejected") {
		t.Fatalf("missing CSRF status = %d: %s", blockedRecorder.Code, blockedRecorder.Body.String())
	}

	allowed := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":"pro"}`))
	allowed.AddCookie(session.accessCookie)
	allowed.AddCookie(session.csrfCookie)
	allowed.Header.Set(csrfHeader, session.csrfCookie.Value)
	allowedRecorder := httptest.NewRecorder()
	router.ServeHTTP(allowedRecorder, allowed)
	if allowedRecorder.Code != http.StatusOK {
		t.Fatalf("CSRF checkout status = %d: %s", allowedRecorder.Code, allowedRecorder.Body.String())
	}

	logout := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	logout.AddCookie(session.accessCookie)
	logout.AddCookie(session.refreshCookie)
	logout.AddCookie(session.csrfCookie)
	logout.Header.Set(csrfHeader, session.csrfCookie.Value)
	logoutRecorder := httptest.NewRecorder()
	router.ServeHTTP(logoutRecorder, logout)
	if logoutRecorder.Code != http.StatusOK {
		t.Fatalf("cookie logout status = %d: %s", logoutRecorder.Code, logoutRecorder.Body.String())
	}
	for _, cookie := range logoutRecorder.Result().Cookies() {
		if cookie.Name == webAccessCookie || cookie.Name == webRefreshCookie || cookie.Name == webCSRFCookie {
			if cookie.MaxAge >= 0 {
				t.Fatalf("logout did not clear %s: %+v", cookie.Name, cookie)
			}
		}
	}
}

func TestLogoutClearsCookiesWhenDownstreamRejectsSession(t *testing.T) {
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: logoutErrorAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()
	session := loginForSession(t, router)

	logout := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	logout.AddCookie(session.accessCookie)
	logout.AddCookie(session.refreshCookie)
	logout.AddCookie(session.csrfCookie)
	logout.Header.Set(csrfHeader, session.csrfCookie.Value)
	logoutRecorder := httptest.NewRecorder()
	router.ServeHTTP(logoutRecorder, logout)
	if logoutRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("logout status = %d: %s", logoutRecorder.Code, logoutRecorder.Body.String())
	}

	cleared := map[string]bool{}
	for _, cookie := range logoutRecorder.Result().Cookies() {
		if cookie.Name == webAccessCookie || cookie.Name == webRefreshCookie || cookie.Name == webCSRFCookie {
			if cookie.MaxAge >= 0 {
				t.Fatalf("logout did not clear %s: %+v", cookie.Name, cookie)
			}
			cleared[cookie.Name] = true
		}
	}
	for _, name := range []string{webAccessCookie, webRefreshCookie, webCSRFCookie} {
		if !cleared[name] {
			t.Fatalf("logout response did not expire %s", name)
		}
	}
}

func TestProductionCookieSessionIsSecure(t *testing.T) {
	service := newTestHTTPServiceWithConfig(&conf.Bootstrap{Environment: "prod", Session: conf.SessionConfig{RefreshCookieTTL: "720h"}})
	session := loginForSession(t, service.Router())
	if !session.accessCookie.Secure || !session.refreshCookie.Secure || !session.csrfCookie.Secure {
		t.Fatalf("production cookies must be Secure: access=%t refresh=%t csrf=%t", session.accessCookie.Secure, session.refreshCookie.Secure, session.csrfCookie.Secure)
	}
}

func TestCookieSessionUsesConfiguredControlledDomain(t *testing.T) {
	service := newTestHTTPServiceWithConfig(&conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h", CookieDomain: "example.test"}})
	session := loginForSession(t, service.Router())
	for _, cookie := range []*http.Cookie{session.accessCookie, session.refreshCookie, session.csrfCookie} {
		if cookie.Domain != "example.test" {
			t.Fatalf("cookie domain = %q, want controlled domain", cookie.Domain)
		}
	}
}

func TestProtectedRoutesRequireToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/me/dashboard", nil)
	rec := httptest.NewRecorder()
	newTestHTTPService().Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("X-Trace-Id") == "" {
		t.Fatalf("missing X-Trace-Id")
	}
	var got struct {
		Error struct {
			TraceID string `json:"trace_id"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil || got.Error.TraceID == "" {
		t.Fatalf("error trace id = %+v err=%v body=%s", got, err, rec.Body.String())
	}
}

func TestDesktopAuthorizationCallbackContainsOnlyOneTimeCodeAndState(t *testing.T) {
	router := newTestHTTPService().Router()
	session := loginForSession(t, router)
	request := httptest.NewRequest(http.MethodGet, "/v1/auth/desktop/authorize?code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&state=desktop-state-0123456789&device_id=desktop-12345678", nil)
	request.AddCookie(session.accessCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusFound {
		t.Fatalf("desktop authorization status = %d: %s", recorder.Code, recorder.Body.String())
	}
	callback, err := url.Parse(recorder.Header().Get("Location"))
	if err != nil || callback.Scheme != "http" || callback.Hostname() != "127.0.0.1" || callback.Path != "/callback" {
		t.Fatalf("callback = %q err=%v", recorder.Header().Get("Location"), err)
	}
	query := callback.Query()
	if query.Get("code") == "" || query.Get("state") != "desktop-state-0123456789" || query.Get("access_token") != "" || query.Get("refresh_token") != "" {
		t.Fatalf("unsafe callback query = %s", callback.RawQuery)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("callback missing no-store policy")
	}
}

func TestDesktopAuthorizationRejectsUntrustedCallback(t *testing.T) {
	router := newTestHTTPService().Router()
	request := httptest.NewRequest(http.MethodGet, "/v1/auth/desktop/authorize?code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback&state=desktop-state-0123456789&device_id=desktop-12345678", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_desktop_authorization_request") {
		t.Fatalf("untrusted callback response = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestEmailVerificationAndPasswordRecoveryRoutes(t *testing.T) {
	router := newTestHTTPService().Router()

	requestVerification := httptest.NewRequest(http.MethodPost, "/v1/auth/email-verification/request", nil)
	requestVerification.Header.Set("Authorization", "Bearer token")
	verificationRecorder := httptest.NewRecorder()
	router.ServeHTTP(verificationRecorder, requestVerification)
	if verificationRecorder.Code != http.StatusAccepted || strings.Contains(verificationRecorder.Body.String(), "code") {
		t.Fatalf("verification request = %d %s", verificationRecorder.Code, verificationRecorder.Body.String())
	}

	confirmVerification := httptest.NewRequest(http.MethodPost, "/v1/auth/email-verification/confirm", bytes.NewBufferString(`{"code":"ABCDEFG2"}`))
	confirmVerification.Header.Set("Authorization", "Bearer token")
	confirmRecorder := httptest.NewRecorder()
	router.ServeHTTP(confirmRecorder, confirmVerification)
	if confirmRecorder.Code != http.StatusOK || strings.Contains(confirmRecorder.Body.String(), "ABCDEFG2") {
		t.Fatalf("verification confirmation = %d %s", confirmRecorder.Code, confirmRecorder.Body.String())
	}

	requestReset := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset/request", bytes.NewBufferString(`{"email":"creator@example.com"}`))
	resetRequestRecorder := httptest.NewRecorder()
	router.ServeHTTP(resetRequestRecorder, requestReset)
	if resetRequestRecorder.Code != http.StatusAccepted || strings.Contains(resetRequestRecorder.Body.String(), "creator@example.com") {
		t.Fatalf("password reset request = %d %s", resetRequestRecorder.Code, resetRequestRecorder.Body.String())
	}

	confirmReset := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset/confirm", bytes.NewBufferString(`{"email":"creator@example.com","code":"ABCDEFG2","password":"password456"}`))
	resetConfirmRecorder := httptest.NewRecorder()
	router.ServeHTTP(resetConfirmRecorder, confirmReset)
	if resetConfirmRecorder.Code != http.StatusOK || strings.Contains(resetConfirmRecorder.Body.String(), "password456") {
		t.Fatalf("password reset confirmation = %d %s", resetConfirmRecorder.Code, resetConfirmRecorder.Body.String())
	}
}

func TestCheckoutRequiresVerifiedEmail(t *testing.T) {
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: unverifiedAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{}},
	})
	router := NewHTTPService(uc, &conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}}).Router()
	req := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":"pro"}`))
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "email_verification_required") {
		t.Fatalf("unverified checkout = %d %s", rec.Code, rec.Body.String())
	}
}

func TestMetricsEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/metrics", nil)
	rec := httptest.NewRecorder()
	newTestHTTPService().Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "dramaip_bff_http_requests_total") {
		t.Fatalf("metrics response = %d %s", rec.Code, rec.Body.String())
	}
}

func TestTransientGRPCErrorsSetRetryAfter(t *testing.T) {
	for name, test := range map[string]struct {
		err        error
		statusCode int
		retryAfter string
	}{
		"unavailable": {err: status.Error(codes.Unavailable, "downstream unavailable"), statusCode: http.StatusServiceUnavailable, retryAfter: "2"},
		"deadline":    {err: status.Error(codes.DeadlineExceeded, "downstream timed out"), statusCode: http.StatusGatewayTimeout, retryAfter: "1"},
	} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeGRPCError(response, test.err, "fallback")
			if response.Code != test.statusCode {
				t.Fatalf("status = %d, want %d", response.Code, test.statusCode)
			}
			if got := response.Header().Get("Retry-After"); got != test.retryAfter {
				t.Fatalf("Retry-After = %q, want %q", got, test.retryAfter)
			}
		})
	}
}

func TestPlansUseReadOnlyCacheWhenBillingIsTemporarilyUnavailable(t *testing.T) {
	billing := &flakyBilling{}
	uc := biz.NewBFFUsecase(&data.Data{Billing: billing})
	first, err := uc.Plans(context.Background())
	if err != nil || len(first.Plans) == 0 {
		t.Fatalf("initial plans = %+v, %v", first, err)
	}
	second, err := uc.Plans(context.Background())
	if err != nil || len(second.Plans) != len(first.Plans) {
		t.Fatalf("cached plans = %+v, %v", second, err)
	}
	if billing.calls != 2 {
		t.Fatalf("billing calls = %d, want 2", billing.calls)
	}
}

func TestUnversionedBusinessRoutesAreNotExposed(t *testing.T) {
	router := newTestHTTPService().Router()
	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/plans"},
		{method: http.MethodGet, path: "/me/dashboard"},
		{method: http.MethodPost, path: "/auth/login"},
		{method: http.MethodPost, path: "/billing/checkout"},
		{method: http.MethodPost, path: "/ai/chat"},
		{method: http.MethodGet, path: "/metrics"},
	} {
		req := httptest.NewRequest(route.method, route.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %s status = %d, want 404", route.method, route.path, rec.Code)
		}
	}
}

func newTestHTTPService() *HTTPService {
	return newTestHTTPServiceWithConfig(&conf.Bootstrap{Session: conf.SessionConfig{RefreshCookieTTL: "720h"}})
}

func newTestHTTPServiceWithConfig(cfg *conf.Bootstrap) *HTTPService {
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{}, Notification: &fakeNotification{rows: map[string]*notificationv1.Notification{
			"n1": {Id: "n1", Type: "test", Title: "Existing notification", Body: "Read-path fixture", SourceEventId: "fixture", CreatedAt: "2026-07-13T00:00:00Z"},
		}},
	})
	return NewHTTPService(uc, cfg)
}

type testSession struct {
	accessToken   string
	accessCookie  *http.Cookie
	refreshCookie *http.Cookie
	csrfCookie    *http.Cookie
}

func loginForSession(t *testing.T, router http.Handler) testSession {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewBufferString(`{"email":"creator@example.com","password":"password123"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "access_token") || strings.Contains(rec.Body.String(), "refresh_token") {
		t.Fatalf("login leaked token response: %s", rec.Body.String())
	}
	cookies := map[string]*http.Cookie{}
	for _, cookie := range rec.Result().Cookies() {
		cookies[cookie.Name] = cookie
	}
	access := cookies[webAccessCookie]
	refresh := cookies[webRefreshCookie]
	csrf := cookies[webCSRFCookie]
	if access == nil || refresh == nil || csrf == nil || access.Value == "" || refresh.Value == "" || csrf.Value == "" {
		t.Fatalf("login cookies = %+v", cookies)
	}
	return testSession{accessToken: access.Value, accessCookie: access, refreshCookie: refresh, csrfCookie: csrf}
}

func getJSON(t *testing.T, router http.Handler, method, path, token string, want int, assert func(map[string]any)) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s status = %d: %s", path, rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	assert(got)
}

func postJSON(t *testing.T, router http.Handler, path, token, body string, want int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s status = %d: %s", path, rec.Code, rec.Body.String())
	}
}

func patchJSON(t *testing.T, router http.Handler, path, token, body string, want int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s status = %d: %s", path, rec.Code, rec.Body.String())
	}
}

type fakeAuth struct{}

type unverifiedAuth struct{ fakeAuth }

type logoutErrorAuth struct{ fakeAuth }

func (logoutErrorAuth) Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error) {
	return nil, status.Error(codes.Unauthenticated, "invalid token")
}

func (fakeAuth) Register(context.Context, *authv1.RegisterRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return nil, status.Error(codes.Unimplemented, "register")
}
func (fakeAuth) Login(context.Context, *authv1.LoginRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return &authv1.AuthReply{AccessToken: "token", RefreshToken: "refresh", TokenType: "Bearer", ExpiresIn: 900, UserId: "u1", Email: "creator@example.com", Name: "Development Creator", EmailVerified: true}, nil
}
func (fakeAuth) Refresh(context.Context, *authv1.RefreshRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return &authv1.AuthReply{AccessToken: "token2", RefreshToken: "refresh2", TokenType: "Bearer", ExpiresIn: 900, UserId: "u1", Email: "creator@example.com", Name: "Development Creator", EmailVerified: true}, nil
}
func (fakeAuth) Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error) {
	return &authv1.LogoutReply{Ok: true}, nil
}
func (fakeAuth) ValidateAccessToken(_ context.Context, req *authv1.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AccessToken != "token" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &authv1.AuthReply{UserId: "u1", Email: "creator@example.com", EmailVerified: true}, nil
}
func (unverifiedAuth) ValidateAccessToken(_ context.Context, req *authv1.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AccessToken != "token" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &authv1.AuthReply{UserId: "u1", Email: "creator@example.com", EmailVerified: false}, nil
}
func (fakeAuth) RequestEmailVerification(context.Context, *authv1.RequestEmailVerificationRequest, ...grpc.CallOption) (*authv1.EmailActionReply, error) {
	return &authv1.EmailActionReply{Accepted: true}, nil
}
func (fakeAuth) VerifyEmail(context.Context, *authv1.VerifyEmailRequest, ...grpc.CallOption) (*authv1.EmailActionReply, error) {
	return &authv1.EmailActionReply{Accepted: true}, nil
}
func (fakeAuth) RequestPasswordReset(context.Context, *authv1.RequestPasswordResetRequest, ...grpc.CallOption) (*authv1.EmailActionReply, error) {
	return &authv1.EmailActionReply{Accepted: true}, nil
}
func (fakeAuth) ResetPassword(context.Context, *authv1.ResetPasswordRequest, ...grpc.CallOption) (*authv1.EmailActionReply, error) {
	return &authv1.EmailActionReply{Accepted: true}, nil
}
func (fakeAuth) CreateDesktopAuthorizationCode(_ context.Context, req *authv1.CreateDesktopAuthorizationCodeRequest, _ ...grpc.CallOption) (*authv1.CreateDesktopAuthorizationCodeReply, error) {
	if req.UserId != "u1" || req.RedirectUri == "" || req.CodeChallenge == "" || req.DeviceId == "" {
		return nil, status.Error(codes.InvalidArgument, "invalid desktop authorization request")
	}
	return &authv1.CreateDesktopAuthorizationCodeReply{AuthorizationCode: "desktop-authorization-code", ExpiresIn: 60}, nil
}
func (fakeAuth) ExchangeDesktopAuthorizationCode(context.Context, *authv1.ExchangeDesktopAuthorizationCodeRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return nil, status.Error(codes.Unimplemented, "desktop exchange")
}

type fakeUser struct{}

func (fakeUser) GetProfile(context.Context, *userv1.GetProfileRequest, ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{Id: "u1", Email: "creator@example.com", DisplayName: "Development Creator", Status: "active"}, nil
}
func (fakeUser) EnsureProfile(context.Context, *userv1.EnsureProfileRequest, ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{Id: "u1", Email: "creator@example.com", DisplayName: "Development Creator", Status: "active"}, nil
}
func (fakeUser) UpdateProfile(_ context.Context, req *userv1.UpdateProfileRequest, _ ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{Id: "u1", Email: "creator@example.com", DisplayName: req.DisplayName, Locale: req.Locale, Timezone: req.Timezone, Status: "active"}, nil
}

type fakeBilling struct{}

type captureCheckoutBilling struct {
	fakeBilling
	request *billingv1.CreateCheckoutRequest
}

func (b *captureCheckoutBilling) CreateCheckout(_ context.Context, req *billingv1.CreateCheckoutRequest, _ ...grpc.CallOption) (*billingv1.CreateCheckoutReply, error) {
	b.request = req
	return &billingv1.CreateCheckoutReply{OrderId: "order", PlanId: req.PlanId, Provider: req.Provider, Status: "pending", PaymentUrl: "weixin://pay.example/order", ExpiresAt: "2026-07-20T12:30:00Z"}, nil
}

type flakyBilling struct {
	fakeBilling
	calls int
}

func (b *flakyBilling) ListPlans(ctx context.Context, req *billingv1.ListPlansRequest, options ...grpc.CallOption) (*billingv1.ListPlansReply, error) {
	b.calls++
	if b.calls > 1 {
		return nil, status.Error(codes.Unavailable, "billing unavailable")
	}
	return b.fakeBilling.ListPlans(ctx, req, options...)
}

func (fakeBilling) ListPlans(context.Context, *billingv1.ListPlansRequest, ...grpc.CallOption) (*billingv1.ListPlansReply, error) {
	return &billingv1.ListPlansReply{Plans: []*billingv1.Plan{{Code: "free", Name: "Free", MonthlyTokenQuota: 10000}, {Code: "pro", Name: "Pro", PriceCny: 99, MonthlyTokenQuota: 2000000, ModelLevel: "standard", MaxRpm: 60}}}, nil
}
func (fakeBilling) CreateCheckout(context.Context, *billingv1.CreateCheckoutRequest, ...grpc.CallOption) (*billingv1.CreateCheckoutReply, error) {
	return &billingv1.CreateCheckoutReply{OrderId: "order", PlanId: "pro", Provider: "alipay", Status: "pending", PaymentUrl: "https://pay.example.com/orders/order"}, nil
}
func (fakeBilling) ConfirmSandboxPayment(context.Context, *billingv1.ConfirmSandboxPaymentRequest, ...grpc.CallOption) (*billingv1.ConfirmSandboxPaymentReply, error) {
	return &billingv1.ConfirmSandboxPaymentReply{
		OrderId: "order", Status: "paid",
		Subscription: &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: "pro", Status: "active"},
		TokenBalance: &billingv1.TokenBalance{Plan: "pro", QuotaTokens: 2000000, RemainingTokens: 2000000},
	}, nil
}
func (fakeBilling) ConfirmSimulatedPayment(context.Context, *billingv1.ConfirmSimulatedPaymentRequest, ...grpc.CallOption) (*billingv1.ConfirmSimulatedPaymentReply, error) {
	return &billingv1.ConfirmSimulatedPaymentReply{
		OrderId: "order", Status: "paid",
		Subscription: &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: "pro", Status: "active"},
		TokenBalance: &billingv1.TokenBalance{Plan: "pro", QuotaTokens: 2000000, RemainingTokens: 2000000},
	}, nil
}
func (fakeBilling) GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: "pro", Status: "active"}, nil
}
func (fakeBilling) ListOrders(context.Context, *billingv1.ListOrdersRequest, ...grpc.CallOption) (*billingv1.ListOrdersReply, error) {
	return &billingv1.ListOrdersReply{Orders: []*billingv1.Order{{Id: "order", PlanCode: "pro", Status: "paid"}}}, nil
}
func (fakeBilling) GetOrder(context.Context, *billingv1.GetOrderRequest, ...grpc.CallOption) (*billingv1.Order, error) {
	return &billingv1.Order{Id: "order", PlanCode: "pro", Status: "paid"}, nil
}
func (fakeBilling) CancelSubscription(context.Context, *billingv1.CancelSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: "pro", Status: "active", CancelAtPeriodEnd: true}, nil
}
func (fakeBilling) ResumeSubscription(context.Context, *billingv1.ResumeSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: "pro", Status: "active"}, nil
}
func (fakeBilling) ChangeSubscriptionPlan(_ context.Context, req *billingv1.ChangeSubscriptionPlanRequest, _ ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{Id: "sub", UserId: "u1", PlanCode: req.PlanId, Status: "active"}, nil
}
func (fakeBilling) RequestRefund(context.Context, *billingv1.RequestRefundRequest, ...grpc.CallOption) (*billingv1.Refund, error) {
	return &billingv1.Refund{Id: "refund", SubscriptionId: "sub", Status: "manual_review"}, nil
}

type fakeQuota struct{}

type unavailableBalanceQuota struct{ fakeQuota }

func (unavailableBalanceQuota) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return nil, status.Error(codes.Unavailable, "quota temporarily unavailable")
}

func (fakeQuota) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{Plan: "pro", QuotaTokens: 2000000, UsedTokens: 380000, RemainingTokens: 1620000}, nil
}
func (fakeQuota) CreatePeriodAccount(context.Context, *quotav1.CreatePeriodAccountRequest, ...grpc.CallOption) (*quotav1.TokenAccount, error) {
	return nil, status.Error(codes.Unimplemented, "period")
}
func (fakeQuota) GetPeriodAccount(context.Context, *quotav1.GetPeriodAccountRequest, ...grpc.CallOption) (*quotav1.PeriodAccountReply, error) {
	return nil, status.Error(codes.Unimplemented, "period lookup")
}
func (fakeQuota) ReserveTokens(context.Context, *quotav1.ReserveTokensRequest, ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	return nil, nil
}
func (fakeQuota) SettleTokens(context.Context, *quotav1.SettleTokensRequest, ...grpc.CallOption) (*quotav1.TokenUsage, error) {
	return nil, nil
}
func (fakeQuota) CancelReservation(context.Context, *quotav1.CancelReservationRequest, ...grpc.CallOption) (*quotav1.TokenReservation, error) {
	return nil, nil
}
func (fakeQuota) AdjustPeriodQuota(context.Context, *quotav1.AdjustPeriodQuotaRequest, ...grpc.CallOption) (*quotav1.QuotaAdjustment, error) {
	return &quotav1.QuotaAdjustment{Status: "applied"}, nil
}
func (fakeQuota) PrepareRefund(context.Context, *quotav1.PrepareRefundRequest, ...grpc.CallOption) (*quotav1.RefundPreparation, error) {
	return &quotav1.RefundPreparation{Status: "manual_review"}, nil
}
func (fakeQuota) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{Usage: []*quotav1.TokenUsage{{Id: "usage", RequestId: "req", TotalTokens: 2, Status: "settled"}}}, nil
}
func (fakeQuota) GetUsageTrend(context.Context, *quotav1.GetUsageTrendRequest, ...grpc.CallOption) (*quotav1.GetUsageTrendReply, error) {
	return &quotav1.GetUsageTrendReply{Points: []*quotav1.UsageTrendPoint{{Date: "2026-07-07", TotalTokens: 2}}}, nil
}

type captureUsageQuota struct {
	fakeQuota
	tokenUsageLimit int32
	usageTrendDays  int32
}

func (f *captureUsageQuota) ListTokenUsage(ctx context.Context, req *quotav1.ListTokenUsageRequest, options ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	f.tokenUsageLimit = req.GetLimit()
	return f.fakeQuota.ListTokenUsage(ctx, req, options...)
}

func (f *captureUsageQuota) GetUsageTrend(ctx context.Context, req *quotav1.GetUsageTrendRequest, options ...grpc.CallOption) (*quotav1.GetUsageTrendReply, error) {
	f.usageTrendDays = req.GetDays()
	return f.fakeQuota.GetUsageTrend(ctx, req, options...)
}

type fakeAI struct{}

func (fakeAI) Chat(context.Context, *aiv1.ChatRequest, ...grpc.CallOption) (*aiv1.ChatReply, error) {
	return &aiv1.ChatReply{Content: "hello", Provider: "test", Model: "test", TotalTokens: 2, RemainingTokens: 100}, nil
}

type captureAI struct {
	request *aiv1.ChatRequest
}

func (f *captureAI) Chat(_ context.Context, req *aiv1.ChatRequest, _ ...grpc.CallOption) (*aiv1.ChatReply, error) {
	f.request = req
	return &aiv1.ChatReply{Content: "hello", Provider: "test", Model: "test", TotalTokens: 2, RemainingTokens: 100, RequestId: req.RequestId, Status: "succeeded"}, nil
}

type fakeNotification struct {
	rows        map[string]*notificationv1.Notification
	createCalls int
}

func (f *fakeNotification) ListNotifications(ctx context.Context, req *notificationv1.ListNotificationsRequest, _ ...grpc.CallOption) (*notificationv1.ListNotificationsResponse, error) {
	if platform.UserIdentity(ctx) != req.UserId {
		return nil, status.Error(codes.PermissionDenied, "notification identity mismatch")
	}
	rows := make([]*notificationv1.Notification, 0, len(f.rows))
	for _, row := range f.rows {
		rows = append(rows, row)
	}
	return &notificationv1.ListNotificationsResponse{Notifications: rows}, nil
}

func (f *fakeNotification) MarkNotificationRead(ctx context.Context, req *notificationv1.MarkNotificationReadRequest, _ ...grpc.CallOption) (*notificationv1.MarkNotificationReadResponse, error) {
	if platform.UserIdentity(ctx) != req.UserId {
		return nil, status.Error(codes.PermissionDenied, "notification identity mismatch")
	}
	row, ok := f.rows[req.NotificationId]
	if !ok {
		return nil, status.Error(codes.NotFound, "notification not found")
	}
	row.ReadAt = "2026-07-13T00:00:00Z"
	return &notificationv1.MarkNotificationReadResponse{Notification: row}, nil
}

func (f *fakeNotification) CreateNotification(ctx context.Context, req *notificationv1.CreateNotificationRequest, _ ...grpc.CallOption) (*notificationv1.CreateNotificationResponse, error) {
	if platform.UserIdentity(ctx) != req.UserId {
		return nil, status.Error(codes.PermissionDenied, "notification identity mismatch")
	}
	f.createCalls++
	row := &notificationv1.Notification{Id: "n1", Type: req.Type, Title: req.Title, Body: req.Body, SourceEventId: req.SourceEventId, CreatedAt: "2026-07-13T00:00:00Z"}
	f.rows[row.Id] = row
	return &notificationv1.CreateNotificationResponse{Notification: row}, nil
}
