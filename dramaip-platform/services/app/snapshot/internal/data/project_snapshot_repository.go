// Package data owns opaque encrypted snapshot storage. It must not import the
// Desktop project package or any cryptographic key handling code.
package data

import (
	"context"
	"errors"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

const (
	MaxProjectSnapshotBytes   = 8 << 20
	MaxActiveProjectSnapshots = 10
	ProjectSnapshotRetention  = 30 * 24 * time.Hour
)

var (
	ErrIdempotencyConflict         = errors.New("snapshot idempotency key names a different envelope")
	ErrProjectSnapshotLimitReached = errors.New("project snapshot limit reached")
)

type Data struct{ DB *gorm.DB }

func NewData() (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "snapshot")
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

type ProjectSnapshotRow struct {
	ID                string
	IdempotencyKey    string
	EncryptedEnvelope []byte
	EncryptedBytes    int64
	EncryptedSHA256   string
	CreatedAt         time.Time
	ExpiresAt         time.Time
}

type ProjectSnapshotRepo struct{ data *Data }

func NewProjectSnapshotRepo(data *Data) *ProjectSnapshotRepo { return &ProjectSnapshotRepo{data: data} }

func (r *ProjectSnapshotRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
	}
}

func (r *ProjectSnapshotRepo) CreateProjectSnapshot(ctx context.Context, userID, idempotencyKey, encryptedSHA256 string, encryptedEnvelope []byte) (ProjectSnapshotRow, error) {
	var result ProjectSnapshotRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := purgeExpiredSnapshots(ctx, tx, userID); err != nil {
			return err
		}
		existing, err := projectSnapshotByIdempotencyKey(ctx, tx, userID, idempotencyKey)
		if err == nil {
			if existing.EncryptedSHA256 != encryptedSHA256 {
				return ErrIdempotencyConflict
			}
			result = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var activeCount int64
		if err := tx.Raw(`
			SELECT COUNT(*) FROM snapshot.project_snapshots
			WHERE user_id = ?::uuid AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
		`, userID).Scan(&activeCount).Error; err != nil {
			return err
		}
		if activeCount >= MaxActiveProjectSnapshots {
			return ErrProjectSnapshotLimitReached
		}

		id := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO snapshot.project_snapshots
			  (id, user_id, idempotency_key, encrypted_envelope, encrypted_bytes, encrypted_sha256, expires_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, now() + interval '30 days')
		`, id, userID, idempotencyKey, encryptedEnvelope, len(encryptedEnvelope), encryptedSHA256).Error; err != nil {
			return err
		}
		created, err := projectSnapshotByID(ctx, tx, userID, id, false)
		if err != nil {
			return err
		}
		result = created
		return nil
	})
	return result, err
}

func (r *ProjectSnapshotRepo) ListProjectSnapshots(ctx context.Context, userID string) ([]ProjectSnapshotRow, error) {
	if err := purgeExpiredSnapshots(ctx, r.data.DB.WithContext(ctx), userID); err != nil {
		return nil, err
	}
	var rows []ProjectSnapshotRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshots
		WHERE user_id = ?::uuid AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
		ORDER BY created_at DESC, id DESC
	`, userID).Scan(&rows).Error
	return rows, err
}

func (r *ProjectSnapshotRepo) GetProjectSnapshot(ctx context.Context, userID, snapshotID string) (ProjectSnapshotRow, error) {
	if err := purgeExpiredSnapshots(ctx, r.data.DB.WithContext(ctx), userID); err != nil {
		return ProjectSnapshotRow{}, err
	}
	return projectSnapshotByID(ctx, r.data.DB.WithContext(ctx), userID, snapshotID, true)
}

func (r *ProjectSnapshotRepo) DeleteProjectSnapshot(ctx context.Context, userID, snapshotID string) (time.Time, error) {
	var deletedAt time.Time
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := purgeExpiredSnapshots(ctx, tx, userID); err != nil {
			return err
		}
		result := tx.Raw(`
			UPDATE snapshot.project_snapshots
			SET encrypted_envelope = NULL, deleted_at = now()
			WHERE user_id = ?::uuid AND id = ?::uuid AND deleted_at IS NULL AND purged_at IS NULL
			RETURNING deleted_at
		`, userID, snapshotID).Scan(&deletedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	return deletedAt, err
}

// PurgeExpiredProjectSnapshots clears ciphertext for every expired record.
// A scheduled domain-owned caller invokes this even when an inactive user no
// longer lists or downloads snapshots; per-user calls still purge eagerly.
func (r *ProjectSnapshotRepo) PurgeExpiredProjectSnapshots(ctx context.Context) (int64, error) {
	result := r.data.DB.WithContext(ctx).Exec(`
		UPDATE snapshot.project_snapshots
		SET encrypted_envelope = NULL, purged_at = now()
		WHERE encrypted_envelope IS NOT NULL AND expires_at <= now()
	`)
	return result.RowsAffected, result.Error
}

func purgeExpiredSnapshots(ctx context.Context, db *gorm.DB, userID string) error {
	return db.WithContext(ctx).Exec(`
		UPDATE snapshot.project_snapshots
		SET encrypted_envelope = NULL, purged_at = now()
		WHERE user_id = ?::uuid AND encrypted_envelope IS NOT NULL AND expires_at <= now()
	`, userID).Error
}

func projectSnapshotByIdempotencyKey(ctx context.Context, db *gorm.DB, userID, idempotencyKey string) (ProjectSnapshotRow, error) {
	var row ProjectSnapshotRow
	err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, encrypted_envelope, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshots
		WHERE user_id = ?::uuid AND idempotency_key = ? AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
		LIMIT 1
	`, userID, idempotencyKey).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProjectSnapshotRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func projectSnapshotByID(ctx context.Context, db *gorm.DB, userID, snapshotID string, includeEnvelope bool) (ProjectSnapshotRow, error) {
	var row ProjectSnapshotRow
	envelopeColumn := "NULL::bytea AS encrypted_envelope"
	if includeEnvelope {
		envelopeColumn = "encrypted_envelope"
	}
	err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, `+envelopeColumn+`, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshots
		WHERE user_id = ?::uuid AND id = ?::uuid AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
		LIMIT 1
	`, userID, snapshotID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProjectSnapshotRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}
