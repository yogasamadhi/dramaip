package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type AuthUsecase struct {
	repo       *data.AuthRepo
	issuer     string
	accessKey  string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

type Session struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int64
	UserID       string
	Email        string
	Name         string
}

type AuthIdentity struct {
	UserID string
	Email  string
}

func NewAuthUsecase(repo *data.AuthRepo, cfg *conf.Bootstrap) *AuthUsecase {
	return &AuthUsecase{
		repo:       repo,
		issuer:     cfg.JWT.Issuer,
		accessKey:  cfg.JWT.AccessSecret,
		accessTTL:  kratosx.Duration(cfg.JWT.AccessTokenTTL, 15*time.Minute),
		refreshTTL: kratosx.Duration(cfg.JWT.RefreshTokenTTL, 720*time.Hour),
	}
}

func (u *AuthUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *AuthUsecase) Register(ctx context.Context, email string, password string, displayName string) (Session, error) {
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
	return u.issueSession(ctx, user)
}

func (u *AuthUsecase) Login(ctx context.Context, email string, password string) (Session, error) {
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
	return u.issueSession(ctx, user)
}

func (u *AuthUsecase) Refresh(ctx context.Context, refreshToken string) (Session, error) {
	hash := tokenHash(refreshToken)
	user, err := u.repo.FindUserByRefreshToken(ctx, hash)
	if err != nil {
		return Session{}, status.Error(codes.Unauthenticated, "invalid refresh token")
	}
	if err := u.repo.RevokeRefreshToken(ctx, hash); err != nil {
		return Session{}, err
	}
	return u.issueSession(ctx, user)
}

func (u *AuthUsecase) Logout(ctx context.Context, refreshToken string, accessToken string) error {
	if refreshToken == "" {
		return u.repo.DeleteSession(ctx, accessToken)
	}
	if err := u.repo.RevokeRefreshToken(ctx, tokenHash(refreshToken)); err != nil {
		return err
	}
	return u.repo.DeleteSession(ctx, accessToken)
}

func (u *AuthUsecase) ValidateAccessToken(ctx context.Context, accessToken string) (AuthIdentity, error) {
	token, err := jwt.Parse(accessToken, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, status.Error(codes.Unauthenticated, "invalid token")
		}
		return []byte(u.accessKey), nil
	}, jwt.WithIssuer(u.issuer))
	if err != nil || !token.Valid {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	userID, _ := claims.GetSubject()
	if userID == "" {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "invalid token")
	}
	cached, err := u.repo.GetSession(ctx, accessToken)
	if err != nil || cached != userID {
		return AuthIdentity{}, status.Error(codes.Unauthenticated, "session expired")
	}
	email, _ := claims["email"].(string)
	return AuthIdentity{UserID: userID, Email: email}, nil
}

func (u *AuthUsecase) issueSession(ctx context.Context, user data.UserRow) (Session, error) {
	now := time.Now()
	expires := now.Add(u.accessTTL)
	claims := jwt.MapClaims{"iss": u.issuer, "sub": user.ID, "email": user.Email, "exp": expires.Unix(), "iat": now.Unix()}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(u.accessKey))
	if err != nil {
		return Session{}, err
	}
	refreshToken := randomToken()
	if err := u.repo.InsertRefreshToken(ctx, platform.NewUUID(), user.ID, tokenHash(refreshToken), now.Add(u.refreshTTL)); err != nil {
		return Session{}, err
	}
	if err := u.repo.SetSession(ctx, accessToken, strconv.FormatInt(int64(u.accessTTL.Seconds()), 10), user.ID); err != nil {
		return Session{}, err
	}
	return Session{
		AccessToken: accessToken, RefreshToken: refreshToken, TokenType: "Bearer",
		ExpiresIn: int64(u.accessTTL.Seconds()), UserID: user.ID, Email: user.Email, Name: user.Name,
	}, nil
}

func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
