package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPService struct {
	uc             *biz.BFFUsecase
	requestsTotal  uint64
	loginsTotal    uint64
	checkoutsTotal uint64
	chatsTotal     uint64
	errorsTotal    uint64
}

func NewHTTPService(uc *biz.BFFUsecase) *HTTPService {
	return &HTTPService{uc: uc}
}

func (s *HTTPService) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/healthz", s.handleHealth)
	mux.HandleFunc("/v1/metrics", s.handleMetrics)
	mux.HandleFunc("/v1/auth/register", s.handleRegister)
	mux.HandleFunc("/v1/auth/login", s.handleLogin)
	mux.HandleFunc("/v1/auth/refresh", s.handleRefresh)
	mux.HandleFunc("/v1/auth/logout", s.handleLogout)
	mux.HandleFunc("/v1/plans", s.handlePlans)
	mux.HandleFunc("/v1/me/profile", s.handleProfile)
	mux.HandleFunc("/v1/me/dashboard", s.handleDashboard)
	mux.HandleFunc("/v1/me/subscription", s.handleSubscription)
	mux.HandleFunc("/v1/me/token-balance", s.handleTokenBalance)
	mux.HandleFunc("/v1/me/token-usage", s.handleTokenUsage)
	mux.HandleFunc("/v1/me/usage-trend", s.handleUsageTrend)
	mux.HandleFunc("/v1/me/account-report", s.handleAccountReport)
	mux.HandleFunc("/v1/me/notifications/", s.handleNotificationAction)
	mux.HandleFunc("/v1/me/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/me/orders/", s.handleOrder)
	mux.HandleFunc("/v1/me/orders", s.handleOrders)
	mux.HandleFunc("/v1/billing/checkout", s.handleCheckout)
	mux.HandleFunc("/v1/billing/sandbox/confirm-payment", s.handleSandboxConfirmPayment)
	mux.HandleFunc("/v1/billing/payments/simulated/confirm", s.handleSimulatedConfirmPayment)
	mux.HandleFunc("/v1/subscription/cancel", s.handleCancelSubscription)
	mux.HandleFunc("/v1/ai/chat", s.handleChat)
	return platform.TraceMiddleware("bff-interface", s.metricsMiddleware(mux))
}

func (s *HTTPService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	deps := map[string]string{"auth": "ok", "billing": "ok", "quota": "ok", "user": "ok", "ai_gateway": "ok"}
	ok := true
	for name, check := range s.uc.Checks() {
		if err := check(ctx); err != nil {
			ok = false
			deps[name] = err.Error()
		} else {
			deps[name] = "ok"
		}
	}
	statusCode := http.StatusOK
	if !ok {
		statusCode = http.StatusServiceUnavailable
	}
	writeJSON(w, statusCode, map[string]any{"ok": ok, "service": "bff-interface", "version": "0.4.0", "dependencies": deps})
}

func (s *HTTPService) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte("# HELP dramaip_bff_http_requests_total Total HTTP requests handled by the BFF.\n# TYPE dramaip_bff_http_requests_total counter\n"))
	_, _ = w.Write([]byte("dramaip_bff_http_requests_total " + formatUint(atomic.LoadUint64(&s.requestsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_logins_total " + formatUint(atomic.LoadUint64(&s.loginsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_checkouts_total " + formatUint(atomic.LoadUint64(&s.checkoutsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_chats_total " + formatUint(atomic.LoadUint64(&s.chatsTotal)) + "\n"))
	_, _ = w.Write([]byte("dramaip_bff_errors_total " + formatUint(atomic.LoadUint64(&s.errorsTotal)) + "\n"))
}

func (s *HTTPService) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	session, err := s.uc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		writeGRPCError(w, err, "login_unavailable")
		return
	}
	atomic.AddUint64(&s.loginsTotal, 1)
	writeJSON(w, http.StatusOK, loginResponse(session))
}

func (s *HTTPService) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	session, err := s.uc.Register(r.Context(), req.Email, req.Password, req.DisplayName)
	if err != nil {
		writeGRPCError(w, err, "register_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, loginResponse(session))
}

func (s *HTTPService) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	session, err := s.uc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		writeGRPCError(w, err, "refresh_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, loginResponse(session))
}

func (s *HTTPService) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
	}
	reply, err := s.uc.Logout(r.Context(), req.RefreshToken, bearerToken(r.Header.Get("Authorization")))
	if err != nil {
		writeGRPCError(w, err, "logout_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": reply.Ok})
}

func (s *HTTPService) handlePlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	reply, err := s.uc.Plans(r.Context())
	if err != nil {
		writeGRPCError(w, err, "plans_unavailable")
		return
	}
	plans := make([]map[string]any, 0, len(reply.Plans))
	for _, plan := range reply.Plans {
		plans = append(plans, map[string]any{
			"id": plan.Code, "name": plan.Name, "price_cny": plan.PriceCny, "quota_tokens": plan.MonthlyTokenQuota,
			"description": planDescription(plan.MonthlyTokenQuota, plan.MaxRpm, plan.ModelLevel),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": plans})
}

func (s *HTTPService) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	profile, sub, balance, err := s.uc.Dashboard(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "dashboard_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, dashboardResponse(auth.UserId, profile, sub, balance))
}

func (s *HTTPService) handleProfile(w http.ResponseWriter, r *http.Request) {
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		profile, err := s.uc.Profile(r.Context(), auth.UserId)
		if err != nil {
			writeGRPCError(w, err, "profile_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, profileResponse(profile))
	case http.MethodPatch:
		var req struct {
			DisplayName string `json:"display_name"`
			Phone       string `json:"phone"`
			AvatarURL   string `json:"avatar_url"`
			Locale      string `json:"locale"`
			Timezone    string `json:"timezone"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		profile, err := s.uc.UpdateProfile(r.Context(), auth.UserId, req.Phone, req.DisplayName, req.AvatarURL, req.Locale, req.Timezone)
		if err != nil {
			writeGRPCError(w, err, "profile_update_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, profileResponse(profile))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *HTTPService) handleTokenBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	balance, err := s.uc.TokenBalance(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "token_balance_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, tokenBalanceResponse(balance))
}

func (s *HTTPService) handleSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	sub, err := s.uc.Subscription(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "subscription_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, subscriptionResponse(sub))
}

func (s *HTTPService) handleOrders(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/me/orders" {
		s.handleOrder(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	orders, err := s.uc.Orders(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "orders_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, ordersResponse(orders))
}

func (s *HTTPService) handleOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	orderID := strings.TrimPrefix(r.URL.Path, "/v1/me/orders/")
	if orderID == "" || strings.Contains(orderID, "/") {
		writeError(w, http.StatusNotFound, "order_not_found")
		return
	}
	order, err := s.uc.Order(r.Context(), auth.UserId, orderID)
	if err != nil {
		writeGRPCError(w, err, "order_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, orderResponse(order))
}

func (s *HTTPService) handleTokenUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	usage, err := s.uc.TokenUsage(r.Context(), auth.UserId, 50)
	if err != nil {
		writeGRPCError(w, err, "token_usage_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, tokenUsageResponse(usage))
}

func (s *HTTPService) handleUsageTrend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	trend, err := s.uc.UsageTrend(r.Context(), auth.UserId, 14)
	if err != nil {
		writeGRPCError(w, err, "usage_trend_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, usageTrendResponse(trend))
}

func (s *HTTPService) handleAccountReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	report, err := s.uc.AccountReport(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "account_report_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *HTTPService) handleNotifications(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/me/notifications" {
		s.handleNotificationAction(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	notifications, err := s.uc.Notifications(r.Context(), auth.UserId, 50)
	if err != nil {
		writeGRPCError(w, err, "notifications_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, notificationsResponse(notifications))
}

func (s *HTTPService) handleNotificationAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/v1/me/notifications/")
	notificationID, action, ok := strings.Cut(path, "/")
	if !ok || notificationID == "" || action != "read" {
		writeError(w, http.StatusNotFound, "notification_not_found")
		return
	}
	notification, err := s.uc.MarkNotificationRead(r.Context(), auth.UserId, notificationID)
	if err != nil {
		writeGRPCError(w, err, "notification_update_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, notificationResponse(notification))
}

func (s *HTTPService) handleCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
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
	checkout, err := s.uc.Checkout(r.Context(), auth.UserId, req.PlanID, req.Channel)
	if err != nil {
		writeGRPCError(w, err, "checkout_unavailable")
		return
	}
	atomic.AddUint64(&s.checkoutsTotal, 1)
	writeJSON(w, http.StatusOK, map[string]any{
		"checkout_id": checkout.OrderId, "plan_id": checkout.PlanId, "channel": checkout.Provider,
		"status": checkout.Status, "checkout_url": checkout.PaymentUrl,
	})
}

func (s *HTTPService) handleSandboxConfirmPayment(w http.ResponseWriter, r *http.Request) {
	s.handleSimulatedConfirmPayment(w, r)
}

func (s *HTTPService) handleSimulatedConfirmPayment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		CheckoutID string `json:"checkout_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	reply, err := s.uc.SimulatedConfirmPayment(r.Context(), auth.UserId, req.CheckoutID)
	if err != nil {
		writeGRPCError(w, err, "simulated_payment_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, paymentConfirmationResponse(reply))
}

func (s *HTTPService) handleCancelSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		SubscriptionID string `json:"subscription_id"`
		Immediate      bool   `json:"immediate"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
	}
	sub, err := s.uc.CancelSubscription(r.Context(), auth.UserId, req.SubscriptionID, req.Immediate)
	if err != nil {
		writeGRPCError(w, err, "cancel_subscription_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, subscriptionResponse(sub))
}

func (s *HTTPService) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		RequestID string `json:"request_id"`
		Provider  string `json:"provider"`
		Model     string `json:"model"`
		Messages  []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		MaxTokens int64 `json:"max_tokens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	messages := make([]*aiv1.ChatMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		messages = append(messages, &aiv1.ChatMessage{Role: message.Role, Content: message.Content})
	}
	reply, err := s.uc.Chat(r.Context(), auth.UserId, req.RequestID, req.Provider, req.Model, messages, req.MaxTokens)
	if err != nil {
		writeGRPCError(w, err, "chat_unavailable")
		return
	}
	atomic.AddUint64(&s.chatsTotal, 1)
	writeJSON(w, http.StatusOK, chatResponse(reply))
}

func (s *HTTPService) authenticate(w http.ResponseWriter, r *http.Request) (*authv1.AuthReply, bool) {
	auth, err := s.uc.Authenticate(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		writeGRPCError(w, err, "invalid_token")
		return nil, false
	}
	return auth, true
}

func bearerToken(authorization string) string {
	if !strings.HasPrefix(authorization, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
}

func (s *HTTPService) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&s.requestsTotal, 1)
		rec := &traceResponseWriter{ResponseWriter: w, statusCode: http.StatusOK, traceID: platform.TraceID(r.Context())}
		next.ServeHTTP(rec, r)
		if rec.statusCode >= 400 {
			atomic.AddUint64(&s.errorsTotal, 1)
		}
	})
}

type traceResponseWriter struct {
	http.ResponseWriter
	statusCode int
	traceID    string
}

func (w *traceResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *traceResponseWriter) TraceID() string {
	return w.traceID
}

func traceIDFromWriter(w http.ResponseWriter) string {
	if traced, ok := w.(interface{ TraceID() string }); ok {
		return traced.TraceID()
	}
	return ""
}

func loginResponse(session *authv1.AuthReply) map[string]any {
	return map[string]any{
		"access_token": session.AccessToken, "refresh_token": session.RefreshToken, "token_type": session.TokenType,
		"expires_in": session.ExpiresIn, "user": map[string]any{"id": session.UserId, "email": session.Email, "name": session.Name},
	}
}

func dashboardResponse(userID string, profile *userv1.UserProfile, sub *billingv1.Subscription, balance *quotav1.TokenBalance) map[string]any {
	return map[string]any{
		"user_id": userID, "email": profile.Email, "name": profile.DisplayName,
		"subscription_status": sub.Status, "plan": sub.PlanCode, "quota_tokens": balance.QuotaTokens,
		"used_tokens": balance.UsedTokens, "remaining_tokens": balance.RemainingTokens,
	}
}

func profileResponse(profile *userv1.UserProfile) map[string]any {
	return map[string]any{
		"id": profile.Id, "email": profile.Email, "phone": profile.Phone, "status": profile.Status,
		"display_name": profile.DisplayName, "avatar_url": profile.AvatarUrl,
		"locale": profile.Locale, "timezone": profile.Timezone,
	}
}

func tokenBalanceResponse(balance *quotav1.TokenBalance) map[string]any {
	if balance == nil {
		balance = &quotav1.TokenBalance{}
	}
	return map[string]any{
		"plan": balance.Plan, "quota_tokens": balance.QuotaTokens, "used_tokens": balance.UsedTokens,
		"remaining_tokens": balance.RemainingTokens, "period_start": balance.PeriodStart, "period_end": balance.PeriodEnd,
	}
}

func billingTokenBalanceResponse(balance *billingv1.TokenBalance) map[string]any {
	if balance == nil {
		balance = &billingv1.TokenBalance{}
	}
	return map[string]any{
		"plan": balance.Plan, "quota_tokens": balance.QuotaTokens, "used_tokens": balance.UsedTokens,
		"remaining_tokens": balance.RemainingTokens, "period_start": balance.PeriodStart, "period_end": balance.PeriodEnd,
	}
}

func subscriptionResponse(sub *billingv1.Subscription) map[string]any {
	if sub == nil {
		sub = &billingv1.Subscription{}
	}
	return map[string]any{
		"id": sub.Id, "user_id": sub.UserId, "plan_id": sub.PlanId, "plan_code": sub.PlanCode,
		"status": sub.Status, "current_period_start": sub.CurrentPeriodStart, "current_period_end": sub.CurrentPeriodEnd,
		"cancel_at_period_end": sub.CancelAtPeriodEnd, "canceled_at": sub.CanceledAt,
	}
}

func orderResponse(order *billingv1.Order) map[string]any {
	if order == nil {
		order = &billingv1.Order{}
	}
	return map[string]any{
		"id": order.Id, "user_id": order.UserId, "plan_id": order.PlanId, "plan_code": order.PlanCode,
		"provider": order.Provider, "status": order.Status, "amount": order.Amount, "currency": order.Currency,
		"payment_url": order.PaymentUrl, "created_at": order.CreatedAt, "paid_at": order.PaidAt,
		"subscription_id": order.SubscriptionId,
	}
}

func ordersResponse(reply *billingv1.ListOrdersReply) map[string]any {
	orders := []map[string]any{}
	if reply != nil {
		for _, order := range reply.Orders {
			orders = append(orders, orderResponse(order))
		}
	}
	return map[string]any{"orders": orders}
}

func tokenUsageResponse(reply *quotav1.ListTokenUsageReply) map[string]any {
	usage := []map[string]any{}
	if reply != nil {
		for _, item := range reply.Usage {
			usage = append(usage, map[string]any{
				"id": item.Id, "reservation_id": "", "request_id": item.RequestId, "model": item.Model,
				"prompt_tokens": item.PromptTokens, "completion_tokens": item.CompletionTokens,
				"total_tokens": item.TotalTokens, "status": item.Status, "created_at": item.CreatedAt,
			})
		}
	}
	return map[string]any{"usage": usage}
}

func usageTrendResponse(reply *quotav1.GetUsageTrendReply) map[string]any {
	points := []map[string]any{}
	if reply != nil {
		for _, point := range reply.Points {
			points = append(points, map[string]any{"date": point.Date, "total_tokens": point.TotalTokens})
		}
	}
	return map[string]any{"points": points}
}

func notificationsResponse(rows []data.NotificationRow) map[string]any {
	items := make([]map[string]any, 0, len(rows))
	unread := 0
	for _, row := range rows {
		if row.ReadAt == "" {
			unread++
		}
		items = append(items, notificationResponse(row))
	}
	return map[string]any{"notifications": items, "unread_count": unread}
}

func notificationResponse(row data.NotificationRow) map[string]any {
	return map[string]any{
		"id": row.ID, "type": row.Type, "title": row.Title, "body": row.Body,
		"source_event_id": row.SourceEventID, "read_at": row.ReadAt, "created_at": row.CreatedAt,
	}
}

func paymentConfirmationResponse(reply *billingv1.ConfirmSimulatedPaymentReply) map[string]any {
	if reply == nil {
		reply = &billingv1.ConfirmSimulatedPaymentReply{}
	}
	return map[string]any{
		"order_id": reply.OrderId, "status": reply.Status,
		"subscription":  subscriptionResponse(reply.Subscription),
		"token_balance": billingTokenBalanceResponse(reply.TokenBalance),
	}
}

func chatResponse(reply *aiv1.ChatReply) map[string]any {
	if reply == nil {
		reply = &aiv1.ChatReply{}
	}
	return map[string]any{
		"request_id": reply.RequestId, "content": reply.Content, "provider": reply.Provider, "model": reply.Model,
		"prompt_tokens": reply.PromptTokens, "completion_tokens": reply.CompletionTokens, "total_tokens": reply.TotalTokens,
		"reservation_id": reply.ReservationId, "remaining_tokens": reply.RemainingTokens, "status": reply.Status,
	}
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		platform.StructuredLog(context.Background(), "bff-interface", "error", "write_json_failed", map[string]any{"error": err.Error()})
	}
}

func writeError(w http.ResponseWriter, statusCode int, code string) {
	writeJSON(w, statusCode, map[string]any{"error": map[string]string{"code": code, "message": code, "trace_id": traceIDFromWriter(w)}})
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
		case codes.AlreadyExists, codes.FailedPrecondition:
			code = http.StatusConflict
		case codes.PermissionDenied:
			code = http.StatusForbidden
		}
		writeJSON(w, code, map[string]any{"error": map[string]string{"code": st.Message(), "message": st.Message(), "trace_id": traceIDFromWriter(w)}})
		return
	}
	writeJSON(w, code, map[string]any{"error": map[string]string{"code": fallback, "message": fallback, "trace_id": traceIDFromWriter(w)}})
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
