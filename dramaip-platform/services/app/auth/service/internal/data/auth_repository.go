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
	ErrRefreshTokenNotFound             = errors.New("refresh token not found")
	ErrRefreshTokenReuse                = errors.New("refresh token reuse detected")
	ErrEmailActionNotFound              = errors.New("email action not found")
	ErrDesktopAuthorizationCodeNotFound = errors.New("desktop authorization code not found")
)

type Data struct {
	DB    *gorm.DB
	Redis *platform.Redis
}

type UserRow struct {
	ID            string
	Email         string
	Name          string
	PasswordHash  string
	EmailVerified bool
}

type AccountStatusChange struct {
	UserID, Status, OperatorID, Reason, IdempotencyKey string
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

type DesktopAuthorizationCodeInput struct {
	ID            string
	UserID        string
	CodeHash      string
	CodeChallenge string
	RedirectURI   string
	DeviceID      string
	ExpiresAt     time.Time
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
	EmailVerified bool
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
		SELECT u.id::text AS id, u.email, u.email AS name, u.password_hash,
		       (u.email_verified_at IS NOT NULL) AS email_verified
		FROM auth.users u
		WHERE lower(u.email) = lower(?) AND u.status = 'active'
		LIMIT 1
	`, email).Scan(&user).Error
	if err != nil || user.ID == "" {
		return UserRow{}, gorm.ErrRecordNotFound
	}
	return user, nil
}

func (r *AuthRepo) FindUserByID(ctx context.Context, userID string) (UserRow, error) {
	var user UserRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT u.id::text AS id, u.email, u.email AS name, u.password_hash,
		       (u.email_verified_at IS NOT NULL) AS email_verified
		FROM auth.users u
		WHERE u.id = ?::uuid AND u.status = 'active'
		LIMIT 1
	`, userID).Scan(&user).Error
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

// SetAccountStatus owns the identity-domain side of an operator freeze. A
// suspended account cannot log in, refresh, validate a cached access token,
// or exchange a desktop authorization code. The idempotency key is durable so
// a BFF retry after a partial downstream failure cannot create another state
// transition or erase the original operator evidence.
func (r *AuthRepo) SetAccountStatus(ctx context.Context, change AccountStatusChange) (string, error) {
	var result struct{ Status string }
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var prior struct{ Status string }
		if err := tx.Raw(`SELECT status FROM auth.admin_status_operations WHERE idempotency_key = ? FOR UPDATE`, change.IdempotencyKey).Scan(&prior).Error; err != nil {
			return err
		}
		if prior.Status != "" {
			result.Status = prior.Status
			return nil
		}
		var before struct{ Status string }
		if err := tx.Raw(`SELECT status FROM auth.users WHERE id = ?::uuid FOR UPDATE`, change.UserID).Scan(&before).Error; err != nil {
			return err
		}
		if before.Status == "" {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Exec(`UPDATE auth.users SET status = ?, session_invalidated_at = date_trunc('second', now()) + interval '1 second', updated_at = now() WHERE id = ?::uuid`, change.Status, change.UserID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE auth.refresh_tokens SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = CASE WHEN revoked_at IS NULL THEN 'admin_account_status_change' ELSE revoked_reason END WHERE user_id = ?::uuid AND revoked_at IS NULL`, change.UserID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO auth.admin_status_operations (idempotency_key, user_id, operator_id, reason, before_status, after_status) VALUES (?, ?::uuid, ?, ?, ?, ?)`, change.IdempotencyKey, change.UserID, change.OperatorID, change.Reason, before.Status, change.Status).Error; err != nil {
			return err
		}
		result.Status = change.Status
		return nil
	})
	return result.Status, err
}

// CreateDesktopAuthorizationCode invalidates outstanding codes for the same
// desktop device. This keeps the active code set small without storing raw
// authorization codes or PKCE verifier material.
func (r *AuthRepo) CreateDesktopAuthorizationCode(ctx context.Context, input DesktopAuthorizationCodeInput) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			UPDATE auth.desktop_authorization_codes
			SET consumed_at = now(), consumed_reason = 'superseded'
			WHERE user_id = ?::uuid AND device_id = ? AND consumed_at IS NULL AND expires_at > now()
		`, input.UserID, input.DeviceID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO auth.desktop_authorization_codes
			  (id, user_id, code_hash, code_challenge, redirect_uri, device_id, expires_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?)
		`, input.ID, input.UserID, input.CodeHash, input.CodeChallenge, input.RedirectURI, input.DeviceID, input.ExpiresAt).Error
	})
}

// ConsumeDesktopAuthorizationCode locks the row and marks it consumed only
// when all bindings match. It is the replay/audit boundary for desktop login.
func (r *AuthRepo) ConsumeDesktopAuthorizationCode(ctx context.Context, codeHash, codeChallenge, redirectURI, deviceID string) (UserRow, error) {
	var user UserRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record struct {
			ID            string
			UserID        string
			Email         string
			PasswordHash  string
			EmailVerified bool
		}
		if err := tx.Raw(`
			SELECT c.id::text AS id, c.user_id::text AS user_id, u.email, u.password_hash,
			       (u.email_verified_at IS NOT NULL) AS email_verified
			FROM auth.desktop_authorization_codes c
			JOIN auth.users u ON u.id = c.user_id
			WHERE c.code_hash = ? AND c.code_challenge = ? AND c.redirect_uri = ? AND c.device_id = ?
			  AND c.consumed_at IS NULL AND c.expires_at > now() AND u.status = 'active'
			LIMIT 1 FOR UPDATE OF c
		`, codeHash, codeChallenge, redirectURI, deviceID).Scan(&record).Error; err != nil {
			return err
		}
		if record.ID == "" {
			return ErrDesktopAuthorizationCodeNotFound
		}
		if err := tx.Exec(`
			UPDATE auth.desktop_authorization_codes
			SET consumed_at = now(), consumed_reason = 'exchanged'
			WHERE id = ?::uuid AND consumed_at IS NULL
		`, record.ID).Error; err != nil {
			return err
		}
		user = UserRow{ID: record.UserID, Email: record.Email, Name: record.Email, PasswordHash: record.PasswordHash, EmailVerified: record.EmailVerified}
		return nil
	})
	if err != nil {
		return UserRow{}, err
	}
	return user, nil
}

func (r *AuthRepo) CreateEmailAction(ctx context.Context, userID string, purpose string, hash string, expiresAt time.Time) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			UPDATE auth.email_actions
			SET consumed_at = now()
			WHERE user_id = ?::uuid AND purpose = ? AND consumed_at IS NULL
		`, userID, purpose).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO auth.email_actions (id, user_id, purpose, token_hash, expires_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?)
		`, platform.NewUUID(), userID, purpose, hash, expiresAt).Error
	})
}

func (r *AuthRepo) VerifyEmailAction(ctx context.Context, userID string, hash string) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var action struct{ ID string }
		if err := tx.Raw(`
			SELECT id::text AS id
			FROM auth.email_actions
			WHERE user_id = ?::uuid AND purpose = 'verify_email' AND token_hash = ?
			  AND consumed_at IS NULL AND expires_at > now()
			ORDER BY created_at DESC
			LIMIT 1
			FOR UPDATE
		`, userID, hash).Scan(&action).Error; err != nil {
			return err
		}
		if action.ID == "" {
			return ErrEmailActionNotFound
		}
		if err := tx.Exec(`UPDATE auth.email_actions SET consumed_at = now() WHERE id = ?::uuid`, action.ID).Error; err != nil {
			return err
		}
		return tx.Exec(`UPDATE auth.users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = ?::uuid`, userID).Error
	})
}

func (r *AuthRepo) ResetPasswordWithAction(ctx context.Context, email string, hash string, passwordHash string) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user struct{ ID string }
		if err := tx.Raw(`
			SELECT id::text AS id FROM auth.users
			WHERE lower(email) = lower(?) AND status = 'active'
			LIMIT 1 FOR UPDATE
		`, email).Scan(&user).Error; err != nil {
			return err
		}
		if user.ID == "" {
			return ErrEmailActionNotFound
		}
		var action struct{ ID string }
		if err := tx.Raw(`
			SELECT id::text AS id
			FROM auth.email_actions
			WHERE user_id = ?::uuid AND purpose = 'reset_password' AND token_hash = ?
			  AND consumed_at IS NULL AND expires_at > now()
			ORDER BY created_at DESC
			LIMIT 1
			FOR UPDATE
		`, user.ID, hash).Scan(&action).Error; err != nil {
			return err
		}
		if action.ID == "" {
			return ErrEmailActionNotFound
		}
		if err := tx.Exec(`UPDATE auth.email_actions SET consumed_at = now() WHERE id = ?::uuid`, action.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE auth.users
			-- JWT issued-at values are second-granularity. Move the cutoff to the
			-- following second so a token issued just before this reset in the
			-- same second is not accidentally retained.
			SET password_hash = ?, session_invalidated_at = date_trunc('second', now()) + interval '1 second', updated_at = now()
			WHERE id = ?::uuid
		`, passwordHash, user.ID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			UPDATE auth.refresh_tokens
			SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = 'password_reset'
			WHERE user_id = ?::uuid AND revoked_at IS NULL
		`, user.ID).Error
	})
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
				u.password_hash,
				(u.email_verified_at IS NOT NULL) AS email_verified
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
		user = UserRow{ID: record.UserID, Email: record.Email, Name: record.Email, PasswordHash: record.PasswordHash, EmailVerified: record.EmailVerified}
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

func (r *AuthRepo) IncrementEmailAction(ctx context.Context, email string, purpose string, windowSeconds int64) (int64, error) {
	key := "email_action:" + purpose + ":" + email
	value, err := r.data.Redis.Command(ctx, "INCR", key)
	if err != nil {
		return 0, err
	}
	if value == "1" {
		_, _ = r.data.Redis.Command(ctx, "EXPIRE", key, strconv.FormatInt(windowSeconds, 10))
	}
	return strconv.ParseInt(value, 10, 64)
}

func (r *AuthRepo) GetSession(ctx context.Context, accessToken string) (string, error) {
	return r.data.Redis.Command(ctx, "GET", "session:"+accessToken)
}

func (r *AuthRepo) AccessSessionState(ctx context.Context, userID string, issuedAt time.Time) (bool, bool, error) {
	var state struct {
		Valid         bool
		EmailVerified bool
	}
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT
		  (status = 'active' AND (session_invalidated_at IS NULL OR session_invalidated_at <= ?)) AS valid,
		  (email_verified_at IS NOT NULL) AS email_verified
		FROM auth.users
		WHERE id = ?::uuid
	`, issuedAt, userID).Scan(&state).Error
	return state.Valid, state.EmailVerified, err
}
