package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type service struct {
	db         *gorm.DB
	redis      *platform.Redis
	issuer     string
	accessKey  string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

type userRow struct {
	ID           string
	Email        string
	Name         string
	PasswordHash string
}

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	if platform.Env("AUTO_MIGRATE", platform.Env("BFF_AUTO_MIGRATE", "false")) == "true" {
		if err := platform.RunMigrations(db, platform.Env("MIGRATIONS_DIR", "./migrations")); err != nil {
			log.Fatalf("run migrations: %v", err)
		}
	}
	redis := platform.NewRedis(platform.RedisConfigFromEnv())
	defer redis.Close()
	svc := &service{
		db:         db,
		redis:      redis,
		issuer:     platform.Env("JWT_ISSUER", "dramaip"),
		accessKey:  platform.Env("JWT_ACCESS_SECRET", "changeme-access-secret-replace-in-prod"),
		accessTTL:  platform.EnvDurationSeconds("JWT_ACCESS_TTL", 900),
		refreshTTL: platform.EnvDurationSeconds("JWT_REFRESH_TTL", 2592000),
	}
	health := platform.HealthServer(platform.Env("AUTH_HTTP_ADDR", ":8101"), "auth-service", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
		"redis":    redis.Ping,
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("auth health server stopped: %v", err)
		}
	}()
	if err := platform.ServeGRPC(platform.Env("AUTH_GRPC_ADDR", ":9101"), func(server *grpc.Server) {
		drpc.RegisterAuthServiceServer(server, svc)
	}); err != nil {
		log.Fatalf("auth gRPC failed: %v", err)
	}
}

func (s *service) Login(ctx context.Context, req *drpc.LoginRequest) (*drpc.AuthReply, error) {
	if !strings.Contains(req.Email, "@") || len(req.Password) < 8 {
		return nil, status.Error(codes.InvalidArgument, "invalid credentials")
	}
	user, err := s.findUserByEmail(ctx, req.Email)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	return s.issueSession(ctx, user)
}

func (s *service) Refresh(ctx context.Context, req *drpc.RefreshRequest) (*drpc.AuthReply, error) {
	hash := tokenHash(req.RefreshToken)
	var user userRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT u.id::text AS id, u.email, COALESCE(p.display_name, u.email) AS name, u.password_hash
		FROM auth.refresh_tokens rt
		JOIN auth.users u ON u.id = rt.user_id
		LEFT JOIN user_profile.profiles p ON p.user_id = u.id
		WHERE rt.token_hash = ? AND rt.expires_at > now() AND rt.revoked_at IS NULL AND u.status = 'active'
		LIMIT 1
	`, hash).Scan(&user).Error
	if err != nil || user.ID == "" {
		return nil, status.Error(codes.Unauthenticated, "invalid refresh token")
	}
	return s.issueSession(ctx, user)
}

func (s *service) Logout(ctx context.Context, req *drpc.LogoutRequest) (*drpc.LogoutReply, error) {
	if req.RefreshToken != "" {
		if err := s.db.WithContext(ctx).Exec(`
			UPDATE auth.refresh_tokens SET revoked_at = now()
			WHERE token_hash = ? AND revoked_at IS NULL
		`, tokenHash(req.RefreshToken)).Error; err != nil {
			return nil, err
		}
	}
	return &drpc.LogoutReply{OK: true}, nil
}

func (s *service) ValidateAccessToken(ctx context.Context, req *drpc.ValidateAccessTokenRequest) (*drpc.AuthReply, error) {
	token, err := jwt.Parse(req.AccessToken, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, status.Error(codes.Unauthenticated, "invalid token")
		}
		return []byte(s.accessKey), nil
	}, jwt.WithIssuer(s.issuer))
	if err != nil || !token.Valid {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	userID, _ := claims.GetSubject()
	if userID == "" {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	cached, err := s.redis.Command(ctx, "GET", "session:"+req.AccessToken)
	if err != nil || cached != userID {
		return nil, status.Error(codes.Unauthenticated, "session expired")
	}
	email, _ := claims["email"].(string)
	return &drpc.AuthReply{TokenType: "Bearer", UserID: userID, Email: email}, nil
}

func (s *service) findUserByEmail(ctx context.Context, email string) (userRow, error) {
	var user userRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT u.id::text AS id, u.email, COALESCE(p.display_name, u.email) AS name, u.password_hash
		FROM auth.users u
		LEFT JOIN user_profile.profiles p ON p.user_id = u.id
		WHERE lower(u.email) = lower(?) AND u.status = 'active'
		LIMIT 1
	`, email).Scan(&user).Error
	if err != nil || user.ID == "" {
		return userRow{}, gorm.ErrRecordNotFound
	}
	return user, nil
}

func (s *service) issueSession(ctx context.Context, user userRow) (*drpc.AuthReply, error) {
	now := time.Now()
	expires := now.Add(s.accessTTL)
	claims := jwt.MapClaims{"iss": s.issuer, "sub": user.ID, "email": user.Email, "exp": expires.Unix(), "iat": now.Unix()}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.accessKey))
	if err != nil {
		return nil, err
	}
	refreshToken := randomToken()
	if err := s.db.WithContext(ctx).Exec(`
		INSERT INTO auth.refresh_tokens (id, user_id, token_hash, expires_at)
		VALUES (?::uuid, ?::uuid, ?, ?)
	`, platform.NewUUID(), user.ID, tokenHash(refreshToken), now.Add(s.refreshTTL)).Error; err != nil {
		return nil, err
	}
	if _, err := s.redis.Command(ctx, "SETEX", "session:"+accessToken, strconv.FormatInt(int64(s.accessTTL.Seconds()), 10), user.ID); err != nil {
		return nil, err
	}
	return &drpc.AuthReply{
		AccessToken: accessToken, RefreshToken: refreshToken, TokenType: "Bearer",
		ExpiresIn: int64(s.accessTTL.Seconds()), UserID: user.ID, Email: user.Email, Name: user.Name,
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
