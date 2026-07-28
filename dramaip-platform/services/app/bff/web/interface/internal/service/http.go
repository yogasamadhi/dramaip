package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	reviewv1 "github.com/dramaip/dramaip-platform/services/api/review/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPService struct {
	uc             *biz.BFFUsecase
	cookieSecure   bool
	cookieDomain   string
	refreshTTL     time.Duration
	requestsTotal  uint64
	loginsTotal    uint64
	checkoutsTotal uint64
	chatsTotal     uint64
	errorsTotal    uint64
}

const (
	webAccessCookie  = "dramaip_web_access"
	webRefreshCookie = "dramaip_web_refresh"
	webCSRFCookie    = "dramaip_web_csrf"
	csrfHeader       = "X-CSRF-Token"
)

func NewHTTPService(uc *biz.BFFUsecase, cfg *conf.Bootstrap) *HTTPService {
	return &HTTPService{
		uc: uc, cookieSecure: cfg.CookiesSecure(), cookieDomain: strings.TrimSpace(cfg.Session.CookieDomain),
		refreshTTL: kratosx.Duration(cfg.Session.RefreshCookieTTL, 720*time.Hour),
	}
}

func (s *HTTPService) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/healthz", s.handleHealth)
	mux.HandleFunc("/v1/metrics", s.handleMetrics)
	mux.HandleFunc("/v1/auth/register", s.handleRegister)
	mux.HandleFunc("/v1/auth/login", s.handleLogin)
	mux.HandleFunc("/v1/auth/refresh", s.handleRefresh)
	mux.HandleFunc("/v1/auth/logout", s.handleLogout)
	mux.HandleFunc("/v1/auth/session", s.handleSession)
	mux.HandleFunc("/v1/auth/desktop/authorize", s.handleDesktopAuthorize)
	mux.HandleFunc("/v1/auth/email-verification/request", s.handleRequestEmailVerification)
	mux.HandleFunc("/v1/auth/email-verification/confirm", s.handleVerifyEmail)
	mux.HandleFunc("/v1/auth/password-reset/request", s.handleRequestPasswordReset)
	mux.HandleFunc("/v1/auth/password-reset/confirm", s.handleResetPassword)
	mux.HandleFunc("/v1/plans", s.handlePlans)
	mux.HandleFunc("/v1/me/profile", s.handleProfile)
	mux.HandleFunc("/v1/me/dashboard", s.handleDashboard)
	mux.HandleFunc("/v1/me/subscription", s.handleSubscription)
	mux.HandleFunc("/v1/me/token-balance", s.handleTokenBalance)
	mux.HandleFunc("/v1/me/token-usage", s.handleTokenUsage)
	mux.HandleFunc("/v1/me/usage-trend", s.handleUsageTrend)
	mux.HandleFunc("/v1/me/account-bootstrap", s.handleAccountBootstrap)
	mux.HandleFunc("/v1/me/account-report", s.handleAccountReport)
	mux.HandleFunc("/v1/me/workspaces", s.handleWorkspaces)
	mux.HandleFunc("/v1/me/workspaces/members", s.handleWorkspaceMembers)
	mux.HandleFunc("/v1/me/workspaces/invitations", s.handleWorkspaceInvitations)
	mux.HandleFunc("/v1/me/workspace-invitations/accept", s.handleAcceptWorkspaceInvitation)
	mux.HandleFunc("/v1/me/notifications/", s.handleNotificationAction)
	mux.HandleFunc("/v1/me/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/me/orders/", s.handleOrder)
	mux.HandleFunc("/v1/me/orders", s.handleOrders)
	mux.HandleFunc("/v1/billing/checkout", s.handleCheckout)
	mux.HandleFunc("/v1/billing/sandbox/confirm-payment", s.handleSandboxConfirmPayment)
	mux.HandleFunc("/v1/billing/payments/simulated/confirm", s.handleSimulatedConfirmPayment)
	mux.HandleFunc("/v1/subscription/cancel", s.handleCancelSubscription)
	mux.HandleFunc("/v1/subscription/resume", s.handleResumeSubscription)
	mux.HandleFunc("/v1/subscription/change-plan", s.handleChangeSubscriptionPlan)
	mux.HandleFunc("/v1/subscription/refund", s.handleRequestRefund)
	mux.HandleFunc("/v1/ai/models", s.handleChatModels)
	mux.HandleFunc("/v1/ai/preflight", s.handleChatPreflight)
	mux.HandleFunc("/v1/ai/chat/stream", s.handleChatStream)
	mux.HandleFunc("/v1/ai/chat/cancel", s.handleChatCancel)
	mux.HandleFunc("/v1/ai/chat/status", s.handleChatStatus)
	mux.HandleFunc("/v1/ai/chat", s.handleChat)
	mux.HandleFunc("/v1/review/package", s.handlePublicReviewPackage)
	mux.HandleFunc("/v1/review/comments", s.handlePublicReviewComment)
	mux.HandleFunc("/v1/review/decisions", s.handlePublicReviewDecision)
	return platform.TraceMiddleware("web-bff-interface", s.metricsMiddleware(platform.ClientContractMiddleware(s.csrfMiddleware(mux))))
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
	writeJSON(w, statusCode, map[string]any{"ok": ok, "service": "web-bff-interface", "version": "0.4.0", "dependencies": deps})
}

func (s *HTTPService) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	platform.WritePrometheus(w, "web-bff-interface")
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
	session, err := s.uc.Login(r.Context(), req.Email, req.Password, deviceID(r))
	if err != nil {
		writeGRPCError(w, err, "login_unavailable")
		return
	}
	atomic.AddUint64(&s.loginsTotal, 1)
	if err := s.setSessionCookies(w, session); err != nil {
		writeError(w, http.StatusInternalServerError, "session_cookie_failed")
		return
	}
	writeJSON(w, http.StatusOK, webSessionResponse(session))
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
	session, err := s.uc.Register(r.Context(), req.Email, req.Password, req.DisplayName, deviceID(r))
	if err != nil {
		writeGRPCError(w, err, "register_unavailable")
		return
	}
	if err := s.setSessionCookies(w, session); err != nil {
		writeError(w, http.StatusInternalServerError, "session_cookie_failed")
		return
	}
	writeJSON(w, http.StatusOK, webSessionResponse(session))
}

func (s *HTTPService) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	refreshToken := cookieValue(r, webRefreshCookie)
	if refreshToken == "" {
		writeError(w, http.StatusUnauthorized, "missing_refresh_cookie")
		return
	}
	session, err := s.uc.Refresh(r.Context(), refreshToken)
	if err != nil {
		writeGRPCError(w, err, "refresh_unavailable")
		return
	}
	if err := s.setSessionCookies(w, session); err != nil {
		writeError(w, http.StatusInternalServerError, "session_cookie_failed")
		return
	}
	writeJSON(w, http.StatusOK, webSessionResponse(session))
}

func (s *HTTPService) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	// Browser logout is local-first: even if downstream revocation is
	// temporarily unavailable, do not leave usable session cookies behind.
	s.clearSessionCookies(w)
	reply, err := s.uc.Logout(r.Context(), cookieValue(r, webRefreshCookie), accessToken(r), deviceID(r))
	if err != nil {
		writeGRPCError(w, err, "logout_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": reply.Ok})
}

func (s *HTTPService) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"user": map[string]string{"id": auth.UserId, "email": auth.Email, "name": auth.Name}})
}

// handleDesktopAuthorize is deliberately a browser-session-only bridge. It
// returns a one-time code to the local callback, never a refresh/access token.
func (s *HTTPService) handleDesktopAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	codeChallenge := strings.TrimSpace(r.URL.Query().Get("code_challenge"))
	redirectURI := strings.TrimSpace(r.URL.Query().Get("redirect_uri"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	deviceID := strings.TrimSpace(r.URL.Query().Get("device_id"))
	if !validDesktopAuthorizeInput(codeChallenge, redirectURI, state, deviceID) {
		writeError(w, http.StatusBadRequest, "invalid_desktop_authorization_request")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	reply, err := s.uc.CreateDesktopAuthorizationCode(r.Context(), auth.UserId, codeChallenge, redirectURI, deviceID)
	if err != nil {
		writeGRPCError(w, err, "desktop_authorization_unavailable")
		return
	}
	callback, _ := url.Parse(redirectURI) // validated above
	values := callback.Query()
	values.Set("code", reply.AuthorizationCode)
	values.Set("state", state)
	callback.RawQuery = values.Encode()
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, callback.String(), http.StatusFound)
}

func (s *HTTPService) handleRequestEmailVerification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	reply, err := s.uc.RequestEmailVerification(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "email_verification_unavailable")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"accepted": reply.Accepted})
}

func (s *HTTPService) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	reply, err := s.uc.VerifyEmail(r.Context(), auth.UserId, req.Code)
	if err != nil {
		writeGRPCError(w, err, "email_verification_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"accepted": reply.Accepted})
}

func (s *HTTPService) handleRequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	reply, err := s.uc.RequestPasswordReset(r.Context(), req.Email)
	if err != nil {
		writeGRPCError(w, err, "password_reset_unavailable")
		return
	}
	// This response is deliberately identical for a known or unknown email.
	writeJSON(w, http.StatusAccepted, map[string]bool{"accepted": reply.Accepted})
}

func (s *HTTPService) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	reply, err := s.uc.ResetPassword(r.Context(), req.Email, req.Code, req.Password)
	if err != nil {
		writeGRPCError(w, err, "password_reset_unavailable")
		return
	}
	s.clearSessionCookies(w)
	writeJSON(w, http.StatusOK, map[string]bool{"accepted": reply.Accepted})
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
			"description":   planDescription(plan.MonthlyTokenQuota, plan.MaxRpm, plan.ModelLevel),
			"purchase_mode": plan.PurchaseMode, "entitlements": entitlementsResponse(plan.Entitlements),
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

func (s *HTTPService) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	reply, err := s.uc.Workspaces(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "workspaces_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, reply)
}

func (s *HTTPService) handleWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	workspaceID := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	switch r.Method {
	case http.MethodGet:
		reply, err := s.uc.WorkspaceMembers(r.Context(), auth.UserId, workspaceID)
		if err != nil {
			writeGRPCError(w, err, "workspace_members_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, reply)
	case http.MethodPatch:
		var req struct {
			MemberUserID string `json:"member_user_id"`
			Role         string `json:"role"`
		}
		if !decodeJSONLimit(w, r, &req, 4<<10) {
			return
		}
		reply, err := s.uc.UpdateWorkspaceMemberRole(r.Context(), auth.UserId, workspaceID, req.MemberUserID, req.Role)
		if err != nil {
			writeGRPCError(w, err, "workspace_member_update_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, reply)
	case http.MethodDelete:
		memberUserID := strings.TrimSpace(r.URL.Query().Get("member_user_id"))
		reply, err := s.uc.RemoveWorkspaceMember(r.Context(), auth.UserId, workspaceID, memberUserID)
		if err != nil {
			writeGRPCError(w, err, "workspace_member_remove_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, reply)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *HTTPService) handleWorkspaceInvitations(w http.ResponseWriter, r *http.Request) {
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	workspaceID := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	switch r.Method {
	case http.MethodGet:
		reply, err := s.uc.WorkspaceInvitations(r.Context(), auth.UserId, workspaceID)
		if err != nil {
			writeGRPCError(w, err, "workspace_invitations_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, reply)
	case http.MethodPost:
		var req struct {
			Email          string `json:"email"`
			Role           string `json:"role"`
			ExpiresInHours int32  `json:"expires_in_hours"`
		}
		if !decodeJSONLimit(w, r, &req, 4<<10) {
			return
		}
		reply, err := s.uc.InviteWorkspaceMember(r.Context(), auth.UserId, workspaceID, req.Email, req.Role, req.ExpiresInHours)
		if err != nil {
			writeGRPCError(w, err, "workspace_invitation_create_unavailable")
			return
		}
		// token is deliberately present only in this response so deployments
		// without SMTP can expose a copy-link action.
		writeJSON(w, http.StatusCreated, reply)
	case http.MethodDelete:
		invitationID := strings.TrimSpace(r.URL.Query().Get("invitation_id"))
		reply, err := s.uc.RevokeWorkspaceInvitation(r.Context(), auth.UserId, workspaceID, invitationID)
		if err != nil {
			writeGRPCError(w, err, "workspace_invitation_revoke_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, reply)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *HTTPService) handleAcceptWorkspaceInvitation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if !decodeJSONLimit(w, r, &req, 4<<10) {
		return
	}
	reply, err := s.uc.AcceptWorkspaceInvitation(r.Context(), auth.UserId, req.Token)
	if err != nil {
		writeGRPCError(w, err, "workspace_invitation_accept_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, reply)
}

func (s *HTTPService) handlePublicReviewPackage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Token string `json:"token"`
		PIN   string `json:"pin"`
	}
	if !decodeJSONLimit(w, r, &req, 4<<10) {
		return
	}
	reply, err := s.uc.PublicReviewPackage(r.Context(), req.Token, req.PIN)
	if err != nil {
		writeGRPCError(w, err, "review_package_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, reply)
}

func (s *HTTPService) handlePublicReviewComment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req reviewv1.SubmitPublicCommentRequest
	if !decodeJSONLimit(w, r, &req, 16<<10) {
		return
	}
	reply, err := s.uc.SubmitPublicReviewComment(r.Context(), &req)
	if err != nil {
		writeGRPCError(w, err, "review_comment_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, reply)
}

func (s *HTTPService) handlePublicReviewDecision(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req reviewv1.SubmitPublicDecisionRequest
	if !decodeJSONLimit(w, r, &req, 16<<10) {
		return
	}
	reply, err := s.uc.SubmitPublicReviewDecision(r.Context(), &req)
	if err != nil {
		writeGRPCError(w, err, "review_decision_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, reply)
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
	limit, ok := parseContractPositiveQuery(w, r, "limit", 50, 100)
	if !ok {
		return
	}
	usage, err := s.uc.TokenUsage(r.Context(), auth.UserId, int32(limit))
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
	days, ok := parseContractPositiveQuery(w, r, "days", 14, 365)
	if !ok {
		return
	}
	trend, err := s.uc.UsageTrend(r.Context(), auth.UserId, int32(days))
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

func (s *HTTPService) handleAccountBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	usageLimit, ok := parseContractPositiveQuery(w, r, "usage_limit", 50, 100)
	if !ok {
		return
	}
	trendDays, ok := parseContractPositiveQuery(w, r, "trend_days", 30, 365)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, accountBootstrapResponse(s.uc.AccountBootstrap(r.Context(), auth.UserId, usageLimit, trendDays)))
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
	if !auth.EmailVerified {
		writeError(w, http.StatusForbidden, "email_verification_required")
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
		"status": checkout.Status, "checkout_url": checkout.PaymentUrl, "expires_at": checkout.ExpiresAt,
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
	if !auth.EmailVerified {
		writeError(w, http.StatusForbidden, "email_verification_required")
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

func (s *HTTPService) handleResumeSubscription(w http.ResponseWriter, r *http.Request) {
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
		IdempotencyKey string `json:"idempotency_key"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = r.Header.Get("Idempotency-Key")
	}
	sub, err := s.uc.ResumeSubscription(r.Context(), auth.UserId, req.SubscriptionID, req.IdempotencyKey)
	if err != nil {
		writeGRPCError(w, err, "resume_subscription_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, subscriptionResponse(sub))
}

func (s *HTTPService) handleChangeSubscriptionPlan(w http.ResponseWriter, r *http.Request) {
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
		PlanID         string `json:"plan_id"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = r.Header.Get("Idempotency-Key")
	}
	sub, err := s.uc.ChangeSubscriptionPlan(r.Context(), auth.UserId, req.SubscriptionID, req.PlanID, req.IdempotencyKey)
	if err != nil {
		writeGRPCError(w, err, "change_subscription_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, subscriptionResponse(sub))
}

func (s *HTTPService) handleRequestRefund(w http.ResponseWriter, r *http.Request) {
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
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = r.Header.Get("Idempotency-Key")
	}
	refund, err := s.uc.RequestRefund(r.Context(), auth.UserId, req.SubscriptionID, req.Reason, req.IdempotencyKey)
	if err != nil {
		writeGRPCError(w, err, "refund_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, refundResponse(refund))
}

type cloudChatMessageRequest struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type cloudChatPreflightRequest struct {
	Provider  string                    `json:"provider"`
	Model     string                    `json:"model"`
	Messages  []cloudChatMessageRequest `json:"messages"`
	MaxTokens int64                     `json:"max_tokens"`
}

type cloudChatRequest struct {
	RequestID            string                    `json:"request_id"`
	IdempotencyKey       string                    `json:"idempotency_key"`
	Provider             string                    `json:"provider"`
	Model                string                    `json:"model"`
	Messages             []cloudChatMessageRequest `json:"messages"`
	MaxTokens            int64                     `json:"max_tokens"`
	PreflightRequestHash string                    `json:"preflight_request_hash"`
}

func (s *HTTPService) handleChatModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	reply, err := s.uc.ChatModels(r.Context(), auth.UserId)
	if err != nil {
		writeGRPCError(w, err, "chat_models_unavailable")
		return
	}
	models := make([]map[string]any, 0, len(reply.GetModels()))
	for _, model := range reply.GetModels() {
		if model == nil || strings.TrimSpace(model.GetProvider()) == "" || strings.TrimSpace(model.GetModel()) == "" {
			continue
		}
		models = append(models, map[string]any{
			"id": model.GetProvider() + "/" + model.GetModel(), "provider": model.GetProvider(),
			"model": model.GetModel(), "is_default": model.GetIsDefault(),
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *HTTPService) handleChatPreflight(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req cloudChatPreflightRequest
	if !decodeJSONLimit(w, r, &req, 32<<10) {
		return
	}
	messages, contextCharacters, valid := validateCloudChatMessages(req.Messages, req.MaxTokens)
	if !valid {
		writeError(w, http.StatusBadRequest, "invalid_cloud_context")
		return
	}
	preflight, balance, err := s.uc.PreflightChat(r.Context(), auth.UserId, req.Provider, req.Model, messages, contextCharacters, req.MaxTokens)
	if err != nil {
		writeGRPCError(w, err, "chat_preflight_unavailable")
		return
	}
	model := preflight.GetModel()
	if model == nil || !platform.ValidCloudAIRequestHash(preflight.GetRequestHash()) {
		writeError(w, http.StatusServiceUnavailable, "chat_preflight_invalid")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"model":            map[string]any{"provider": model.GetProvider(), "model": model.GetModel(), "is_default": model.GetIsDefault()},
		"estimated_tokens": preflight.GetEstimatedTokens(), "remaining_tokens": balance.GetRemainingTokens(), "request_hash": preflight.GetRequestHash(),
	})
}

func (s *HTTPService) handleChatStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req cloudChatRequest
	if !decodeJSONLimit(w, r, &req, 32<<10) {
		return
	}
	if !platform.ValidCloudAIRequestHash(req.PreflightRequestHash) {
		writeError(w, http.StatusBadRequest, "invalid_preflight_request_hash")
		return
	}
	messages, contextCharacters, valid := validateCloudChatMessages(req.Messages, req.MaxTokens)
	if !valid {
		writeError(w, http.StatusBadRequest, "invalid_cloud_context")
		return
	}
	preflight, _, err := s.uc.PreflightChat(r.Context(), auth.UserId, req.Provider, req.Model, messages, contextCharacters, req.MaxTokens)
	if err != nil {
		writeGRPCError(w, err, "chat_preflight_unavailable")
		return
	}
	if preflight.GetRequestHash() != req.PreflightRequestHash {
		writeError(w, http.StatusConflict, "cloud_preflight_request_mismatch")
		return
	}
	requestID, idempotencyKey := chatRequestIdentity(r, req)
	w.Header().Set("Idempotency-Key", idempotencyKey)
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if !flushSSE(w) {
		return
	}
	// A network disconnect must not double-call an upstream provider on a
	// reconnect. The Gateway owns the active request by idempotency key until
	// it completes or the explicit cancel endpoint is called.
	streamCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 100*time.Second)
	defer cancel()
	stream, err := s.uc.ChatStream(streamCtx, auth.UserId, requestID, idempotencyKey, clientIP(r), req.Provider, req.Model, messages, req.MaxTokens, req.PreflightRequestHash)
	if err != nil {
		writeSSEError(w, r.Context(), requestID, err)
		return
	}
	clientConnected := true
	for {
		event, recvErr := stream.Recv()
		if recvErr == io.EOF {
			return
		}
		if recvErr != nil {
			if clientConnected {
				writeSSEError(w, r.Context(), requestID, recvErr)
			}
			return
		}
		if event == nil {
			continue
		}
		body := map[string]any{"request_id": event.GetRequestId(), "delta": event.GetDelta()}
		if event.GetReply() != nil {
			body["reply"] = chatResponse(event.GetReply())
		}
		if clientConnected && (!writeSSE(w, event.GetType(), body) || !flushSSE(w)) {
			// Keep draining the authenticated Gateway stream after a browser
			// disconnect. The durable idempotency key then lets a reconnect query
			// the same completed audit instead of issuing another provider call.
			clientConnected = false
		}
	}
}

func (s *HTTPService) handleChatCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var req struct {
		IdempotencyKey string `json:"idempotency_key"`
	}
	if !decodeJSONLimit(w, r, &req, 1024) {
		return
	}
	reply, err := s.uc.CancelChat(r.Context(), auth.UserId, strings.TrimSpace(req.IdempotencyKey))
	if err != nil {
		writeGRPCError(w, err, "chat_cancel_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"status": reply.GetStatus()})
}

func (s *HTTPService) handleChatStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	auth, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	idempotencyKey := strings.TrimSpace(r.URL.Query().Get("idempotency_key"))
	if idempotencyKey == "" || len(idempotencyKey) > 256 {
		writeError(w, http.StatusBadRequest, "invalid_idempotency_key")
		return
	}
	reply, err := s.uc.ChatStatus(r.Context(), auth.UserId, idempotencyKey)
	if err != nil {
		writeGRPCError(w, err, "chat_status_unavailable")
		return
	}
	if reply.GetReply() == nil {
		writeError(w, http.StatusServiceUnavailable, "chat_status_invalid")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, chatResponse(reply.GetReply()))
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
	var req cloudChatRequest
	if !decodeJSONLimit(w, r, &req, 32<<10) {
		return
	}
	if !platform.ValidCloudAIRequestHash(req.PreflightRequestHash) {
		writeError(w, http.StatusBadRequest, "invalid_preflight_request_hash")
		return
	}
	messages, contextCharacters, valid := validateCloudChatMessages(req.Messages, req.MaxTokens)
	if !valid {
		writeError(w, http.StatusBadRequest, "invalid_cloud_context")
		return
	}
	// A client can only execute the exact payload that passed the authoritative
	// preflight. Recheck here as Desktop BFF does: the initial preflight is for
	// user feedback, while this one closes the race before Gateway reservation.
	preflight, _, err := s.uc.PreflightChat(r.Context(), auth.UserId, req.Provider, req.Model, messages, contextCharacters, req.MaxTokens)
	if err != nil {
		writeGRPCError(w, err, "chat_preflight_unavailable")
		return
	}
	if preflight.GetRequestHash() != req.PreflightRequestHash {
		writeError(w, http.StatusConflict, "cloud_preflight_request_mismatch")
		return
	}
	requestID, idempotencyKey := chatRequestIdentity(r, req)
	w.Header().Set("Idempotency-Key", idempotencyKey)
	reply, err := s.uc.Chat(r.Context(), auth.UserId, requestID, idempotencyKey, clientIP(r), req.Provider, req.Model, messages, req.MaxTokens, req.PreflightRequestHash)
	if err != nil {
		writeGRPCError(w, err, "chat_unavailable")
		return
	}
	atomic.AddUint64(&s.chatsTotal, 1)
	writeJSON(w, http.StatusOK, chatResponse(reply))
}

func chatRequestIdentity(r *http.Request, req cloudChatRequest) (string, string) {
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	}
	if idempotencyKey == "" {
		// request_id is kept as a legacy idempotency key for older SDKs.
		idempotencyKey = strings.TrimSpace(req.RequestID)
	}
	if idempotencyKey == "" {
		idempotencyKey = platform.NewUUID()
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = idempotencyKey
	}
	return requestID, idempotencyKey
}

func writeSSE(w http.ResponseWriter, event string, value any) bool {
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", strings.TrimSpace(event), raw)
	return err == nil
}

func flushSSE(w http.ResponseWriter) bool {
	return http.NewResponseController(w).Flush() == nil
}

func writeSSEError(w http.ResponseWriter, ctx context.Context, requestID string, err error) {
	message := "chat_stream_unavailable"
	if st, ok := status.FromError(err); ok && strings.TrimSpace(st.Message()) != "" {
		message = st.Message()
	}
	_ = writeSSE(w, "failed", map[string]string{
		"request_id": requestID, "code": message, "trace_id": platform.TraceID(ctx),
	})
	_ = flushSSE(w)
}

func validateCloudChatMessages(input []cloudChatMessageRequest, maxTokens int64) ([]*aiv1.ChatMessage, int64, bool) {
	if len(input) == 0 || len(input) > 8 || maxTokens < 1 || maxTokens > 8_192 {
		return nil, 0, false
	}
	contextCharacters := int64(0)
	messages := make([]*aiv1.ChatMessage, 0, len(input))
	for _, message := range input {
		role := strings.TrimSpace(message.Role)
		if role != "system" && role != "user" && role != "assistant" || strings.TrimSpace(message.Content) == "" {
			return nil, 0, false
		}
		contextCharacters += int64(utf8.RuneCountInString(message.Content))
		if contextCharacters > 24_000 {
			return nil, 0, false
		}
		messages = append(messages, &aiv1.ChatMessage{Role: role, Content: message.Content})
	}
	return messages, contextCharacters, true
}

func (s *HTTPService) authenticate(w http.ResponseWriter, r *http.Request) (*authv1.AuthReply, bool) {
	auth, err := s.uc.Authenticate(r.Context(), accessToken(r))
	if err != nil {
		writeGRPCError(w, err, "invalid_token")
		return nil, false
	}
	// Downstream gRPC receives a user identity only after this BFF has verified
	// the browser JWT/session. Client supplied X-User-* headers are never used.
	*r = *r.WithContext(platform.WithUserIdentity(r.Context(), auth.UserId))
	return auth, true
}

func bearerToken(authorization string) string {
	if !strings.HasPrefix(authorization, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
}

// clientIP uses the right-most valid X-Forwarded-For entry appended by Kong.
// The Web BFF is loopback/internal-only in deployment, so this is a cost
// guardrail key rather than a client-supplied authorization claim.
func clientIP(r *http.Request) string {
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if ip := net.ParseIP(strings.TrimSpace(parts[i])); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && net.ParseIP(host) != nil {
		return host
	}
	if ip := net.ParseIP(strings.TrimSpace(r.RemoteAddr)); ip != nil {
		return ip.String()
	}
	return ""
}

func accessToken(r *http.Request) string {
	if token := bearerToken(r.Header.Get("Authorization")); token != "" {
		return "Bearer " + token
	}
	if token := cookieValue(r, webAccessCookie); token != "" {
		return "Bearer " + token
	}
	return ""
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func deviceID(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Device-Id"))
}

func validDesktopAuthorizeInput(challenge, redirectURI, state, deviceID string) bool {
	if len(challenge) != 43 || len(state) < 16 || len(state) > 256 || len(deviceID) < 8 || len(deviceID) > 128 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(challenge)
	if err != nil || len(decoded) != 32 {
		return false
	}
	for _, value := range state {
		if !(value >= 'A' && value <= 'Z') && !(value >= 'a' && value <= 'z') && !(value >= '0' && value <= '9') && !strings.ContainsRune("-._~", value) {
			return false
		}
	}
	for _, value := range deviceID {
		if !(value >= 'A' && value <= 'Z') && !(value >= 'a' && value <= 'z') && !(value >= '0' && value <= '9') && !strings.ContainsRune("-._:", value) {
			return false
		}
	}
	callback, err := url.Parse(redirectURI)
	if err != nil || callback.Scheme != "http" || callback.Hostname() != "127.0.0.1" || callback.Port() == "" || callback.Path != "/callback" {
		return false
	}
	if callback.User != nil || callback.RawQuery != "" || callback.Fragment != "" {
		return false
	}
	return true
}

func (s *HTTPService) csrfMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/review/") || !unsafeMethod(r.Method) || !browserSessionRequest(r) {
			next.ServeHTTP(w, r)
			return
		}
		csrfCookie := cookieValue(r, webCSRFCookie)
		csrfHeaderValue := r.Header.Get(csrfHeader)
		if csrfCookie == "" || csrfHeaderValue == "" || subtle.ConstantTimeCompare([]byte(csrfCookie), []byte(csrfHeaderValue)) != 1 {
			writeError(w, http.StatusForbidden, "csrf_rejected")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func unsafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return false
	default:
		return true
	}
}

func browserSessionRequest(r *http.Request) bool {
	return bearerToken(r.Header.Get("Authorization")) == "" && (cookieValue(r, webAccessCookie) != "" || cookieValue(r, webRefreshCookie) != "")
}

func (s *HTTPService) setSessionCookies(w http.ResponseWriter, session *authv1.AuthReply) error {
	csrfToken, err := newCSRFToken()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	accessTTL := time.Duration(session.ExpiresIn) * time.Second
	if accessTTL <= 0 {
		accessTTL = 15 * time.Minute
	}
	refreshTTL := s.refreshTTL
	if refreshTTL <= 0 {
		refreshTTL = 720 * time.Hour
	}
	w.Header().Set("Cache-Control", "no-store")
	http.SetCookie(w, s.sessionCookie(webAccessCookie, session.AccessToken, "/v1", accessTTL, true, now))
	http.SetCookie(w, s.sessionCookie(webRefreshCookie, session.RefreshToken, "/v1/auth", refreshTTL, true, now))
	http.SetCookie(w, s.sessionCookie(webCSRFCookie, csrfToken, "/", refreshTTL, false, now))
	return nil
}

func (s *HTTPService) clearSessionCookies(w http.ResponseWriter) {
	expired := time.Unix(1, 0).UTC()
	w.Header().Set("Cache-Control", "no-store")
	for _, item := range []struct {
		name     string
		path     string
		httpOnly bool
	}{
		{name: webAccessCookie, path: "/v1", httpOnly: true},
		{name: webRefreshCookie, path: "/v1/auth", httpOnly: true},
		{name: webCSRFCookie, path: "/", httpOnly: false},
	} {
		http.SetCookie(w, &http.Cookie{Name: item.name, Value: "", Path: item.path, Domain: s.cookieDomain, MaxAge: -1, Expires: expired, HttpOnly: item.httpOnly, Secure: s.cookieSecure, SameSite: http.SameSiteLaxMode})
	}
}

func (s *HTTPService) sessionCookie(name string, value string, path string, ttl time.Duration, httpOnly bool, now time.Time) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: path, Domain: s.cookieDomain, MaxAge: int(ttl.Seconds()), Expires: now.Add(ttl),
		HttpOnly: httpOnly, Secure: s.cookieSecure, SameSite: http.SameSiteLaxMode,
	}
}

func newCSRFToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func (s *HTTPService) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		atomic.AddUint64(&s.requestsTotal, 1)
		rec := &traceResponseWriter{ResponseWriter: w, statusCode: http.StatusOK, traceID: platform.TraceID(r.Context())}
		next.ServeHTTP(rec, r)
		if rec.statusCode >= 400 {
			atomic.AddUint64(&s.errorsTotal, 1)
		}
		platform.ObserveHTTP(r.Method, r.URL.Path, rec.statusCode, time.Since(started))
	})
}

type traceResponseWriter struct {
	http.ResponseWriter
	statusCode int
	traceID    string
}

func (w *traceResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
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

func parseContractPositiveQuery(w http.ResponseWriter, r *http.Request, key string, fallback, maximum int) (int, bool) {
	value := fallback
	if raw := r.URL.Query().Get(key); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maximum {
			writeError(w, http.StatusBadRequest, "invalid_"+key)
			return 0, false
		}
		value = parsed
	}
	return value, true
}

func webSessionResponse(session *authv1.AuthReply) map[string]any {
	return map[string]any{
		"user": map[string]any{"id": session.UserId, "email": session.Email, "name": session.Name},
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
		"scheduled_plan_code": sub.ScheduledPlanCode, "scheduled_change_at": sub.ScheduledChangeAt,
		"lifecycle_error": sub.LifecycleError, "purchase_mode": sub.PurchaseMode,
		"entitlements":     entitlementsResponse(sub.Entitlements),
		"legacy_plan_code": sub.LegacyPlanCode, "renewal_plan_code": sub.RenewalPlanCode,
		"migration_effective_at": sub.MigrationEffectiveAt,
	}
}

func refundResponse(refund *billingv1.Refund) map[string]any {
	if refund == nil {
		refund = &billingv1.Refund{}
	}
	return map[string]any{
		"id": refund.Id, "subscription_id": refund.SubscriptionId, "status": refund.Status,
		"reason": refund.Reason, "used_tokens": refund.UsedTokens,
		"quota_hold_status": refund.QuotaHoldStatus, "failure_reason": refund.FailureReason,
		"created_at": refund.CreatedAt, "resolved_at": refund.ResolvedAt,
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
		"subscription_id": order.SubscriptionId, "expires_at": order.ExpiresAt,
		"purchase_mode": order.PurchaseMode, "entitlements_snapshot": entitlementsResponse(order.EntitlementsSnapshot),
	}
}

func entitlementsResponse(entitlements *billingv1.PlanEntitlements) map[string]any {
	if entitlements == nil {
		entitlements = &billingv1.PlanEntitlements{}
	}
	return map[string]any{
		"included_seats": entitlements.IncludedSeats, "byok_enabled": entitlements.ByokEnabled,
		"offline_review_enabled":  entitlements.OfflineReviewEnabled,
		"advanced_export_enabled": entitlements.AdvancedExportEnabled,
		"cloud_review_enabled":    entitlements.CloudReviewEnabled,
		"review_storage_bytes":    entitlements.ReviewStorageBytes,
		"review_retention_days":   entitlements.ReviewRetentionDays,
		"private_gateway_enabled": entitlements.PrivateGatewayEnabled,
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

func accountBootstrapResponse(bootstrap biz.AccountBootstrap) map[string]any {
	sections := make(map[string]any, len(bootstrap.Sections))
	for name, section := range bootstrap.Sections {
		item := map[string]any{
			"status":       section.Status,
			"last_updated": section.LastUpdated.UTC().Format(time.RFC3339),
			"trace_id":     section.TraceID,
			"error_code":   section.ErrorCode,
		}
		if section.Status == "ready" {
			switch value := section.Data.(type) {
			case *userv1.UserProfile:
				item["data"] = profileResponse(value)
			case *billingv1.Subscription:
				item["data"] = subscriptionResponse(value)
			case *quotav1.TokenBalance:
				item["data"] = tokenBalanceResponse(value)
			case *billingv1.ListOrdersReply:
				item["data"] = ordersResponse(value)
			case *quotav1.ListTokenUsageReply:
				item["data"] = tokenUsageResponse(value)
			case *quotav1.GetUsageTrendReply:
				item["data"] = usageTrendResponse(value)
			case []data.NotificationRow:
				item["data"] = notificationsResponse(value)
			default:
				item["status"] = "unavailable"
				item["error_code"] = "read_model_encoding_failed"
				item["trace_id"] = section.TraceID
			}
		}
		sections[name] = item
	}
	return map[string]any{
		"generated_at":      bootstrap.GeneratedAt.UTC().Format(time.RFC3339),
		"cache_ttl_seconds": 30,
		"usage_limit":       bootstrap.UsageLimit,
		"trend_days":        bootstrap.TrendDays,
		"sections":          sections,
	}
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

func decodeJSONLimit(w http.ResponseWriter, r *http.Request, destination any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
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

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		platform.StructuredLog(context.Background(), "web-bff-interface", "error", "write_json_failed", map[string]any{"error": err.Error()})
	}
}

func writeError(w http.ResponseWriter, statusCode int, code string) {
	writeJSON(w, statusCode, map[string]any{"error": platform.ContractErrorBody(w, code)})
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
		case codes.AlreadyExists, codes.FailedPrecondition, codes.Aborted:
			code = http.StatusConflict
		case codes.PermissionDenied:
			code = http.StatusForbidden
		case codes.Unavailable:
			code = http.StatusServiceUnavailable
			w.Header().Set("Retry-After", "2")
		case codes.DeadlineExceeded:
			code = http.StatusGatewayTimeout
			w.Header().Set("Retry-After", "1")
		}
		writeJSON(w, code, map[string]any{"error": platform.ContractErrorBody(w, st.Message())})
		return
	}
	writeJSON(w, code, map[string]any{"error": platform.ContractErrorBody(w, fallback)})
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
