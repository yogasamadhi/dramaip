package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/interface/internal/data"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestBFFHTTPFlow(t *testing.T) {
	router := newTestHTTPService().Router()
	token := loginForToken(t, router)

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
	getJSON(t, router, http.MethodGet, "/v1/me/account-report", token, http.StatusOK, func(got map[string]any) {
		if got["order_summary"] == nil || got["usage_summary"] == nil {
			t.Fatalf("account report = %+v", got)
		}
	})
	postJSON(t, router, "/v1/auth/logout", token, `{"refresh_token":"refresh"}`, http.StatusOK)
	postJSON(t, router, "/v1/auth/refresh", "", `{"refresh_token":"refresh"}`, http.StatusOK)
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

func TestMetricsEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/metrics", nil)
	rec := httptest.NewRecorder()
	newTestHTTPService().Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "dramaip_bff_http_requests_total") {
		t.Fatalf("metrics response = %d %s", rec.Code, rec.Body.String())
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
	uc := biz.NewBFFUsecase(&data.Data{
		Auth: fakeAuth{}, User: fakeUser{}, Billing: fakeBilling{}, Quota: fakeQuota{}, AI: fakeAI{},
	})
	return NewHTTPService(uc)
}

func loginForToken(t *testing.T, router http.Handler) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewBufferString(`{"email":"creator@example.com","password":"password123"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil || got.AccessToken == "" {
		t.Fatalf("login response = %+v err=%v", got, err)
	}
	return got.AccessToken
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

func (fakeAuth) Register(context.Context, *authv1.RegisterRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return nil, status.Error(codes.Unimplemented, "register")
}
func (fakeAuth) Login(context.Context, *authv1.LoginRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return &authv1.AuthReply{AccessToken: "token", RefreshToken: "refresh", TokenType: "Bearer", ExpiresIn: 900, UserId: "u1", Email: "creator@example.com", Name: "Development Creator"}, nil
}
func (fakeAuth) Refresh(context.Context, *authv1.RefreshRequest, ...grpc.CallOption) (*authv1.AuthReply, error) {
	return &authv1.AuthReply{AccessToken: "token2", RefreshToken: "refresh2", TokenType: "Bearer", ExpiresIn: 900, UserId: "u1", Email: "creator@example.com", Name: "Development Creator"}, nil
}
func (fakeAuth) Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error) {
	return &authv1.LogoutReply{Ok: true}, nil
}
func (fakeAuth) ValidateAccessToken(_ context.Context, req *authv1.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*authv1.AuthReply, error) {
	if req.AccessToken != "token" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &authv1.AuthReply{UserId: "u1", Email: "creator@example.com"}, nil
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

type fakeQuota struct{}

func (fakeQuota) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{Plan: "pro", QuotaTokens: 2000000, UsedTokens: 380000, RemainingTokens: 1620000}, nil
}
func (fakeQuota) CreatePeriodAccount(context.Context, *quotav1.CreatePeriodAccountRequest, ...grpc.CallOption) (*quotav1.TokenAccount, error) {
	return nil, status.Error(codes.Unimplemented, "period")
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
func (fakeQuota) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{Usage: []*quotav1.TokenUsage{{Id: "usage", RequestId: "req", TotalTokens: 2, Status: "settled"}}}, nil
}
func (fakeQuota) GetUsageTrend(context.Context, *quotav1.GetUsageTrendRequest, ...grpc.CallOption) (*quotav1.GetUsageTrendReply, error) {
	return &quotav1.GetUsageTrendReply{Points: []*quotav1.UsageTrendPoint{{Date: "2026-07-07", TotalTokens: 2}}}, nil
}

type fakeAI struct{}

func (fakeAI) Chat(context.Context, *aiv1.ChatRequest, ...grpc.CallOption) (*aiv1.ChatReply, error) {
	return &aiv1.ChatReply{Content: "hello", Provider: "test", Model: "test", TotalTokens: 2, RemainingTokens: 100}, nil
}
