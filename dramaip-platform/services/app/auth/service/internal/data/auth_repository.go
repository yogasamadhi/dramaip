package data

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

var (
	ErrRefreshTokenNotFound = errors.New("refresh token not found")
	ErrRefreshTokenReuse    = errors.New("refresh token reuse detected")
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

type RefreshTokenInput struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	FamilyID  string
	ParentID  string
	DeviceID  string
}

type refreshTokenRecord struct {
	ID            string
	UserID        string
	FamilyID      string
	DeviceID      string
	Revoked       bool
	RevokedReason string
	ExpiresAt     time.Time
	UserStatus    string
	Email         string
	PasswordHash  string
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	if cfg.AutoMigrate {
		return nil, nil, errors.New("AUTO_MIGRATE is not supported; run the migration job with the DDL role")
	}
	db, err := platform.OpenDomainPostgres(context.Background(), "auth")
	if err != nil {
		return nil, nil, err
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

func (r *AuthRepo) InsertRefreshToken(ctx context.Context, input RefreshTokenInput) error {
	return r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO auth.refresh_tokens (id, user_id, token_hash, expires_at, family_id, parent_id, device_id)
		VALUES (?::uuid, ?::uuid, ?, ?, ?::uuid, NULLIF(?, '')::uuid, NULLIF(?, ''))
	`, input.ID, input.UserID, input.TokenHash, input.ExpiresAt, input.FamilyID, input.ParentID, input.DeviceID).Error
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
		UPDATE auth.refresh_tokens SET revoked_at = now(), revoked_reason = 'logout'
		WHERE token_hash = ? AND revoked_at IS NULL
	`, tokenHash).Error
}

// RevokeRefreshTokensByDevice invalidates every active refresh token associated
// with one user-owned device. The reason makes a device-level logout auditable.
func (r *AuthRepo) RevokeRefreshTokensByDevice(ctx context.Context, userID string, deviceID string) error {
	if deviceID == "" {
		return nil
	}
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE auth.refresh_tokens SET revoked_at = now(), revoked_reason = 'device_logout'
		WHERE user_id = ?::uuid AND device_id = ? AND revoked_at IS NULL
	`, userID, deviceID).Error
}

// RotateRefreshToken atomically consumes one token and stores its replacement.
// A repeat of a token previously marked as rotated revokes every active refresh
// token for that user, creating an auditable reuse-detection boundary.
func (r *AuthRepo) RotateRefreshToken(ctx context.Context, tokenHash string, replacement RefreshTokenInput) (UserRow, error) {
	var user UserRow
	var reuseDetected bool
	var invalid bool
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record refreshTokenRecord
		if err := tx.Raw(`
			SELECT
				rt.id::text AS id,
				rt.user_id::text AS user_id,
				rt.family_id::text AS family_id,
				COALESCE(rt.device_id, '') AS device_id,
				(rt.revoked_at IS NOT NULL) AS revoked,
				COALESCE(rt.revoked_reason, '') AS revoked_reason,
				rt.expires_at,
				u.status AS user_status,
				u.email,
				u.password_hash
			FROM auth.refresh_tokens rt
			JOIN auth.users u ON u.id = rt.user_id
			WHERE rt.token_hash = ?
			LIMIT 1
			FOR UPDATE OF rt
		`, tokenHash).Scan(&record).Error; err != nil {
			return err
		}
		if record.ID == "" || record.UserStatus != "active" {
			invalid = true
			return nil
		}
		if record.Revoked {
			if record.RevokedReason == "rotated" {
				if err := tx.Exec(`
					UPDATE auth.refresh_tokens
					SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = 'reuse_detected'
					WHERE user_id = ?::uuid AND revoked_at IS NULL
				`, record.UserID).Error; err != nil {
					return err
				}
				reuseDetected = true
			} else {
				invalid = true
			}
			return nil
		}
		if !record.ExpiresAt.After(time.Now().UTC()) {
			if err := tx.Exec(`
				UPDATE auth.refresh_tokens SET revoked_at = now(), revoked_reason = 'expired'
				WHERE id = ?::uuid AND revoked_at IS NULL
			`, record.ID).Error; err != nil {
				return err
			}
			invalid = true
			return nil
		}

		if err := tx.Exec(`
			UPDATE auth.refresh_tokens
			SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = ?::uuid, last_used_at = now()
			WHERE id = ?::uuid AND revoked_at IS NULL
		`, replacement.ID, record.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO auth.refresh_tokens (id, user_id, token_hash, expires_at, family_id, parent_id, device_id)
			VALUES (?::uuid, ?::uuid, ?, ?, ?::uuid, ?::uuid, NULLIF(?, ''))
		`, replacement.ID, record.UserID, replacement.TokenHash, replacement.ExpiresAt, record.FamilyID, record.ID, record.DeviceID).Error; err != nil {
			return err
		}
		user = UserRow{ID: record.UserID, Email: record.Email, Name: record.Email, PasswordHash: record.PasswordHash}
		return nil
	})
	if err != nil {
		return UserRow{}, err
	}
	if reuseDetected {
		return UserRow{}, ErrRefreshTokenReuse
	}
	if invalid {
		return UserRow{}, ErrRefreshTokenNotFound
	}
	return user, nil
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
