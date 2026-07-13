package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"golang.org/x/crypto/bcrypt"
)

func TestAdminHTTPRejectsCustomerTokenAndEnforcesConfirmation(t *testing.T) {
	router := newTestHTTPService(t).Router()
	customer := httptest.NewRequest(http.MethodGet, "/v1/admin/me", nil)
	customer.Header.Set("Authorization", "Bearer customer-access-token")
	customerRecorder := httptest.NewRecorder()
	router.ServeHTTP(customerRecorder, customer)
	if customerRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("customer token status = %d: %s", customerRecorder.Code, customerRecorder.Body.String())
	}
	login := httptest.NewRequest(http.MethodPost, "/v1/admin/auth/login", bytes.NewBufferString(`{"email":"security@example.com","password":"correct-password"}`))
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, login)
	if loginRecorder.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", loginRecorder.Code, loginRecorder.Body.String())
	}
	var session struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.Unmarshal(loginRecorder.Body.Bytes(), &session)
	confirmation := httptest.NewRequest(http.MethodPost, "/v1/admin/confirmations", bytes.NewBufferString(`{"action":"principal.suspend","target_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","reason":"approved offboarding"}`))
	confirmation.Header.Set("Authorization", "Bearer "+session.AccessToken)
	confirmationRecorder := httptest.NewRecorder()
	router.ServeHTTP(confirmationRecorder, confirmation)
	if confirmationRecorder.Code != http.StatusCreated {
		t.Fatalf("confirmation = %d: %s", confirmationRecorder.Code, confirmationRecorder.Body.String())
	}
	var reply struct {
		Confirmation struct {
			ID string `json:"id"`
		} `json:"confirmation"`
	}
	_ = json.Unmarshal(confirmationRecorder.Body.Bytes(), &reply)
	suspend := httptest.NewRequest(http.MethodPost, "/v1/admin/principals/suspend", bytes.NewBufferString(`{"target_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","confirmation_id":"`+reply.Confirmation.ID+`"}`))
	suspend.Header.Set("Authorization", "Bearer "+session.AccessToken)
	suspendRecorder := httptest.NewRecorder()
	router.ServeHTTP(suspendRecorder, suspend)
	if suspendRecorder.Code != http.StatusOK || !bytes.Contains(suspendRecorder.Body.Bytes(), []byte(`"status":"suspended"`)) {
		t.Fatalf("suspend = %d: %s", suspendRecorder.Code, suspendRecorder.Body.String())
	}
	audit := httptest.NewRequest(http.MethodGet, "/v1/admin/audit", nil)
	audit.Header.Set("Authorization", "Bearer "+session.AccessToken)
	auditRecorder := httptest.NewRecorder()
	router.ServeHTTP(auditRecorder, audit)
	if auditRecorder.Code != http.StatusOK || !bytes.Contains(auditRecorder.Body.Bytes(), []byte(`"action":"admin.principal.suspended"`)) {
		t.Fatalf("audit = %d: %s", auditRecorder.Code, auditRecorder.Body.String())
	}
}

func newTestHTTPService(t *testing.T) *HTTPService {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	repo := &httpFakeRepo{principals: map[string]data.Principal{"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Email: "security@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"security_admin"}}, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": {ID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Email: "target@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"viewer"}}}, confirmations: map[string]data.ConfirmationInput{}}
	uc, err := biz.NewAdminUsecase(repo, &conf.Bootstrap{Environment: "test", AdminJWT: conf.JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"}})
	if err != nil {
		t.Fatal(err)
	}
	return NewHTTPService(uc)
}

type httpFakeRepo struct {
	principals    map[string]data.Principal
	confirmations map[string]data.ConfirmationInput
	audits        []data.AuditLog
}

func (r *httpFakeRepo) Checks() map[string]func(context.Context) error { return nil }
func (r *httpFakeRepo) FindPrincipalByEmail(_ context.Context, email string) (data.Principal, error) {
	for _, p := range r.principals {
		if p.Email == email {
			return p, nil
		}
	}
	return data.Principal{}, errors.New("missing")
}
func (r *httpFakeRepo) FindPrincipalByID(_ context.Context, id string) (data.Principal, error) {
	p, ok := r.principals[id]
	if !ok {
		return data.Principal{}, errors.New("missing")
	}
	return p, nil
}
func (r *httpFakeRepo) CreateSession(context.Context, data.SessionInput) error      { return nil }
func (r *httpFakeRepo) SessionActive(context.Context, string, string) (bool, error) { return true, nil }
func (r *httpFakeRepo) CreateConfirmation(_ context.Context, input data.ConfirmationInput) (data.Confirmation, error) {
	r.confirmations[input.ID] = input
	r.audits = append(r.audits, data.AuditLog{Action: "admin.confirmation.created"})
	return data.Confirmation{ID: input.ID, Action: input.Action, TargetID: input.TargetID, ExpiresAt: input.ExpiresAt.Format(time.RFC3339)}, nil
}
func (r *httpFakeRepo) SuspendWithConfirmation(_ context.Context, actor, targetID, confirmationID, _ string) (data.Principal, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actor || input.TargetID != targetID {
		return data.Principal{}, data.ErrConfirmationInvalid
	}
	target := r.principals[targetID]
	target.Status = "suspended"
	r.principals[targetID] = target
	r.audits = append(r.audits, data.AuditLog{Action: "admin.confirmation.consumed"}, data.AuditLog{Action: "admin.principal.suspended"})
	return target, nil
}
func (r *httpFakeRepo) ListAuditLogs(context.Context, int) ([]data.AuditLog, error) {
	return r.audits, nil
}
