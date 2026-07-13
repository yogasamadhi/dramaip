package service

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/dramaip/dramaip-platform/services/app/bff/mobile/interface/internal/biz"
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
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/v1/mobile/healthz", s.handleHealth)
	mux.HandleFunc("/v1/mobile/auth/login", s.handleLogin)
	mux.HandleFunc("/v1/mobile/auth/refresh", s.handleRefresh)
	mux.HandleFunc("/v1/mobile/auth/logout", s.handleLogout)
	mux.HandleFunc("/v1/mobile/me/brief", s.handleBrief)
	return platform.TraceMiddleware("mobile-bff-interface", s.metricsMiddleware(mux))
}

func (s *HTTPService) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	platform.WritePrometheus(w, "mobile-bff-interface")
	_, _ = w.Write([]byte("# HELP dramaip_mobile_bff_http_requests_total Total HTTP requests handled by the Mobile BFF.\n# TYPE dramaip_mobile_bff_http_requests_total counter\n"))
	_, _ = w.Write([]byte("dramaip_mobile_bff_http_requests_total " + strconv.FormatUint(atomic.LoadUint64(&s.requestsTotal), 10) + "\n"))
	_, _ = w.Write([]byte("dramaip_mobile_bff_errors_total " + strconv.FormatUint(atomic.LoadUint64(&s.errorsTotal), 10) + "\n"))
}

func (s *HTTPService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "mobile-bff-interface", "version": "0.4.0"})
}

func (s *HTTPService) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		DeviceID string `json:"device_id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if !validDeviceID(req.DeviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id")
		return
	}
	session, err := s.uc.Login(r.Context(), req.Email, req.Password, req.DeviceID)
	if err != nil {
		s.writeGRPCError(w, err, "mobile_login_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
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
		s.writeGRPCError(w, err, "mobile_refresh_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
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
	if !validDeviceID(req.DeviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id")
		return
	}
	reply, err := s.uc.Logout(r.Context(), req.RefreshToken, r.Header.Get("Authorization"), req.DeviceID)
	if err != nil {
		s.writeGRPCError(w, err, "mobile_logout_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": reply.Ok})
}

func (s *HTTPService) handleBrief(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	identity, subscription, balance, err := s.uc.Brief(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		s.writeGRPCError(w, err, "mobile_brief_unavailable")
		return
	}
	// This endpoint is deliberately the three-field mobile account view. Email,
	// orders, invoices and usage history remain in the Web account surface.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"display_name":     identity.Name,
		"plan":             subscription.PlanCode,
		"remaining_tokens": balance.RemainingTokens,
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
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

func validDeviceID(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func sessionResponse(session interface {
	GetAccessToken() string
	GetRefreshToken() string
	GetExpiresIn() int64
	GetTokenType() string
	GetUserId() string
	GetName() string
}) map[string]any {
	return map[string]any{
		"access_token": session.GetAccessToken(), "refresh_token": session.GetRefreshToken(),
		"expires_in": session.GetExpiresIn(), "token_type": session.GetTokenType(),
		"user": map[string]string{"id": session.GetUserId(), "name": session.GetName()},
	}
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, statusCode int, code string) {
	writeJSON(w, statusCode, map[string]string{"error": code})
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
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, status.Convert(err).Message())
	case codes.DeadlineExceeded:
		writeError(w, http.StatusGatewayTimeout, status.Convert(err).Message())
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
