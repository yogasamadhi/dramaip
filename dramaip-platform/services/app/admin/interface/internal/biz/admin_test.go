package biz

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAdminAuthenticationRejectsCustomerTokenAndUsesDynamicRBAC(t *testing.T) {
	repo := newFakeRepo(t)
	uc := newTestUsecase(t, repo)
	login, err := uc.Login(context.Background(), "security@example.com", "correct-password")
	if err != nil || !login.Principal.Allows("principal.write") {
		t.Fatalf("login = %#v, %v", login, err)
	}
	customerKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	customerToken := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.RegisteredClaims{Issuer: "dramaip", Subject: "customer-1", Audience: jwt.ClaimStrings{"dramaip-api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))})
	customerToken.Header["kid"] = "customer-key"
	rawCustomerToken, err := customerToken.SignedString(customerKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := uc.Authenticate(context.Background(), rawCustomerToken); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("customer token = %v", err)
	}
	repo.principals["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] = data.Principal{ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Email: "security@example.com", PasswordHash: repo.principals["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"].PasswordHash, Status: "active", Roles: []string{"viewer"}}
	actor, err := uc.Authenticate(context.Background(), login.AccessToken)
	if err != nil || actor.Allows("principal.write") {
		t.Fatalf("dynamic role refresh = %#v, %v", actor, err)
	}
	repo.sessionsActive = false
	if _, err := uc.Authenticate(context.Background(), login.AccessToken); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("revoked admin session = %v", err)
	}
}

func TestAdminProductionRequiresItsOwnKeySet(t *testing.T) {
	if _, err := NewAdminUsecase(newFakeRepo(t), &conf.Bootstrap{Environment: "production", AdminJWT: conf.JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"}}); err == nil {
		t.Fatal("production accepted an ephemeral admin signing key")
	}
}

func TestAdminConfirmationAndSuspensionCreateCompleteAuditEvidence(t *testing.T) {
	repo := newFakeRepo(t)
	uc := newTestUsecase(t, repo)
	login, err := uc.Login(context.Background(), "security@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	confirmation, err := uc.CreateConfirmation(context.Background(), login.Principal, "principal.suspend", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "offboarding approved")
	if err != nil {
		t.Fatal(err)
	}
	suspended, err := uc.SuspendPrincipal(context.Background(), login.Principal, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", confirmation.ID)
	if err != nil || suspended.Status != "suspended" {
		t.Fatalf("suspend = %#v, %v", suspended, err)
	}
	entries, err := uc.ListAudit(context.Background(), login.Principal, 50)
	if err != nil || len(entries) != 4 {
		t.Fatalf("audit = %#v, %v", entries, err)
	}
	for _, entry := range entries {
		if entry.Action == "admin.principal.suspended" && string(entry.BeforeState) == `{"status":"active"}` && string(entry.AfterState) == `{"status":"suspended"}` && entry.Reason == "offboarding approved" {
			return
		}
	}
	t.Fatalf("suspension audit missing: %#v", entries)
}

func TestAdminViewerCannotStartSensitiveConfirmation(t *testing.T) {
	repo := newFakeRepo(t)
	uc := newTestUsecase(t, repo)
	login, err := uc.Login(context.Background(), "viewer@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := uc.CreateConfirmation(context.Background(), login.Principal, "principal.suspend", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "attempt"); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("viewer confirmation = %v", err)
	}
}

func newTestUsecase(t *testing.T, repo *fakeRepo) *AdminUsecase {
	t.Helper()
	uc, err := NewAdminUsecase(repo, &conf.Bootstrap{Environment: "test", AdminJWT: conf.JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"}})
	if err != nil {
		t.Fatal(err)
	}
	return uc
}

type fakeRepo struct {
	principals     map[string]data.Principal
	sessionsActive bool
	confirmations  map[string]data.ConfirmationInput
	audits         []data.AuditLog
}

func newFakeRepo(t *testing.T) *fakeRepo {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return &fakeRepo{sessionsActive: true, confirmations: map[string]data.ConfirmationInput{}, principals: map[string]data.Principal{
		"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Email: "security@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"security_admin"}},
		"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": {ID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Email: "target@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"viewer"}},
		"cccccccc-cccc-cccc-cccc-cccccccccccc": {ID: "cccccccc-cccc-cccc-cccc-cccccccccccc", Email: "viewer@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"viewer"}},
	}}
}
func (r *fakeRepo) Checks() map[string]func(context.Context) error { return nil }
func (r *fakeRepo) FindPrincipalByEmail(_ context.Context, email string) (data.Principal, error) {
	for _, value := range r.principals {
		if value.Email == email {
			return value, nil
		}
	}
	return data.Principal{}, errors.New("missing")
}
func (r *fakeRepo) FindPrincipalByID(_ context.Context, id string) (data.Principal, error) {
	value, ok := r.principals[id]
	if !ok {
		return data.Principal{}, errors.New("missing")
	}
	return value, nil
}
func (r *fakeRepo) CreateSession(_ context.Context, input data.SessionInput) error {
	before, _ := json.Marshal(map[string]string{"status": "none"})
	after, _ := json.Marshal(map[string]string{"status": "active"})
	r.audits = append(r.audits, data.AuditLog{ID: "audit-session", ActorID: input.PrincipalID, Action: "admin.session.created", ResourceType: "session", ResourceID: input.ID, Reason: "admin_login", BeforeState: before, AfterState: after})
	return nil
}
func (r *fakeRepo) SessionActive(context.Context, string, string) (bool, error) {
	return r.sessionsActive, nil
}
func (r *fakeRepo) CreateConfirmation(_ context.Context, input data.ConfirmationInput) (data.Confirmation, error) {
	r.confirmations[input.ID] = input
	before, _ := json.Marshal(map[string]string{"status": "none"})
	after, _ := json.Marshal(map[string]string{"status": "pending"})
	r.audits = append(r.audits, data.AuditLog{ID: "audit-1", ActorID: input.ActorID, Action: "admin.confirmation.created", ResourceType: "confirmation", ResourceID: input.ID, Reason: input.Reason, BeforeState: before, AfterState: after})
	return data.Confirmation{ID: input.ID, Action: input.Action, TargetID: input.TargetID, Reason: input.Reason, ExpiresAt: input.ExpiresAt.Format(time.RFC3339)}, nil
}
func (r *fakeRepo) SuspendWithConfirmation(_ context.Context, actorID, targetID, confirmationID, _ string) (data.Principal, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actorID || input.TargetID != targetID || input.ExpiresAt.Before(time.Now()) {
		return data.Principal{}, data.ErrConfirmationInvalid
	}
	target := r.principals[targetID]
	if target.Status != "active" {
		return data.Principal{}, data.ErrPrincipalState
	}
	beforeConfirmation, _ := json.Marshal(map[string]string{"status": "pending"})
	afterConfirmation, _ := json.Marshal(map[string]string{"status": "consumed"})
	before, _ := json.Marshal(map[string]string{"status": "active"})
	after, _ := json.Marshal(map[string]string{"status": "suspended"})
	r.audits = append(r.audits, data.AuditLog{ID: "audit-2", ActorID: actorID, Action: "admin.confirmation.consumed", Reason: input.Reason, BeforeState: beforeConfirmation, AfterState: afterConfirmation}, data.AuditLog{ID: "audit-3", ActorID: actorID, Action: "admin.principal.suspended", Reason: input.Reason, BeforeState: before, AfterState: after})
	target.Status = "suspended"
	r.principals[targetID] = target
	return target, nil
}
func (r *fakeRepo) ConsumeReportingExceptionConfirmation(_ context.Context, actorID, targetID, confirmationID, _ string) (string, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actorID || input.TargetID != targetID || input.Action != "reporting.exception.resolve" || input.ExpiresAt.Before(time.Now()) {
		return "", data.ErrConfirmationInvalid
	}
	return input.Reason, nil
}
func (r *fakeRepo) ListAuditLogs(context.Context, int) ([]data.AuditLog, error) {
	return append([]data.AuditLog(nil), r.audits...), nil
}
