package service

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
	snapshotv1 "github.com/dramaip/dramaip-platform/services/api/snapshot/service/v1"
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
	mux.HandleFunc("/v1/desktop/ai/models", s.handleCloudModels)
	mux.HandleFunc("/v1/desktop/ai/preflight", s.handleCloudPreflight)
	mux.HandleFunc("/v1/desktop/ai/chat", s.handleCloudChat)
	mux.HandleFunc("/v1/desktop/mobile-handoff", s.handleMobileHandoff)
	mux.HandleFunc("/v1/desktop/mobile-handoff/adopt", s.handleAdoptMobileHandoff)
	mux.HandleFunc("/v1/desktop/project-snapshots", s.handleProjectSnapshots)
	mux.HandleFunc("/v1/desktop/project-snapshots/download", s.handleDownloadProjectSnapshot)
	mux.HandleFunc("/v1/desktop/project-snapshot-uploads", s.handleProjectSnapshotUploads)
	mux.HandleFunc("/v1/desktop/project-snapshot-uploads/chunks", s.handleProjectSnapshotUploadChunks)
	mux.HandleFunc("/v1/desktop/project-snapshot-uploads/complete", s.handleCompleteProjectSnapshotUpload)
	return platform.TraceMiddleware("desktop-bff-interface", s.metricsMiddleware(platform.ClientContractMiddleware(mux)))
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

func (s *HTTPService) handleCloudModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	reply, err := s.uc.ListCloudModels(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		s.writeGRPCError(w, err, "desktop_model_list_unavailable")
		return
	}
	models := make([]map[string]any, 0, len(reply.Models))
	for _, model := range reply.Models {
		if model == nil {
			continue
		}
		models = append(models, map[string]any{"provider": model.Provider, "model": model.Model, "is_default": model.IsDefault})
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *HTTPService) handleCloudPreflight(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Provider          string `json:"provider"`
		Model             string `json:"model"`
		ContextCharacters int64  `json:"context_characters"`
		MessageCount      int64  `json:"message_count"`
		MaxTokens         int64  `json:"max_tokens"`
		RequestHash       string `json:"request_hash"`
	}
	if !decodeJSONLimit(w, r, &req, 8<<10) {
		return
	}
	preflight, balance, err := s.uc.PreflightCloudAI(r.Context(), r.Header.Get("Authorization"), req.Provider, req.Model, req.ContextCharacters, req.MessageCount, req.MaxTokens, req.RequestHash)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_ai_preflight_unavailable")
		return
	}
	if preflight.Model == nil {
		writeError(w, http.StatusServiceUnavailable, "desktop_ai_preflight_invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"model":            map[string]any{"provider": preflight.Model.Provider, "model": preflight.Model.Model, "is_default": preflight.Model.IsDefault},
		"estimated_tokens": preflight.EstimatedTokens,
		"remaining_tokens": balance.RemainingTokens,
		"request_hash":     preflight.RequestHash,
	})
}

func (s *HTTPService) handleCloudChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		RequestID      string `json:"request_id"`
		IdempotencyKey string `json:"idempotency_key"`
		Provider       string `json:"provider"`
		Model          string `json:"model"`
		Messages       []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		MaxTokens            int64  `json:"max_tokens"`
		PreflightRequestHash string `json:"preflight_request_hash"`
	}
	if !decodeJSONLimit(w, r, &req, 32<<10) {
		return
	}
	if !validCloudRequestID(req.RequestID) || !validCloudRequestID(req.IdempotencyKey) || !validCloudRequestHash(req.PreflightRequestHash) {
		writeError(w, http.StatusBadRequest, "invalid_idempotency_key")
		return
	}
	messages, contextCharacters, ok := validateCloudMessages(req.Messages, req.MaxTokens)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_cloud_context")
		return
	}
	// Recheck the bounded summary in the gateway before any quota reservation or
	// Provider request. The raw creative context is never logged at this layer.
	preflight, _, err := s.uc.PreflightCloudAI(r.Context(), r.Header.Get("Authorization"), req.Provider, req.Model, contextCharacters, int64(len(messages)), req.MaxTokens, req.PreflightRequestHash)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_ai_preflight_unavailable")
		return
	}
	if preflight.RequestHash != req.PreflightRequestHash {
		writeError(w, http.StatusConflict, "cloud_preflight_request_mismatch")
		return
	}
	reply, err := s.uc.ChatCloudAI(r.Context(), r.Header.Get("Authorization"), req.RequestID, req.IdempotencyKey, clientIP(r), req.Provider, req.Model, messages, req.MaxTokens, req.PreflightRequestHash)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_ai_chat_unavailable")
		return
	}
	w.Header().Set("Idempotency-Key", req.IdempotencyKey)
	writeJSON(w, http.StatusOK, chatResponse(reply))
}

func (s *HTTPService) handleMobileHandoff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	limit := int32(50)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = int32(parsed)
	}
	drafts, err := s.uc.ListMobileHandoff(r.Context(), r.Header.Get("Authorization"), limit)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_mobile_handoff_unavailable")
		return
	}
	items := make([]map[string]any, 0, len(drafts))
	for _, draft := range drafts {
		items = append(items, mobileDraftJSON(draft))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"drafts": items})
}

func (s *HTTPService) handleAdoptMobileHandoff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		DraftID        string `json:"draft_id"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if !decodeJSONLimit(w, r, &req, 4<<10) {
		return
	}
	draft, err := s.uc.AdoptMobileHandoff(r.Context(), r.Header.Get("Authorization"), req.DraftID, req.IdempotencyKey)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_mobile_handoff_adoption_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Idempotency-Key", req.IdempotencyKey)
	writeJSON(w, http.StatusOK, map[string]any{"draft": mobileDraftJSON(draft)})
}

// handleProjectSnapshots accepts and returns only the already encrypted JSON
// envelope. The BFF intentionally has no project-package parser or recovery
// key access, so it cannot inspect a creator's plaintext.
func (s *HTTPService) handleProjectSnapshots(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			IdempotencyKey    string `json:"idempotency_key"`
			EncryptedEnvelope []byte `json:"encrypted_envelope"`
		}
		// A base64 JSON representation of the maximum 8 MiB ciphertext fits
		// under this bounded request body with transport overhead.
		if !decodeJSONLimit(w, r, &req, 12<<20) {
			return
		}
		snapshot, err := s.uc.CreateProjectSnapshot(r.Context(), r.Header.Get("Authorization"), req.IdempotencyKey, req.EncryptedEnvelope)
		if err != nil {
			s.writeGRPCError(w, err, "desktop_project_snapshot_create_unavailable")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Idempotency-Key", req.IdempotencyKey)
		writeJSON(w, http.StatusCreated, map[string]any{"snapshot": projectSnapshotJSON(snapshot)})
	case http.MethodGet:
		snapshots, err := s.uc.ListProjectSnapshots(r.Context(), r.Header.Get("Authorization"))
		if err != nil {
			s.writeGRPCError(w, err, "desktop_project_snapshot_list_unavailable")
			return
		}
		items := make([]map[string]any, 0, len(snapshots))
		for _, snapshot := range snapshots {
			if snapshot != nil {
				items = append(items, projectSnapshotJSON(snapshot))
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"snapshots": items})
	case http.MethodDelete:
		snapshotID := strings.TrimSpace(r.URL.Query().Get("id"))
		if snapshotID == "" {
			writeError(w, http.StatusBadRequest, "snapshot_id_required")
			return
		}
		reply, err := s.uc.DeleteProjectSnapshot(r.Context(), r.Header.Get("Authorization"), snapshotID)
		if err != nil {
			s.writeGRPCError(w, err, "desktop_project_snapshot_delete_unavailable")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]string{"snapshot_id": reply.SnapshotId, "deleted_at": reply.DeletedAt})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *HTTPService) handleDownloadProjectSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	snapshotID := strings.TrimSpace(r.URL.Query().Get("id"))
	if snapshotID == "" {
		writeError(w, http.StatusBadRequest, "snapshot_id_required")
		return
	}
	reply, err := s.uc.GetProjectSnapshot(r.Context(), r.Header.Get("Authorization"), snapshotID)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_project_snapshot_download_unavailable")
		return
	}
	if reply.Snapshot == nil || len(reply.EncryptedEnvelope) == 0 {
		writeError(w, http.StatusServiceUnavailable, "desktop_project_snapshot_reply_invalid")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"snapshot": projectSnapshotJSON(reply.Snapshot), "encrypted_envelope": reply.EncryptedEnvelope})
}

func (s *HTTPService) handleProjectSnapshotUploads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		IdempotencyKey  string `json:"idempotency_key"`
		EncryptedBytes  int64  `json:"encrypted_bytes"`
		EncryptedSHA256 string `json:"encrypted_sha256"`
	}
	if !decodeJSONLimit(w, r, &req, 4<<10) {
		return
	}
	reply, err := s.uc.StartProjectSnapshotUpload(r.Context(), r.Header.Get("Authorization"), req.IdempotencyKey, req.EncryptedBytes, req.EncryptedSHA256)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_project_snapshot_upload_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Idempotency-Key", req.IdempotencyKey)
	if reply.Snapshot != nil {
		writeJSON(w, http.StatusOK, map[string]any{"snapshot": projectSnapshotJSON(reply.Snapshot)})
		return
	}
	if reply.Upload == nil {
		writeError(w, http.StatusServiceUnavailable, "desktop_project_snapshot_upload_reply_invalid")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"upload": projectSnapshotUploadJSON(reply.Upload)})
}

func (s *HTTPService) handleProjectSnapshotUploadChunks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		UploadID             string `json:"upload_id"`
		ChunkIndex           int32  `json:"chunk_index"`
		EncryptedChunk       []byte `json:"encrypted_chunk"`
		EncryptedChunkSHA256 string `json:"encrypted_chunk_sha256"`
	}
	if !decodeJSONLimit(w, r, &req, 2<<20) {
		return
	}
	reply, err := s.uc.UploadProjectSnapshotChunk(r.Context(), r.Header.Get("Authorization"), req.UploadID, req.ChunkIndex, req.EncryptedChunkSHA256, req.EncryptedChunk)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_project_snapshot_chunk_unavailable")
		return
	}
	if reply.Upload == nil {
		writeError(w, http.StatusServiceUnavailable, "desktop_project_snapshot_chunk_reply_invalid")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"upload": projectSnapshotUploadJSON(reply.Upload)})
}

func (s *HTTPService) handleCompleteProjectSnapshotUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		UploadID string `json:"upload_id"`
	}
	if !decodeJSONLimit(w, r, &req, 4<<10) {
		return
	}
	reply, err := s.uc.CompleteProjectSnapshotUpload(r.Context(), r.Header.Get("Authorization"), req.UploadID)
	if err != nil {
		s.writeGRPCError(w, err, "desktop_project_snapshot_complete_unavailable")
		return
	}
	if reply.Snapshot == nil {
		writeError(w, http.StatusServiceUnavailable, "desktop_project_snapshot_complete_reply_invalid")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"snapshot": projectSnapshotJSON(reply.Snapshot)})
}

func projectSnapshotJSON(snapshot *snapshotv1.ProjectSnapshot) map[string]any {
	return map[string]any{
		"id": snapshot.Id, "encrypted_bytes": snapshot.EncryptedBytes, "encrypted_sha256": snapshot.EncryptedSha256,
		"created_at": snapshot.CreatedAt, "expires_at": snapshot.ExpiresAt,
	}
}

func projectSnapshotUploadJSON(upload *snapshotv1.ProjectSnapshotUpload) map[string]any {
	return map[string]any{
		"id": upload.Id, "encrypted_bytes": upload.EncryptedBytes, "encrypted_sha256": upload.EncryptedSha256,
		"received_chunk_indexes": upload.ReceivedChunkIndexes, "created_at": upload.CreatedAt, "expires_at": upload.ExpiresAt,
	}
}

func mobileDraftJSON(draft *inspirationv1.MobileDraft) map[string]any {
	if draft == nil {
		return map[string]any{}
	}
	return map[string]any{
		"id": draft.Id, "client_id": draft.ClientId, "kind": draft.Kind, "capture_mode": draft.CaptureMode, "title": draft.Title,
		"content": draft.Content, "ai_expansion": draft.AiExpansion, "created_at": draft.CreatedAt, "updated_at": draft.UpdatedAt,
		"adoption_count": draft.AdoptionCount, "last_adopted_at": draft.LastAdoptedAt,
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	return decodeJSONLimit(w, r, destination, 16<<10)
}

func decodeJSONLimit(w http.ResponseWriter, r *http.Request, destination any, maximumBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maximumBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

func validCloudRequestID(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func validCloudRequestHash(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 43 {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func validateCloudMessages(input []struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}, maxTokens int64) ([]*aiv1.ChatMessage, int64, bool) {
	if len(input) == 0 || len(input) > 8 || maxTokens < 1 || maxTokens > 8_192 {
		return nil, 0, false
	}
	contextCharacters := int64(0)
	messages := make([]*aiv1.ChatMessage, 0, len(input))
	for _, message := range input {
		role := strings.TrimSpace(message.Role)
		if role != "system" && role != "user" && role != "assistant" {
			return nil, 0, false
		}
		if strings.TrimSpace(message.Content) == "" {
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
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, status.Convert(err).Message())
	case codes.Aborted, codes.AlreadyExists:
		writeError(w, http.StatusConflict, status.Convert(err).Message())
	case codes.FailedPrecondition:
		writeError(w, http.StatusPreconditionFailed, status.Convert(err).Message())
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

func bearerToken(value string) string {
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}

// clientIP uses the right-most valid X-Forwarded-For entry appended by Kong.
// Desktop BFF is internal-only in deployment, so it is a cost guardrail key,
// never an authorization claim.
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
