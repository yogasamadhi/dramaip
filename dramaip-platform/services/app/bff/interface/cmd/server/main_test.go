package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestBFFServiceSplitFlow(t *testing.T) {
	app := newTestApp()
	router := app.router()
	token := loginForToken(t, router)

	getJSON(t, router, http.MethodGet, "/plans", "", http.StatusOK, func(got map[string]any) {
		if len(got["plans"].([]any)) != 2 {
			t.Fatalf("plans = %+v", got)
		}
	})
	getJSON(t, router, http.MethodGet, "/me/dashboard", token, http.StatusOK, func(got map[string]any) {
		if got["email"] != "creator@example.com" || got["plan"] != "pro" {
			t.Fatalf("dashboard = %+v", got)
		}
	})
	postJSON(t, router, "/billing/checkout", token, `{"plan_id":"pro","channel":"alipay"}`, http.StatusOK)
	postJSON(t, router, "/ai/chat", token, `{"messages":[{"role":"user","content":"hi"}],"max_tokens":16}`, http.StatusOK)
}

func TestProtectedRoutesRequireToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/me/dashboard", nil)
	rec := httptest.NewRecorder()
	newTestApp().router().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	newTestApp().router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "dramaip_bff_http_requests_total") {
		t.Fatalf("metrics response = %d %s", rec.Code, rec.Body.String())
	}
}

func newTestApp() *app {
	auth := fakeAuth{}
	return newApp(auth, fakeUser{}, fakeBilling{}, fakeQuota{}, fakeAI{})
}

func loginForToken(t *testing.T, router http.Handler) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"creator@example.com","password":"password123"}`))
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

type fakeAuth struct{}

func (fakeAuth) Login(context.Context, *drpc.LoginRequest, ...grpc.CallOption) (*drpc.AuthReply, error) {
	return &drpc.AuthReply{AccessToken: "token", RefreshToken: "refresh", TokenType: "Bearer", ExpiresIn: 900, UserID: "u1", Email: "creator@example.com", Name: "Demo Creator"}, nil
}
func (fakeAuth) Refresh(context.Context, *drpc.RefreshRequest, ...grpc.CallOption) (*drpc.AuthReply, error) {
	return nil, nil
}
func (fakeAuth) Logout(context.Context, *drpc.LogoutRequest, ...grpc.CallOption) (*drpc.LogoutReply, error) {
	return &drpc.LogoutReply{OK: true}, nil
}
func (fakeAuth) ValidateAccessToken(_ context.Context, req *drpc.ValidateAccessTokenRequest, _ ...grpc.CallOption) (*drpc.AuthReply, error) {
	if req.AccessToken != "token" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return &drpc.AuthReply{UserID: "u1", Email: "creator@example.com"}, nil
}

type fakeUser struct{}

func (fakeUser) GetProfile(context.Context, *drpc.GetProfileRequest, ...grpc.CallOption) (*drpc.UserProfile, error) {
	return &drpc.UserProfile{ID: "u1", Email: "creator@example.com", DisplayName: "Demo Creator", Status: "active"}, nil
}

type fakeBilling struct{}

func (fakeBilling) ListPlans(context.Context, *drpc.ListPlansRequest, ...grpc.CallOption) (*drpc.ListPlansReply, error) {
	return &drpc.ListPlansReply{Plans: []drpc.Plan{{Code: "free", Name: "Free", MonthlyTokenQuota: 10000}, {Code: "pro", Name: "Pro", PriceCNY: 99, MonthlyTokenQuota: 2000000, ModelLevel: "standard", MaxRPM: 60}}}, nil
}
func (fakeBilling) CreateCheckout(context.Context, *drpc.CreateCheckoutRequest, ...grpc.CallOption) (*drpc.CreateCheckoutReply, error) {
	return &drpc.CreateCheckoutReply{OrderID: "order", PlanID: "pro", Provider: "alipay", Status: "pending", PaymentURL: "https://pay.example.com/orders/order"}, nil
}
func (fakeBilling) GetSubscription(context.Context, *drpc.GetSubscriptionRequest, ...grpc.CallOption) (*drpc.Subscription, error) {
	return &drpc.Subscription{ID: "sub", UserID: "u1", PlanCode: "pro", Status: "active"}, nil
}

type fakeQuota struct{}

func (fakeQuota) GetTokenBalance(context.Context, *drpc.GetTokenBalanceRequest, ...grpc.CallOption) (*drpc.TokenBalance, error) {
	return &drpc.TokenBalance{Plan: "pro", QuotaTokens: 2000000, UsedTokens: 380000, RemainingTokens: 1620000}, nil
}
func (fakeQuota) ReserveTokens(context.Context, *drpc.ReserveTokensRequest, ...grpc.CallOption) (*drpc.TokenReservation, error) {
	return nil, nil
}
func (fakeQuota) SettleTokens(context.Context, *drpc.SettleTokensRequest, ...grpc.CallOption) (*drpc.TokenUsage, error) {
	return nil, nil
}
func (fakeQuota) CancelReservation(context.Context, *drpc.CancelReservationRequest, ...grpc.CallOption) (*drpc.TokenReservation, error) {
	return nil, nil
}

type fakeAI struct{}

func (fakeAI) Chat(context.Context, *drpc.ChatRequest, ...grpc.CallOption) (*drpc.ChatReply, error) {
	return &drpc.ChatReply{Content: "hello", Provider: "test", Model: "test", TotalTokens: 2, RemainingTokens: 100}, nil
}
