package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct {
	DB *gorm.DB
}

type ProfileRow struct {
	ID          string
	Email       string
	Phone       string
	DisplayName string
	AvatarURL   string
	Locale      string
	Timezone    string
	Status      string
}

func NewData(_ *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "user_profile")
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

type UserRepo struct {
	data *Data
}

func NewUserRepo(data *Data) *UserRepo {
	return &UserRepo{data: data}
}

func (r *UserRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
	}
}

func (r *UserRepo) GetProfile(ctx context.Context, userID string) (ProfileRow, error) {
	var row ProfileRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT
			user_id::text AS id,
			email,
			phone,
			COALESCE(NULLIF(display_name, ''), email) AS display_name,
			COALESCE(avatar_url, '') AS avatar_url,
			COALESCE(locale, '') AS locale,
			COALESCE(timezone, '') AS timezone,
			status
		FROM user_profile.profiles
		WHERE user_id = ?::uuid
		LIMIT 1
	`, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProfileRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func (r *UserRepo) EnsureProfile(ctx context.Context, row ProfileRow) (ProfileRow, error) {
	if row.DisplayName == "" {
		row.DisplayName = row.Email
	}
	if row.Status == "" {
		row.Status = "active"
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO user_profile.profiles AS existing (user_id, email, phone, display_name, status, locale, timezone)
		VALUES (?::uuid, ?, ?, ?, ?, 'zh-CN', 'Asia/Shanghai')
		ON CONFLICT (user_id) DO UPDATE SET
			email = EXCLUDED.email,
			display_name = COALESCE(NULLIF(existing.display_name, ''), EXCLUDED.display_name),
			updated_at = now()
	`, row.ID, row.Email, row.Phone, row.DisplayName, row.Status).Error; err != nil {
		return ProfileRow{}, err
	}
	return r.GetProfile(ctx, row.ID)
}

func (r *UserRepo) UpdateProfile(ctx context.Context, row ProfileRow) (ProfileRow, error) {
	if err := r.data.DB.WithContext(ctx).Exec(`
		UPDATE user_profile.profiles
		SET
			phone = ?,
			display_name = ?,
			avatar_url = ?,
			locale = ?,
			timezone = ?,
			updated_at = now()
		WHERE user_id = ?::uuid
	`, row.Phone, row.DisplayName, row.AvatarURL, row.Locale, row.Timezone, row.ID).Error; err != nil {
		return ProfileRow{}, err
	}
	return r.GetProfile(ctx, row.ID)
}

func (r *UserRepo) SetProfileStatus(ctx context.Context, userID, state, operatorID, reason, idempotencyKey string) (ProfileRow, error) {
	var result ProfileRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing struct{ UserID string }
		if err := tx.Raw(`SELECT user_id::text AS user_id FROM user_profile.admin_status_operations WHERE idempotency_key = ? FOR UPDATE`, idempotencyKey).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.UserID != "" {
			return tx.Raw(`SELECT user_id::text AS id, email, phone, COALESCE(NULLIF(display_name, ''), email) AS display_name, COALESCE(avatar_url, '') AS avatar_url, COALESCE(locale, '') AS locale, COALESCE(timezone, '') AS timezone, status FROM user_profile.profiles WHERE user_id = ?::uuid LIMIT 1`, userID).Scan(&result).Error
		}
		var before struct{ Status string }
		if err := tx.Raw(`SELECT status FROM user_profile.profiles WHERE user_id = ?::uuid FOR UPDATE`, userID).Scan(&before).Error; err != nil {
			return err
		}
		if before.Status == "" {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Exec(`UPDATE user_profile.profiles SET status = ?, updated_at = now() WHERE user_id = ?::uuid`, state, userID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO user_profile.admin_status_operations (idempotency_key, user_id, operator_id, reason, before_status, after_status) VALUES (?, ?::uuid, ?, ?, ?, ?)`, idempotencyKey, userID, operatorID, reason, before.Status, state).Error; err != nil {
			return err
		}
		return tx.Raw(`SELECT user_id::text AS id, email, phone, COALESCE(NULLIF(display_name, ''), email) AS display_name, COALESCE(avatar_url, '') AS avatar_url, COALESCE(locale, '') AS locale, COALESCE(timezone, '') AS timezone, status FROM user_profile.profiles WHERE user_id = ?::uuid LIMIT 1`, userID).Scan(&result).Error
	})
	if err != nil {
		return ProfileRow{}, err
	}
	if result.ID == "" {
		return ProfileRow{}, gorm.ErrRecordNotFound
	}
	return result, nil
}
