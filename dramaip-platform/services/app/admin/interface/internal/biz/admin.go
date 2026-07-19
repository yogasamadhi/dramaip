package biz

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

const confirmationTTL = 5 * time.Minute

type AdminRepository interface {
	Checks() map[string]func(context.Context) error
	FindPrincipalByEmail(context.Context, string) (data.Principal, error)
	FindPrincipalByID(context.Context, string) (data.Principal, error)
	CreateSession(context.Context, data.SessionInput) error
	SessionActive(context.Context, string, string) (bool, error)
	CreateConfirmation(context.Context, data.ConfirmationInput) (data.Confirmation, error)
	GetOperationConfirmation(context.Context, string, string, string, string) (data.Confirmation, error)
	ConsumeOperationConfirmation(context.Context, string, string, string, string, string, string, string) error
	SuspendWithConfirmation(context.Context, string, string, string, string) (data.Principal, error)
	ConsumeReportingExceptionConfirmation(context.Context, string, string, string, string) (string, error)
	ListAuditLogs(context.Context, int) ([]data.AuditLog, error)
}

type Principal struct {
	ID, Email, Status  string
	Roles, Permissions []string
}
type Login struct {
	AccessToken string
	ExpiresIn   int64
	Principal   Principal
}
type Confirmation struct{ ID, Action, TargetID, ExpiresAt string }
type AdminUsecase struct {
	repo      AdminRepository
	signer    *signer
	accessTTL time.Duration
}

func NewAdminUsecase(repo AdminRepository, cfg *conf.Bootstrap) (*AdminUsecase, error) {
	signer, err := newSigner(cfg)
	if err != nil {
		return nil, err
	}
	return &AdminUsecase{repo: repo, signer: signer, accessTTL: kratosx.Duration(cfg.AdminJWT.AccessTokenTTL, 10*time.Minute)}, nil
}
func (u *AdminUsecase) Checks() map[string]func(context.Context) error { return u.repo.Checks() }
func (u *AdminUsecase) JWKS() []byte                                   { return u.signer.JWKS() }

func (u *AdminUsecase) Login(ctx context.Context, email, password string) (Login, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(password) < 8 {
		return Login{}, status.Error(codes.Unauthenticated, "invalid_admin_credentials")
	}
	principal, err := u.repo.FindPrincipalByEmail(ctx, email)
	if err != nil || principal.Status != "active" || bcrypt.CompareHashAndPassword([]byte(principal.PasswordHash), []byte(password)) != nil {
		return Login{}, status.Error(codes.Unauthenticated, "invalid_admin_credentials")
	}
	permissions := permissionsFor(principal.Roles)
	if len(permissions) == 0 {
		return Login{}, status.Error(codes.PermissionDenied, "admin_role_required")
	}
	tokenID := platform.NewUUID()
	now := time.Now().UTC()
	accessToken, err := u.signer.sign(principal.ID, principal.Email, principal.Roles, tokenID, now, u.accessTTL)
	if err != nil {
		return Login{}, err
	}
	if err := u.repo.CreateSession(ctx, data.SessionInput{ID: platform.NewUUID(), PrincipalID: principal.ID, TokenIDHash: tokenHash(tokenID), TraceID: traceOrRequestID(ctx), ExpiresAt: now.Add(u.accessTTL)}); err != nil {
		return Login{}, err
	}
	return Login{AccessToken: accessToken, ExpiresIn: int64(u.accessTTL.Seconds()), Principal: publicPrincipal(principal, permissions)}, nil
}

func (u *AdminUsecase) Authenticate(ctx context.Context, rawToken string) (Principal, error) {
	claims, err := u.signer.verify(rawToken)
	if err != nil || claims.Subject == "" || claims.ID == "" {
		return Principal{}, status.Error(codes.Unauthenticated, "invalid_admin_token")
	}
	active, err := u.repo.SessionActive(ctx, claims.Subject, tokenHash(claims.ID))
	if err != nil || !active {
		return Principal{}, status.Error(codes.Unauthenticated, "admin_session_expired")
	}
	principal, err := u.repo.FindPrincipalByID(ctx, claims.Subject)
	if err != nil || principal.Status != "active" {
		return Principal{}, status.Error(codes.Unauthenticated, "admin_session_expired")
	}
	permissions := permissionsFor(principal.Roles)
	if len(permissions) == 0 {
		return Principal{}, status.Error(codes.PermissionDenied, "admin_role_required")
	}
	return publicPrincipal(principal, permissions), nil
}

func (u *AdminUsecase) CreateConfirmation(ctx context.Context, actor Principal, action, targetID, reason string) (Confirmation, error) {
	action, targetID, reason = strings.TrimSpace(action), strings.TrimSpace(targetID), strings.TrimSpace(reason)
	allowed := actionPermission(action) != "" && actor.Allows(actionPermission(action))
	if !allowed {
		return Confirmation{}, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	if len(targetID) < 8 || len(targetID) > 64 || len(reason) < 4 || len(reason) > 300 {
		return Confirmation{}, status.Error(codes.InvalidArgument, "invalid_admin_confirmation")
	}
	confirmation, err := u.repo.CreateConfirmation(ctx, data.ConfirmationInput{ID: platform.NewUUID(), ActorID: actor.ID, Action: action, TargetID: targetID, Reason: reason, TraceID: traceOrRequestID(ctx), ExpiresAt: time.Now().UTC().Add(confirmationTTL)})
	if err != nil {
		return Confirmation{}, err
	}
	return Confirmation{ID: confirmation.ID, Action: confirmation.Action, TargetID: confirmation.TargetID, ExpiresAt: confirmation.ExpiresAt}, nil
}

// PrepareOperation reads but does not consume the second confirmation. The
// downstream domain action is idempotent using this confirmation ID; only
// after it succeeds do we consume the confirmation and append Admin evidence.
// That ordering makes a network retry safe instead of losing the one-time
// approval before the domain service can apply the action.
func (u *AdminUsecase) PrepareOperation(ctx context.Context, actor Principal, action, targetID, confirmationID string) (data.Confirmation, error) {
	if permission := actionPermission(action); permission == "" || !actor.Allows(permission) {
		return data.Confirmation{}, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	confirmation, err := u.repo.GetOperationConfirmation(ctx, actor.ID, strings.TrimSpace(action), strings.TrimSpace(targetID), strings.TrimSpace(confirmationID))
	if errors.Is(err, data.ErrConfirmationInvalid) {
		return data.Confirmation{}, status.Error(codes.FailedPrecondition, "admin_confirmation_invalid")
	}
	return confirmation, err
}

func (u *AdminUsecase) CompleteOperation(ctx context.Context, actor Principal, action, targetID, confirmationID, resourceType, afterState string) error {
	if permission := actionPermission(action); permission == "" || !actor.Allows(permission) {
		return status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	err := u.repo.ConsumeOperationConfirmation(ctx, actor.ID, strings.TrimSpace(action), strings.TrimSpace(targetID), strings.TrimSpace(confirmationID), strings.TrimSpace(resourceType), strings.TrimSpace(afterState), traceOrRequestID(ctx))
	if errors.Is(err, data.ErrConfirmationInvalid) {
		return status.Error(codes.FailedPrecondition, "admin_confirmation_invalid")
	}
	return err
}

// ConsumeReportingExceptionConfirmation records a durable audit request
// before the BFF calls reporting. If the downstream service is unavailable,
// the consumed confirmation and request audit explain why an operator must
// start a new confirmation instead of silently repeating a privileged action.
func (u *AdminUsecase) ConsumeReportingExceptionConfirmation(ctx context.Context, actor Principal, exceptionID, confirmationID string) (string, error) {
	if !actor.Allows("reporting.write") {
		return "", status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	reason, err := u.repo.ConsumeReportingExceptionConfirmation(ctx, actor.ID, strings.TrimSpace(exceptionID), strings.TrimSpace(confirmationID), traceOrRequestID(ctx))
	if errors.Is(err, data.ErrConfirmationInvalid) {
		return "", status.Error(codes.FailedPrecondition, "admin_confirmation_invalid")
	}
	if err != nil {
		return "", err
	}
	return reason, nil
}

func (u *AdminUsecase) SuspendPrincipal(ctx context.Context, actor Principal, targetID, confirmationID string) (Principal, error) {
	if !actor.Allows("principal.write") {
		return Principal{}, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	targetID, confirmationID = strings.TrimSpace(targetID), strings.TrimSpace(confirmationID)
	if len(targetID) < 8 || len(confirmationID) < 8 {
		return Principal{}, status.Error(codes.InvalidArgument, "invalid_admin_suspension")
	}
	principal, err := u.repo.SuspendWithConfirmation(ctx, actor.ID, targetID, confirmationID, traceOrRequestID(ctx))
	if errors.Is(err, data.ErrConfirmationInvalid) {
		return Principal{}, status.Error(codes.FailedPrecondition, "admin_confirmation_invalid")
	}
	if errors.Is(err, data.ErrPrincipalState) {
		return Principal{}, status.Error(codes.FailedPrecondition, "admin_principal_state_invalid")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Principal{}, status.Error(codes.NotFound, "admin_principal_not_found")
	}
	if err != nil {
		return Principal{}, err
	}
	return publicPrincipal(principal, permissionsFor(principal.Roles)), nil
}

func (u *AdminUsecase) ListAudit(ctx context.Context, actor Principal, limit int) ([]data.AuditLog, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return u.repo.ListAuditLogs(ctx, limit)
}
func (p Principal) Allows(permission string) bool {
	for _, value := range p.Permissions {
		if value == permission {
			return true
		}
	}
	return false
}
func publicPrincipal(value data.Principal, permissions []string) Principal {
	return Principal{ID: value.ID, Email: value.Email, Status: value.Status, Roles: append([]string(nil), value.Roles...), Permissions: permissions}
}
func permissionsFor(roles []string) []string {
	set := map[string]struct{}{}
	for _, role := range roles {
		switch role {
		case "viewer":
			set["audit.read"] = struct{}{}
		case "operator":
			set["audit.read"] = struct{}{}
			set["reporting.write"] = struct{}{}
			set["customer.write"] = struct{}{}
			set["notification.write"] = struct{}{}
		case "finance_admin":
			set["audit.read"] = struct{}{}
			set["billing.write"] = struct{}{}
			set["quota.write"] = struct{}{}
		case "security_admin":
			set["audit.read"] = struct{}{}
			set["principal.write"] = struct{}{}
			set["reporting.write"] = struct{}{}
			set["customer.write"] = struct{}{}
			set["billing.write"] = struct{}{}
			set["quota.write"] = struct{}{}
			set["notification.write"] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func actionPermission(action string) string {
	switch strings.TrimSpace(action) {
	case "principal.suspend":
		return "principal.write"
	case "reporting.exception.resolve":
		return "reporting.write"
	case "customer.status.set":
		return "customer.write"
	case "billing.refund.request", "billing.subscription.resume":
		return "billing.write"
	case "quota.adjust":
		return "quota.write"
	case "notification.send":
		return "notification.write"
	default:
		return ""
	}
}
func tokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func traceOrRequestID(ctx context.Context) string {
	if trace := platform.TraceID(ctx); trace != "" {
		return trace
	}
	if request := platform.RequestID(ctx); request != "" {
		return request
	}
	return "untraced"
}

// signer uses a key set entirely separate from C-end JWT signing. Production
// must mount an operator-owned private key; development intentionally creates
// an ephemeral key and never writes it to disk.
type signer struct {
	issuer, audience, kid string
	private               *rsa.PrivateKey
	public                map[string]*rsa.PublicKey
	jwks                  []byte
}
type adminClaims struct {
	Email string   `json:"email"`
	Roles []string `json:"roles"`
	jwt.RegisteredClaims
}
type jwk struct {
	KTY string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	KID string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func newSigner(cfg *conf.Bootstrap) (*signer, error) {
	if strings.TrimSpace(cfg.AdminJWT.Issuer) == "" || strings.TrimSpace(cfg.AdminJWT.Audience) == "" {
		return nil, fmt.Errorf("ADMIN_JWT_ISSUER and ADMIN_JWT_AUDIENCE are required")
	}
	production := strings.EqualFold(cfg.Environment, "prod") || strings.EqualFold(cfg.Environment, "production")
	if production && strings.TrimSpace(cfg.AdminJWT.PrivateKeyFile) == "" {
		return nil, fmt.Errorf("ADMIN_JWT_PRIVATE_KEY_FILE is required in production")
	}
	if production && strings.TrimSpace(cfg.AdminJWT.JWKSFile) == "" {
		return nil, fmt.Errorf("ADMIN_JWT_JWKS_FILE is required in production for independent key rotation")
	}
	private, generated, err := loadPrivateKey(cfg.AdminJWT.PrivateKeyFile)
	if err != nil {
		return nil, err
	}
	kid := strings.TrimSpace(cfg.AdminJWT.ActiveKeyID)
	if kid == "" && generated {
		kid = "admin-development-ephemeral"
	}
	if kid == "" {
		return nil, fmt.Errorf("ADMIN_JWT_ACTIVE_KID is required with a configured key")
	}
	public, err := loadJWKS(cfg.AdminJWT.JWKSFile)
	if err != nil {
		return nil, err
	}
	configured, activePublished := public[kid]
	if production && !activePublished {
		return nil, fmt.Errorf("active admin JWT key %q is missing from ADMIN_JWT_JWKS_FILE", kid)
	}
	if activePublished && (configured.E != private.PublicKey.E || configured.N.Cmp(private.PublicKey.N) != 0) {
		return nil, fmt.Errorf("active admin JWT key %q does not match ADMIN_JWT_JWKS_FILE", kid)
	}
	public[kid] = &private.PublicKey
	entries := make([]jwk, 0, len(public))
	for id, key := range public {
		entries = append(entries, publicJWK(id, key))
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].KID < entries[j].KID })
	raw, err := json.Marshal(map[string]any{"keys": entries})
	if err != nil {
		return nil, err
	}
	return &signer{issuer: cfg.AdminJWT.Issuer, audience: cfg.AdminJWT.Audience, kid: kid, private: private, public: public, jwks: raw}, nil
}
func (s *signer) sign(id, email string, roles []string, tokenID string, now time.Time, ttl time.Duration) (string, error) {
	claims := adminClaims{Email: email, Roles: append([]string(nil), roles...), RegisteredClaims: jwt.RegisteredClaims{Issuer: s.issuer, Subject: id, Audience: jwt.ClaimStrings{s.audience}, ID: tokenID, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl))}}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = s.kid
	return token.SignedString(s.private)
}
func (s *signer) verify(raw string) (adminClaims, error) {
	claims := adminClaims{}
	token, err := jwt.ParseWithClaims(raw, &claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != "RS256" {
			return nil, fmt.Errorf("unexpected signing algorithm")
		}
		kid, _ := token.Header["kid"].(string)
		key := s.public[kid]
		if kid == "" || key == nil {
			return nil, fmt.Errorf("untrusted admin key")
		}
		return key, nil
	}, jwt.WithIssuer(s.issuer), jwt.WithAudience(s.audience), jwt.WithValidMethods([]string{"RS256"}))
	if err != nil || !token.Valid {
		return adminClaims{}, fmt.Errorf("invalid admin token")
	}
	return claims, nil
}
func (s *signer) JWKS() []byte { return append([]byte(nil), s.jwks...) }
func loadPrivateKey(path string) (*rsa.PrivateKey, bool, error) {
	if strings.TrimSpace(path) == "" {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		return key, true, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, false, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, false, fmt.Errorf("decode admin JWT private key")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		if key.N.BitLen() < 2048 {
			return nil, false, fmt.Errorf("admin JWT RSA key is too weak")
		}
		return key, false, key.Validate()
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, false, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok || key.N.BitLen() < 2048 {
		return nil, false, fmt.Errorf("admin JWT private key must be RSA 2048+")
	}
	return key, false, key.Validate()
}
func loadJWKS(path string) (map[string]*rsa.PublicKey, error) {
	keys := map[string]*rsa.PublicKey{}
	if strings.TrimSpace(path) == "" {
		return keys, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var document struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, err
	}
	for _, entry := range document.Keys {
		if entry.KTY != "RSA" || entry.Alg != "RS256" || entry.KID == "" {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(entry.N)
		if err != nil {
			return nil, err
		}
		e, err := base64.RawURLEncoding.DecodeString(entry.E)
		if err != nil || len(e) == 0 || len(e) > 4 {
			return nil, fmt.Errorf("invalid admin JWKS exponent")
		}
		exponent := 0
		for _, v := range e {
			exponent = exponent<<8 | int(v)
		}
		key := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
		if key.N.BitLen() < 2048 || key.E < 3 {
			return nil, fmt.Errorf("admin JWKS key is too weak")
		}
		keys[entry.KID] = key
	}
	return keys, nil
}
func publicJWK(kid string, key *rsa.PublicKey) jwk {
	return jwk{KTY: "RSA", Use: "sig", Alg: "RS256", KID: kid, N: base64.RawURLEncoding.EncodeToString(key.N.Bytes()), E: base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}
}
