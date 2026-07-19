package service

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPService struct {
	uc                         *biz.AdminUsecase
	reporting                  *biz.ReportingUsecase
	operations                 *biz.OperationsUsecase
	requestsTotal, errorsTotal uint64
}

func NewHTTPService(uc *biz.AdminUsecase, reporting *biz.ReportingUsecase) *HTTPService {
	return &HTTPService{uc: uc, reporting: reporting}
}
func NewHTTPServiceWithOperations(uc *biz.AdminUsecase, reporting *biz.ReportingUsecase, operations *biz.OperationsUsecase) *HTTPService {
	return &HTTPService{uc: uc, reporting: reporting, operations: operations}
}

func (s *HTTPService) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/admin/healthz", s.handleHealth)
	mux.HandleFunc("/v1/admin/.well-known/jwks.json", s.handleJWKS)
	mux.HandleFunc("/v1/admin/auth/login", s.handleLogin)
	mux.HandleFunc("/v1/admin/me", s.handleMe)
	mux.HandleFunc("/v1/admin/confirmations", s.handleConfirmation)
	mux.HandleFunc("/v1/admin/principals/suspend", s.handleSuspend)
	mux.HandleFunc("/v1/admin/audit", s.handleAudit)
	mux.HandleFunc("/v1/admin/reporting/overview", s.handleReportingOverview)
	mux.HandleFunc("/v1/admin/reporting/users", s.handleReportingUsers)
	mux.HandleFunc("/v1/admin/reporting/orders", s.handleReportingOrders)
	mux.HandleFunc("/v1/admin/reporting/subscriptions", s.handleReportingSubscriptions)
	mux.HandleFunc("/v1/admin/reporting/exceptions", s.handleReportingExceptions)
	mux.HandleFunc("/v1/admin/reporting/exceptions/resolve", s.handleResolveReportingException)
	mux.HandleFunc("/v1/admin/customers/", s.handleCustomer)
	mux.HandleFunc("/v1/admin/ai/cost-alerts", s.handleCostAlerts)
	mux.HandleFunc("/v1/admin/customers/status", s.handleCustomerStatus)
	mux.HandleFunc("/v1/admin/billing/refunds", s.handleRefund)
	mux.HandleFunc("/v1/admin/billing/subscriptions/resume", s.handleResumeSubscription)
	mux.HandleFunc("/v1/admin/quota/adjustments", s.handleQuotaAdjustment)
	mux.HandleFunc("/v1/admin/notifications/send", s.handleSendNotification)
	return platform.TraceMiddleware("admin-bff-interface", s.metricsMiddleware(platform.ClientContractMiddleware(mux)))
}

func (s *HTTPService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "admin-bff-interface", "version": "0.1.0"})
}
func (s *HTTPService) handleJWKS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(s.uc.JWKS())
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
	if !decodeJSON(w, r, &req) {
		return
	}
	login, err := s.uc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		s.writeGRPCError(w, err, "admin_login_unavailable")
		return
	}
	// A privileged browser client receives no refresh token. The short-lived
	// access token is returned only over this dedicated Admin route; LM3-31
	// will decide the UI's concrete transport/storage strategy.
	writeJSON(w, http.StatusOK, map[string]any{"access_token": login.AccessToken, "token_type": "Bearer", "expires_in": login.ExpiresIn, "principal": principalJSON(login.Principal)})
}
func (s *HTTPService) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"principal": principalJSON(actor)})
}
func (s *HTTPService) handleConfirmation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		Action   string `json:"action"`
		TargetID string `json:"target_id"`
		Reason   string `json:"reason"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	confirmation, err := s.uc.CreateConfirmation(r.Context(), actor, req.Action, req.TargetID, req.Reason)
	if err != nil {
		s.writeGRPCError(w, err, "admin_confirmation_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"confirmation": map[string]string{"id": confirmation.ID, "action": confirmation.Action, "target_id": confirmation.TargetID, "expires_at": confirmation.ExpiresAt}})
}
func (s *HTTPService) handleSuspend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		TargetID       string `json:"target_id"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	principal, err := s.uc.SuspendPrincipal(r.Context(), actor, req.TargetID, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "admin_suspension_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"principal": principalJSON(principal)})
}
func (s *HTTPService) handleAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	entries, err := s.uc.ListAudit(r.Context(), actor, limit)
	if err != nil {
		s.writeGRPCError(w, err, "admin_audit_unavailable")
		return
	}
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		items = append(items, map[string]any{"id": entry.ID, "actor_id": entry.ActorID, "action": entry.Action, "resource_type": entry.ResourceType, "resource_id": entry.ResourceID, "reason": entry.Reason, "before_state": entry.BeforeState, "after_state": entry.AfterState, "trace_id": entry.TraceID, "created_at": entry.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": items})
}
func (s *HTTPService) handleReportingOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	response, err := s.reporting.Overview(r.Context(), actor)
	if err != nil {
		s.writeGRPCError(w, err, "reporting_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) handleReportingUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	response, err := s.reporting.Users(r.Context(), actor, limit, r.URL.Query().Get("cursor"), r.URL.Query().Get("query"))
	if err != nil {
		s.writeGRPCError(w, err, "reporting_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) handleReportingOrders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	response, err := s.reporting.Orders(r.Context(), actor, limit, r.URL.Query().Get("cursor"), r.URL.Query().Get("query"))
	if err != nil {
		s.writeGRPCError(w, err, "reporting_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) handleReportingSubscriptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	response, err := s.reporting.Subscriptions(r.Context(), actor, limit, r.URL.Query().Get("cursor"), r.URL.Query().Get("query"))
	if err != nil {
		s.writeGRPCError(w, err, "reporting_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) handleReportingExceptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	includeResolved := r.URL.Query().Get("include_resolved") == "true"
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	response, err := s.reporting.Exceptions(r.Context(), actor, limit, includeResolved, r.URL.Query().Get("cursor"), r.URL.Query().Get("query"))
	if err != nil {
		s.writeGRPCError(w, err, "reporting_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) handleResolveReportingException(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		ExceptionID    string `json:"exception_id"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if s.reporting == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting_unavailable")
		return
	}
	reason, err := s.uc.ConsumeReportingExceptionConfirmation(r.Context(), actor, req.ExceptionID, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "admin_confirmation_unavailable")
		return
	}
	response, err := s.reporting.ResolveException(r.Context(), actor, req.ExceptionID, reason)
	if err != nil {
		s.writeGRPCError(w, err, "reporting_exception_resolution_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *HTTPService) operationActor(w http.ResponseWriter, r *http.Request) (biz.Principal, bool) {
	actor, ok := s.authenticate(w, r)
	if !ok {
		return biz.Principal{}, false
	}
	if s.operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_operations_unavailable")
		return biz.Principal{}, false
	}
	return actor, true
}
func (s *HTTPService) handleCustomer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	userID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/admin/customers/"), "/")
	if userID == "" || strings.Contains(userID, "/") {
		writeError(w, http.StatusBadRequest, "invalid_user_id")
		return
	}
	detail, err := s.operations.Customer(r.Context(), actor, userID)
	if err != nil {
		s.writeGRPCError(w, err, "customer_lookup_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, customerJSON(detail))
}
func (s *HTTPService) handleCostAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	limit, ok := parseLimit(w, r)
	if !ok {
		return
	}
	reply, err := s.operations.CostAlerts(r.Context(), actor, limit, r.URL.Query().Get("user_id"))
	if err != nil {
		s.writeGRPCError(w, err, "ai_cost_alerts_unavailable")
		return
	}
	alerts := make([]map[string]string, 0, len(reply.GetAlerts()))
	for _, row := range reply.GetAlerts() {
		alerts = append(alerts, map[string]string{"id": row.GetId(), "audit_id": row.GetAuditId(), "user_id": row.GetUserId(), "event_type": row.GetEventType(), "observed_cost_cny": row.GetObservedCostCny(), "threshold_cny": row.GetThresholdCny(), "trace_id": row.GetTraceId(), "created_at": row.GetCreatedAt()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"alerts": alerts})
}
func (s *HTTPService) handleCustomerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID         string `json:"user_id"`
		Status         string `json:"status"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	profile, err := s.operations.SetCustomerStatus(r.Context(), actor, req.UserID, req.Status, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "customer_status_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profileJSON(profile)})
}
func (s *HTTPService) handleRefund(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID         string `json:"user_id"`
		SubscriptionID string `json:"subscription_id"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	refund, err := s.operations.RequestRefund(r.Context(), actor, req.UserID, req.SubscriptionID, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "refund_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"refund": map[string]any{"id": refund.GetId(), "subscription_id": refund.GetSubscriptionId(), "status": refund.GetStatus(), "used_tokens": refund.GetUsedTokens(), "quota_hold_status": refund.GetQuotaHoldStatus()}})
}
func (s *HTTPService) handleResumeSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID         string `json:"user_id"`
		SubscriptionID string `json:"subscription_id"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	subscription, err := s.operations.ResumeSubscription(r.Context(), actor, req.UserID, req.SubscriptionID, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "subscription_resume_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscription": subscriptionJSON(subscription)})
}
func (s *HTTPService) handleQuotaAdjustment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID         string `json:"user_id"`
		SubscriptionID string `json:"subscription_id"`
		DeltaTokens    int64  `json:"delta_tokens"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	adjustment, err := s.operations.AdjustQuota(r.Context(), actor, req.UserID, req.SubscriptionID, req.DeltaTokens, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "quota_adjustment_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"adjustment": map[string]any{"id": adjustment.GetAdjustmentId(), "delta_tokens": adjustment.GetDeltaTokens(), "quota_before": adjustment.GetQuotaBefore(), "quota_after": adjustment.GetQuotaAfter(), "status": adjustment.GetStatus()}})
}
func (s *HTTPService) handleSendNotification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.operationActor(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID         string `json:"user_id"`
		Title          string `json:"title"`
		Body           string `json:"body"`
		ConfirmationID string `json:"confirmation_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	notification, err := s.operations.SendNotification(r.Context(), actor, req.UserID, req.Title, req.Body, req.ConfirmationID)
	if err != nil {
		s.writeGRPCError(w, err, "notification_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"notification": notificationJSON(notification)})
}
func parseLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return 0, false
		}
		limit = parsed
	}
	return limit, true
}
func (s *HTTPService) authenticate(w http.ResponseWriter, r *http.Request) (biz.Principal, bool) {
	raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if raw == "" || raw == r.Header.Get("Authorization") {
		writeError(w, http.StatusUnauthorized, "admin_bearer_required")
		return biz.Principal{}, false
	}
	actor, err := s.uc.Authenticate(r.Context(), raw)
	if err != nil {
		s.writeGRPCError(w, err, "admin_auth_unavailable")
		return biz.Principal{}, false
	}
	return actor, true
}
func principalJSON(value biz.Principal) map[string]any {
	return map[string]any{"id": value.ID, "email": value.Email, "status": value.Status, "roles": value.Roles, "permissions": value.Permissions}
}
func profileJSON(value *userv1.UserProfile) map[string]string {
	if value == nil {
		return nil
	}
	return map[string]string{"id": value.GetId(), "email": value.GetEmail(), "phone": value.GetPhone(), "display_name": value.GetDisplayName(), "status": value.GetStatus(), "locale": value.GetLocale(), "timezone": value.GetTimezone()}
}
func subscriptionJSON(value *billingv1.Subscription) map[string]any {
	if value == nil {
		return nil
	}
	return map[string]any{"id": value.GetId(), "user_id": value.GetUserId(), "plan_code": value.GetPlanCode(), "status": value.GetStatus(), "period_start": value.GetCurrentPeriodStart(), "period_end": value.GetCurrentPeriodEnd(), "cancel_at_period_end": value.GetCancelAtPeriodEnd(), "lifecycle_error": value.GetLifecycleError()}
}
func notificationJSON(value *notificationv1.Notification) map[string]string {
	if value == nil {
		return nil
	}
	return map[string]string{"id": value.GetId(), "type": value.GetType(), "title": value.GetTitle(), "body": value.GetBody(), "source_event_id": value.GetSourceEventId(), "read_at": value.GetReadAt(), "created_at": value.GetCreatedAt()}
}
func customerJSON(value *biz.CustomerDetail) map[string]any {
	orders := make([]map[string]string, 0, len(value.Orders))
	for _, order := range value.Orders {
		orders = append(orders, map[string]string{"id": order.GetId(), "plan_code": order.GetPlanCode(), "provider": order.GetProvider(), "status": order.GetStatus(), "amount": order.GetAmount(), "currency": order.GetCurrency(), "subscription_id": order.GetSubscriptionId(), "created_at": order.GetCreatedAt()})
	}
	usage := make([]map[string]any, 0, len(value.Usage))
	for _, row := range value.Usage {
		usage = append(usage, map[string]any{"id": row.GetId(), "request_id": row.GetRequestId(), "model": row.GetModel(), "total_tokens": row.GetTotalTokens(), "status": row.GetStatus(), "created_at": row.GetCreatedAt()})
	}
	notifications := make([]map[string]string, 0, len(value.Notifications))
	for _, row := range value.Notifications {
		notifications = append(notifications, notificationJSON(row))
	}
	var balance map[string]any
	if value.Balance != nil {
		balance = map[string]any{"plan": value.Balance.GetPlan(), "quota_tokens": value.Balance.GetQuotaTokens(), "used_tokens": value.Balance.GetUsedTokens(), "remaining_tokens": value.Balance.GetRemainingTokens(), "period_start": value.Balance.GetPeriodStart(), "period_end": value.Balance.GetPeriodEnd()}
	}
	return map[string]any{"profile": profileJSON(value.Profile), "subscription": subscriptionJSON(value.Subscription), "orders": orders, "balance": balance, "usage": usage, "notifications": notifications}
}
func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	if decoder.More() {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, statusCode int, code string) {
	writeJSON(w, statusCode, map[string]any{"error": platform.ContractErrorBody(w, code)})
}
func (s *HTTPService) writeGRPCError(w http.ResponseWriter, err error, fallback string) {
	atomic.AddUint64(&s.errorsTotal, 1)
	switch status.Code(err) {
	case codes.InvalidArgument:
		writeError(w, http.StatusBadRequest, status.Convert(err).Message())
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, status.Convert(err).Message())
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, status.Convert(err).Message())
	case codes.NotFound:
		writeError(w, http.StatusNotFound, status.Convert(err).Message())
	case codes.FailedPrecondition:
		writeError(w, http.StatusPreconditionFailed, status.Convert(err).Message())
	default:
		writeError(w, http.StatusServiceUnavailable, fallback)
	}
}
func (s *HTTPService) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&s.requestsTotal, 1)
		next.ServeHTTP(w, r)
	})
}
