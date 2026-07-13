package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type AuthUsecase struct {
	repo        *data.AuthRepo
	issuer      string
	audience    string
	keys        *signingKeySet
	accessTTL   time.Duration
	refreshTTL  time.Duration
	emailSender *emailActionSender
}

type Session struct {
	AccessToken   string
	RefreshToken  string
	TokenType     string
	ExpiresIn     int64
	UserID        string
	Email         string
	Name          string
	EmailVerified bool
}

type AuthIdentity struct {
	UserID        string
	Email         string
	EmailVerified bool
}

func NewAuthUsecase(repo *data.AuthRepo, cfg *conf.Bootstrap) (*AuthUsecase, error) {
	keys, err := loadSigningKeySet(cfg)
	if err != nil {
		return nil, err
	}
	return &AuthUsecase{
		repo:        repo,
		issuer:      cfg.JWT.Issuer,
		audience:    cfg.JWT.Audience,
		keys:        keys,
		accessTTL:   kratosx.Duration(cfg.JWT.AccessTokenTTL, 15*time.Minute),
		refreshTTL:  kratosx.Duration(cfg.JWT.RefreshTokenTTL, 720*time.Hour),
		emailSender: newEmailActionSender(cfg.Email, cfg.Environment),
	}, nil
}

func (u *AuthUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *AuthUsecase) Register(ctx context.Context, email string, password string, displayName string, deviceID string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(password) < 8 {
		return Session{}, status.Error(codes.InvalidArgument, "invalid registration")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, err
	}
	user, err := u.repo.InsertUser(ctx, platform.NewUUID(), email, string(hash))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return Session{}, status.Error(codes.AlreadyExists, "email already registered")
		}
		return Session{}, err
	}
	if displayName != "" {
		user.Name = displayName
	}
	return u.issueSession(ctx, user, deviceID)
}

func (u *AuthUsecase) Login(ctx context.Context, email string, password string, deviceID string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(password) < 8 {
		return Session{}, status.Error(codes.InvalidArgument, "invalid credentials")
	}
	if count, err := u.repo.IncrementLoginFailure(ctx, email, int64((15 * time.Minute).Seconds())); err == nil && count > 10 {
		return Session{}, status.Error(codes.ResourceExhausted, "too many login attempts")
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		return Session{}, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return Session{}, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	_ = u.repo.ClearLoginFailures(ctx, email)
	return u.issueSession(ctx, user, deviceID)
}

func (u *AuthUsecase) Refresh(ctx context.Context, refreshToken string) (Session, error) {
	hash := tokenHash(refreshToken)
	nextRefreshToken := randomToken()
	now := time.Now().UTC()
	user, err := u.repo.RotateRefreshToken(ctx, hash, data.RefreshTokenInput{
		ID:        platform.NewUUID(),
		TokenHash: tokenHash(nextRefreshToken),
		ExpiresAt: now.Add(u.refreshTTL),
	})
	if err != nil {
		return Session{}, status.Error(codes.Unauthenticated, "invalid refresh token")
	}
	accessToken, err := u.keys.sign(user.ID, user.Email, u.issuer, u.audience, now, u.accessTTL)
	if err != nil {
		return Session{}, err
	}
	if err := u.repo.SetSession(ctx, accessToken, strconv.FormatInt(int64(u.accessTTL.Seconds()), 10), user.ID); err != nil {
		return Session{}, err
	}
	return Session{
		AccessToken: accessToken, RefreshToken: nextRefreshToken, TokenType: "Bearer",
		ExpiresIn: int64(u.accessTTL.Seconds()), UserID: user.ID, Email: user.Email, Name: user.Name,
		EmailVerified: user.EmailVerified,
	}, nil
}

func (u *AuthUsecase) Logout(ctx context.Context, refreshToken string, accessToken string, deviceID string) error {
	if deviceID != "" && accessToken != "" {
		identity, err := u.ValidateAccessToken(ctx, accessToken)
		if err != nil {
			return err
		}
		if err := u.repo.RevokeRefreshTokensByDevice(ctx, identity.UserID, deviceID); err != nil {
			return err
		}
	}
	if refreshToken == "" {
		return u.repo.DeleteSession(ctx, accessToken)
	}
	if err := u.repo.RevokeRefreshToken(ctx, tokenHash(refreshToken)); err != nil {
		return err
	}
	return u.repo.DeleteSession(ctx, accessToken)
}

func (u *AuthUsecase) ValidateAccessToken(ctx context.Context, accessToken string) (AuthIdentity, error) {
	claims, err := u.keys.verify(accessToken, u.issuer, u.audience)
	if err != nil {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	userID := claims.Subject
	if userID == "" {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	cached, err := u.repo.GetSession(ctx, accessToken)
	if err != nil || cached != userID {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "session expired")
	}
	if claims.IssuedAt == nil {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	valid, emailVerified, err := u.repo.AccessSessionState(ctx, userID, claims.IssuedAt.Time)
	if err != nil || !valid {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "session expired")
	}
	return AuthIdentity{UserID: userID, Email: claims.Email, EmailVerified: emailVerified}, nil
}

func (u *AuthUsecase) RequestEmailVerification(ctx context.Context, userID string) error {
	user, err := u.repo.FindUserByID(ctx, userID)
	if err != nil {
		return status.Error(codes.NotFound, "account not found")
	}
	return u.sendEmailAction(ctx, user, "verify_email")
}

// RequestPasswordReset intentionally returns success for an unknown account
// and for a delivery failure so callers cannot use it to enumerate accounts.
func (u *AuthUsecase) RequestPasswordReset(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return status.Error(codes.InvalidArgument, "invalid email")
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		return nil
	}
	_ = u.sendEmailAction(ctx, user, "reset_password")
	return nil
}

func (u *AuthUsecase) VerifyEmail(ctx context.Context, userID string, code string) error {
	if strings.TrimSpace(userID) == "" || !validEmailActionCode(code) {
		return status.Error(codes.InvalidArgument, "invalid verification code")
	}
	if err := u.repo.VerifyEmailAction(ctx, userID, tokenHash(code)); err != nil {
		if errors.Is(err, data.ErrEmailActionNotFound) {
			return status.Error(codes.InvalidArgument, "invalid or expired verification code")
		}
		return err
	}
	return nil
}

func (u *AuthUsecase) ResetPassword(ctx context.Context, email string, code string, password string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(password) < 8 || !validEmailActionCode(code) {
		return status.Error(codes.InvalidArgument, "invalid password reset")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := u.repo.ResetPasswordWithAction(ctx, email, tokenHash(code), string(hash)); err != nil {
		if errors.Is(err, data.ErrEmailActionNotFound) {
			return status.Error(codes.InvalidArgument, "invalid or expired password reset code")
		}
		return err
	}
	return nil
}

func (u *AuthUsecase) sendEmailAction(ctx context.Context, user data.UserRow, purpose string) error {
	count, err := u.repo.IncrementEmailAction(ctx, user.Email, purpose, int64((15 * time.Minute).Seconds()))
	if err == nil && count > 5 {
		return status.Error(codes.ResourceExhausted, "too many email requests")
	}
	code, err := randomEmailActionCode()
	if err != nil {
		return err
	}
	if err := u.repo.CreateEmailAction(ctx, user.ID, purpose, tokenHash(code), time.Now().UTC().Add(emailActionTTL)); err != nil {
		return err
	}
	return u.emailSender.Send(ctx, user.Email, purpose, code)
}

func (u *AuthUsecase) issueSession(ctx context.Context, user data.UserRow, deviceID string) (Session, error) {
	now := time.Now().UTC()
	accessToken, err := u.keys.sign(user.ID, user.Email, u.issuer, u.audience, now, u.accessTTL)
	if err != nil {
		return Session{}, err
	}
	refreshToken := randomToken()
	refreshTokenID := platform.NewUUID()
	if err := u.repo.InsertRefreshToken(ctx, data.RefreshTokenInput{
		ID:        refreshTokenID,
		UserID:    user.ID,
		TokenHash: tokenHash(refreshToken),
		ExpiresAt: now.Add(u.refreshTTL),
		FamilyID:  refreshTokenID,
		DeviceID:  strings.TrimSpace(deviceID),
	}); err != nil {
		return Session{}, err
	}
	if err := u.repo.SetSession(ctx, accessToken, strconv.FormatInt(int64(u.accessTTL.Seconds()), 10), user.ID); err != nil {
		return Session{}, err
	}
	return Session{
		AccessToken: accessToken, RefreshToken: refreshToken, TokenType: "Bearer",
		ExpiresIn: int64(u.accessTTL.Seconds()), UserID: user.ID, Email: user.Email, Name: user.Name,
		EmailVerified: user.EmailVerified,
	}, nil
}

// JWKS returns the current active and retained verification public keys. The
// active signing private key is never included.
func (u *AuthUsecase) JWKS() []byte {
	return u.keys.JWKS()
}

func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func randomEmailActionCode() (string, error) {
	var raw [6]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:])[:8], nil
}

func validEmailActionCode(code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != 8 {
		return false
	}
	for _, runeValue := range code {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", runeValue) {
			return false
		}
	}
	return true
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
