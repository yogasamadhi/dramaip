package data

import (
	"context"
	"strconv"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct {
	DB    *gorm.DB
	Redis *platform.Redis
}

type UserRow struct {
	ID           string
	Email        string
	Name         string
	PasswordHash string
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	if cfg.AutoMigrate {
		if err := platform.RunMigrations(db, cfg.Data.MigrationsDir); err != nil {
			return nil, nil, err
		}
	}
	redis := platform.NewRedis(platform.RedisConfigFromEnv())
	return &Data{DB: db, Redis: redis}, func() { _ = redis.Close() }, nil
}

type AuthRepo struct {
	data *Data
}

func NewAuthRepo(data *Data) *AuthRepo {
	return &AuthRepo{data: data}
}

func (r *AuthRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
		"redis":    r.data.Redis.Ping,
	}
}

func (r *AuthRepo) FindUserByEmail(ctx context.Context, email string) (UserRow, error) {
	var user UserRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT u.id::text AS id, u.email, u.email AS name, u.password_hash
		FROM auth.users u
		WHERE lower(u.email) = lower(?) AND u.status = 'active'
		LIMIT 1
	`, email).Scan(&user).Error
	if err != nil || user.ID == "" {
		return UserRow{}, gorm.ErrRecordNotFound
	}
	return user, nil
}

func (r *AuthRepo) FindUserByRefreshToken(ctx context.Context, tokenHash string) (UserRow, error) {
	var user UserRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT u.id::text AS id, u.email, u.email AS name, u.password_hash
		FROM auth.refresh_tokens rt
		JOIN auth.users u ON u.id = rt.user_id
		WHERE rt.token_hash = ? AND rt.expires_at > now() AND rt.revoked_at IS NULL AND u.status = 'active'
		LIMIT 1
	`, tokenHash).Scan(&user).Error
	if err != nil || user.ID == "" {
		return UserRow{}, gorm.ErrRecordNotFound
	}
	return user, nil
}

func (r *AuthRepo) InsertRefreshToken(ctx context.Context, id string, userID string, tokenHash string, expiresAt any) error {
	return r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO auth.refresh_tokens (id, user_id, token_hash, expires_at)
		VALUES (?::uuid, ?::uuid, ?, ?)
	`, id, userID, tokenHash, expiresAt).Error
}

func (r *AuthRepo) InsertUser(ctx context.Context, id string, email string, passwordHash string) (UserRow, error) {
	err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO auth.users (id, email, password_hash, status)
		VALUES (?::uuid, ?, ?, 'active')
	`, id, email, passwordHash).Error
	if err != nil {
		return UserRow{}, err
	}
	return r.FindUserByEmail(ctx, email)
}

func (r *AuthRepo) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE auth.refresh_tokens SET revoked_at = now()
		WHERE token_hash = ? AND revoked_at IS NULL
	`, tokenHash).Error
}

func (r *AuthRepo) DeleteSession(ctx context.Context, accessToken string) error {
	if accessToken == "" {
		return nil
	}
	_, err := r.data.Redis.Command(ctx, "DEL", "session:"+accessToken)
	return err
}

func (r *AuthRepo) SetSession(ctx context.Context, accessToken string, ttlSeconds string, userID string) error {
	_, err := r.data.Redis.Command(ctx, "SETEX", "session:"+accessToken, ttlSeconds, userID)
	return err
}

func (r *AuthRepo) IncrementLoginFailure(ctx context.Context, email string, windowSeconds int64) (int64, error) {
	key := "login_fail:" + email
	value, err := r.data.Redis.Command(ctx, "INCR", key)
	if err != nil {
		return 0, err
	}
	if value == "1" {
		_, _ = r.data.Redis.Command(ctx, "EXPIRE", key, strconv.FormatInt(windowSeconds, 10))
	}
	count, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (r *AuthRepo) ClearLoginFailures(ctx context.Context, email string) error {
	_, err := r.data.Redis.Command(ctx, "DEL", "login_fail:"+email)
	return err
}

func (r *AuthRepo) GetSession(ctx context.Context, accessToken string) (string, error) {
	return r.data.Redis.Command(ctx, "GET", "session:"+accessToken)
}
