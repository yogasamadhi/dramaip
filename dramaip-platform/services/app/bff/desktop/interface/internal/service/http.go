package service

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPService struct {
	uc            *biz.BFFUsecase
	requestsTotal uint64
	errorsTotal   uint64
}

func NewHTTPService(uc *biz.BFFUsecase) *HTTPService { return &HTTPService{uc: uc} }

func (s *HTTPService) Router() http.Handler {
	mux := http.NewServeMux()
	// Cluster probes bypass Kong; the versioned endpoint remains the public API.
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/desktop/healthz", s.handleHealth)
	mux.HandleFunc("/v1/desktop/auth/token", s.handleExchange)
	mux.HandleFunc("/v1/desktop/auth/refresh", s.handleRefresh)
	mux.HandleFunc("/v1/desktop/auth/logout", s.handleLogout)
	mux.HandleFunc("/v1/desktop/me/cloud-context", s.handleCloudContext)
	return platform.TraceMiddleware("desktop-bff-interface", s.metricsMiddleware(mux))
}

func (s *HTTPService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "desktop-bff-interface", "version": "0.4.0"})
}

func (s *HTTPService) handleExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		AuthorizationCode string `json:"authorization_code"`
		CodeVerifier      string `json:"code_verifier"`
		RedirectURI       string `json:"redirect_uri"`
		DeviceID          string `json:"device_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	session, err := s.uc.Exchange(r.Context(), req.AuthorizationCode, req.CodeVerifier, req.RedirectURI, req.DeviceID)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_token_exchange_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(session))
}

func (s *HTTPService) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	session, err := s.uc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_refresh_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(session))
}

func (s *HTTPService) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
		DeviceID     string `json:"device_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	reply, err := s.uc.Logout(r.Context(), req.RefreshToken, r.Header.Get("Authorization"), req.DeviceID)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_logout_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": reply.Ok})
}

func (s *HTTPService) handleCloudContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	identity, subscription, balance, err := s.uc.Context(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		s.writeGRPCError(w, err, "desktop_context_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":          map[string]string{"id": identity.UserId, "email": identity.Email, "name": identity.Name},
		"subscription":  map[string]string{"id": subscription.Id, "plan": subscription.PlanCode, "status": subscription.Status},
		"token_balance": map[string]any{"plan": balance.Plan, "quota_tokens": balance.QuotaTokens, "used_tokens": balance.UsedTokens, "remaining_tokens": balance.RemainingTokens},
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

func sessionResponse(session interface {
	GetAccessToken() string
	GetRefreshToken() string
	GetExpiresIn() int64
	GetTokenType() string
	GetUserId() string
	GetEmail() string
	GetName() string
	GetEmailVerified() bool
}) map[string]any {
	return map[string]any{
		"access_token": session.GetAccessToken(), "refresh_token": session.GetRefreshToken(), "expires_in": session.GetExpiresIn(), "token_type": session.GetTokenType(),
		"user": map[string]any{"id": session.GetUserId(), "email": session.GetEmail(), "name": session.GetName(), "email_verified": session.GetEmailVerified()},
	}
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

func bearerToken(value string) string {
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}
