package service

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPService struct {
	uc                         *biz.AdminUsecase
	reporting                  *biz.ReportingUsecase
	requestsTotal, errorsTotal uint64
}

func NewHTTPService(uc *biz.AdminUsecase, reporting *biz.ReportingUsecase) *HTTPService {
	return &HTTPService{uc: uc, reporting: reporting}
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
	return platform.TraceMiddleware("admin-bff-interface", s.metricsMiddleware(mux))
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
	response, err := s.reporting.Users(r.Context(), actor, limit)
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
	response, err := s.reporting.Orders(r.Context(), actor, limit)
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
	response, err := s.reporting.Subscriptions(r.Context(), actor, limit)
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
	response, err := s.reporting.Exceptions(r.Context(), actor, limit, includeResolved)
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
	writeJSON(w, statusCode, map[string]any{"error": map[string]string{"code": code}})
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
