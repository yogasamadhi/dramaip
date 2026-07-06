package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type app struct {
	auth    drpc.AuthServiceClient
	user    drpc.UserServiceClient
	billing drpc.BillingServiceClient
	quota   drpc.QuotaServiceClient
	ai      drpc.AiGatewayServiceClient

	requestsTotal  uint64
	loginsTotal    uint64
	checkoutsTotal uint64
	chatsTotal     uint64
}

func newApp(auth drpc.AuthServiceClient, user drpc.UserServiceClient, billing drpc.BillingServiceClient, quota drpc.QuotaServiceClient, ai drpc.AiGatewayServiceClient) *app {
	return &app{auth: auth, user: user, billing: billing, quota: quota, ai: ai}
}

func (a *app) router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", a.handleHealth)
	mux.HandleFunc("/metrics", a.handleMetrics)
	mux.HandleFunc("/auth/login", a.handleLogin)
	mux.HandleFunc("/auth/demo-login", a.handleLogin)
	mux.HandleFunc("/plans", a.handlePlans)
	mux.HandleFunc("/me/dashboard", a.handleDashboard)
	mux.HandleFunc("/me/token-balance", a.handleTokenBalance)
	mux.HandleFunc("/billing/checkout", a.handleCheckout)
	mux.HandleFunc("/ai/chat", a.handleChat)
	return a.metricsMiddleware(mux)
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	deps := map[string]string{"auth": "ok", "billing": "ok", "quota": "ok", "user": "ok", "ai_gateway": "ok"}
	ok := true
	if _, err := a.billing.ListPlans(ctx, &drpc.ListPlansRequest{}); err != nil {
		ok = false
		deps["billing"] = err.Error()
	}
	if _, err := a.quota.GetTokenBalance(ctx, &drpc.GetTokenBalanceRequest{UserID: "00000000-0000-4000-8000-000000000001"}); err != nil {
		ok = false
		deps["quota"] = err.Error()
	}
	if _, err := a.user.GetProfile(ctx, &drpc.GetProfileRequest{UserID: "00000000-0000-4000-8000-000000000001"}); err != nil {
		ok = false
		deps["user"] = err.Error()
	}
	statusCode := http.StatusOK
	if !ok {
		statusCode = http.StatusServiceUnavailable
	}
	writeJSON(w, statusCode, map[string]any{"ok": ok, "service": "bff-interface", "version": "0.3.0", "dependencies": deps})
}

func (a *app) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte("# HELP dramaip_bff_http_requests_total Total HTTP requests handled by the BFF.\n# TYPE dramaip_bff_http_requests_total counter\n"))
	_, _ = w.Write([]byte("dramaip_bff_http_requests_total " + formatUint(atomic.LoadUint64(&a.requestsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_logins_total " + formatUint(atomic.LoadUint64(&a.loginsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_checkouts_total " + formatUint(atomic.LoadUint64(&a.checkoutsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_chats_total " + formatUint(atomic.LoadUint64(&a.chatsTotal)) + "\n"))
}

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req drpc.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	session, err := a.auth.Login(r.Context(), &req)
	if err != nil {
		writeGRPCError(w, err, "login_unavailable")
		return
	}
	atomic.AddUint64(&a.loginsTotal, 1)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": session.AccessToken, "refresh_token": session.RefreshToken, "token_type": session.TokenType,
		"expires_in": session.ExpiresIn, "user": map[string]any{"id": session.UserID, "email": session.Email, "name": session.Name},
	})
}

func (a *app) handlePlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	plans, err := a.billing.ListPlans(r.Context(), &drpc.ListPlansRequest{})
	if err != nil {
		writeGRPCError(w, err, "plans_unavailable")
		return
	}
	out := make([]map[string]any, 0, len(plans.Plans))
	for _, plan := range plans.Plans {
		out = append(out, map[string]any{
			"id": plan.Code, "name": plan.Name, "price_cny": plan.PriceCNY, "quota_tokens": plan.MonthlyTokenQuota,
			"description": planDescription(plan.MonthlyTokenQuota, plan.MaxRPM, plan.ModelLevel),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": out})
}

func (a *app) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := a.authenticate(w, r)
	if !ok {
		return
	}
	profile, err := a.user.GetProfile(r.Context(), &drpc.GetProfileRequest{UserID: auth.UserID})
	if err != nil {
		writeGRPCError(w, err, "profile_unavailable")
		return
	}
	sub, err := a.billing.GetSubscription(r.Context(), &drpc.GetSubscriptionRequest{UserID: auth.UserID})
	if err != nil {
		writeGRPCError(w, err, "subscription_unavailable")
		return
	}
	balance, err := a.quota.GetTokenBalance(r.Context(), &drpc.GetTokenBalanceRequest{UserID: auth.UserID})
	if err != nil {
		writeGRPCError(w, err, "token_balance_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id": auth.UserID, "email": profile.Email, "name": profile.DisplayName,
		"subscription_status": sub.Status, "plan": balance.Plan, "quota_tokens": balance.QuotaTokens,
		"used_tokens": balance.UsedTokens, "remaining_tokens": balance.RemainingTokens,
	})
}

func (a *app) handleTokenBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := a.authenticate(w, r)
	if !ok {
		return
	}
	balance, err := a.quota.GetTokenBalance(r.Context(), &drpc.GetTokenBalanceRequest{UserID: auth.UserID})
	if err != nil {
		writeGRPCError(w, err, "token_balance_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, balance)
}

func (a *app) handleCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := a.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		PlanID  string `json:"plan_id"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.PlanID == "" {
		writeError(w, http.StatusBadRequest, "missing_plan_id")
		return
	}
	checkout, err := a.billing.CreateCheckout(r.Context(), &drpc.CreateCheckoutRequest{UserID: auth.UserID, PlanID: req.PlanID, Provider: req.Channel})
	if err != nil {
		writeGRPCError(w, err, "checkout_unavailable")
		return
	}
	atomic.AddUint64(&a.checkoutsTotal, 1)
	writeJSON(w, http.StatusOK, map[string]any{
		"checkout_id": checkout.OrderID, "plan_id": checkout.PlanID, "channel": checkout.Provider,
		"status": checkout.Status, "checkout_url": checkout.PaymentURL,
	})
}

func (a *app) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := a.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		RequestID string             `json:"request_id"`
		Provider  string             `json:"provider"`
		Model     string             `json:"model"`
		Messages  []drpc.ChatMessage `json:"messages"`
		MaxTokens int64              `json:"max_tokens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	reply, err := a.ai.Chat(r.Context(), &drpc.ChatRequest{UserID: auth.UserID, RequestID: req.RequestID, Provider: req.Provider, Model: req.Model, Messages: req.Messages, MaxTokens: req.MaxTokens})
	if err != nil {
		writeGRPCError(w, err, "chat_unavailable")
		return
	}
	atomic.AddUint64(&a.chatsTotal, 1)
	writeJSON(w, http.StatusOK, reply)
}

func (a *app) authenticate(w http.ResponseWriter, r *http.Request) (*drpc.AuthReply, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		writeError(w, http.StatusUnauthorized, "missing_bearer_token")
		return nil, false
	}
	auth, err := a.auth.ValidateAccessToken(r.Context(), &drpc.ValidateAccessTokenRequest{AccessToken: strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))})
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_token")
		return nil, false
	}
	return auth, true
}

func (a *app) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&a.requestsTotal, 1)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, statusCode int, code string) {
	writeJSON(w, statusCode, map[string]string{"error": code})
}

func writeGRPCError(w http.ResponseWriter, err error, fallback string) {
	code := http.StatusServiceUnavailable
	if st, ok := status.FromError(err); ok {
		switch st.Code() {
		case codes.InvalidArgument:
			code = http.StatusBadRequest
		case codes.Unauthenticated:
			code = http.StatusUnauthorized
		case codes.NotFound:
			code = http.StatusNotFound
		case codes.ResourceExhausted:
			code = http.StatusPaymentRequired
		}
		writeJSON(w, code, map[string]string{"error": st.Message()})
		return
	}
	writeJSON(w, code, map[string]string{"error": fallback})
}

func planDescription(quotaTokens int64, rpm int64, modelLevel string) string {
	if quotaTokens <= 10_000 {
		return "Evaluate the product and connect the desktop app."
	}
	if modelLevel == "" {
		modelLevel = "standard"
	}
	return strings.ToUpper(modelLevel[:1]) + modelLevel[1:] + " model access, monthly tokens, " + formatUint(uint64(rpm)) + " RPM."
}

func formatUint(value uint64) string {
	if value == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[i:])
}
