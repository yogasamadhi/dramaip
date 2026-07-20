// Package data owns opaque encrypted snapshot storage. It must not import the
// Desktop project package or any cryptographic key handling code.
package data

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

const (
	MaxInlineProjectSnapshotBytes   = 8 << 20
	MaxProjectSnapshotBytes         = 64 << 20
	ProjectSnapshotChunkBytes       = 1 << 20
	MaxProjectSnapshotChunks        = MaxProjectSnapshotBytes / ProjectSnapshotChunkBytes
	MaxActiveProjectSnapshots       = 10
	MaxActiveProjectSnapshotUploads = 2
	ProjectSnapshotRetention        = 30 * 24 * time.Hour
	ProjectSnapshotUploadRetention  = 24 * time.Hour
)

var (
	ErrIdempotencyConflict             = errors.New("snapshot idempotency key names a different envelope")
	ErrProjectSnapshotLimitReached     = errors.New("project snapshot limit reached")
	ErrProjectSnapshotUploadLimit      = errors.New("project snapshot upload limit reached")
	ErrProjectSnapshotUploadNotFound   = errors.New("project snapshot upload not found")
	ErrProjectSnapshotChunkConflict    = errors.New("project snapshot chunk names different ciphertext")
	ErrProjectSnapshotUploadIncomplete = errors.New("project snapshot upload is incomplete")
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

type ProjectSnapshotUploadRow struct {
	ID, IdempotencyKey, EncryptedSHA256 string
	EncryptedBytes                      int64
	CreatedAt, ExpiresAt                time.Time
	ReceivedChunkIndexes                []int32
}

type ProjectSnapshotUploadStart struct {
	Snapshot *ProjectSnapshotRow
	Upload   *ProjectSnapshotUploadRow
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
		created, err := createProjectSnapshot(ctx, tx, userID, idempotencyKey, encryptedSHA256, encryptedEnvelope)
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

// StartProjectSnapshotUpload returns a short-lived, user-owned opaque upload.
// A repeat with the same idempotency key either resumes that upload or returns
// the snapshot already created from it.
func (r *ProjectSnapshotRepo) StartProjectSnapshotUpload(ctx context.Context, userID, idempotencyKey string, encryptedBytes int64, encryptedSHA256 string) (ProjectSnapshotUploadStart, error) {
	var result ProjectSnapshotUploadStart
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProjectSnapshotUpload(ctx, tx, userID+":"+idempotencyKey); err != nil {
			return err
		}
		if err := purgeExpiredSnapshots(ctx, tx, userID); err != nil {
			return err
		}
		if err := purgeExpiredProjectSnapshotUploads(ctx, tx, userID); err != nil {
			return err
		}
		existingSnapshot, err := projectSnapshotByIdempotencyKey(ctx, tx, userID, idempotencyKey)
		if err == nil {
			if existingSnapshot.EncryptedSHA256 != encryptedSHA256 || existingSnapshot.EncryptedBytes != encryptedBytes {
				return ErrIdempotencyConflict
			}
			result.Snapshot = &existingSnapshot
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		existingUpload, err := projectSnapshotUploadByIdempotencyKey(ctx, tx, userID, idempotencyKey)
		if err == nil {
			if existingUpload.EncryptedSHA256 != encryptedSHA256 || existingUpload.EncryptedBytes != encryptedBytes {
				return ErrIdempotencyConflict
			}
			result.Upload = &existingUpload
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var activeCount int64
		if err := tx.Raw(`SELECT COUNT(*) FROM snapshot.project_snapshot_uploads WHERE user_id = ?::uuid AND expires_at > now()`, userID).Scan(&activeCount).Error; err != nil {
			return err
		}
		if activeCount >= MaxActiveProjectSnapshotUploads {
			return ErrProjectSnapshotUploadLimit
		}
		id := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO snapshot.project_snapshot_uploads (id, user_id, idempotency_key, encrypted_bytes, encrypted_sha256, expires_at)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, now() + interval '24 hours')
		`, id, userID, idempotencyKey, encryptedBytes, encryptedSHA256).Error; err != nil {
			return err
		}
		created, err := projectSnapshotUploadByID(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		result.Upload = &created
		return nil
	})
	return result, err
}

func (r *ProjectSnapshotRepo) UploadProjectSnapshotChunk(ctx context.Context, userID, uploadID string, chunkIndex int32, encryptedChunkSHA256 string, encryptedChunk []byte) (ProjectSnapshotUploadRow, error) {
	var result ProjectSnapshotUploadRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProjectSnapshotUpload(ctx, tx, uploadID); err != nil {
			return err
		}
		upload, err := projectSnapshotUploadByID(ctx, tx, userID, uploadID)
		if err != nil {
			return err
		}
		expectedChunks := int32((upload.EncryptedBytes + ProjectSnapshotChunkBytes - 1) / ProjectSnapshotChunkBytes)
		if chunkIndex < 0 || chunkIndex >= expectedChunks {
			return ErrProjectSnapshotUploadIncomplete
		}
		expectedBytes := int64(ProjectSnapshotChunkBytes)
		if chunkIndex == expectedChunks-1 {
			expectedBytes = upload.EncryptedBytes - int64(chunkIndex)*ProjectSnapshotChunkBytes
		}
		if int64(len(encryptedChunk)) != expectedBytes || sha256Hex(encryptedChunk) != encryptedChunkSHA256 {
			return ErrProjectSnapshotUploadIncomplete
		}
		existing, err := projectSnapshotUploadChunkSHA256(ctx, tx, uploadID, chunkIndex)
		if err == nil {
			if existing != encryptedChunkSHA256 {
				return ErrProjectSnapshotChunkConflict
			}
			result = upload
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO snapshot.project_snapshot_upload_chunks (upload_id, chunk_index, encrypted_chunk, encrypted_chunk_sha256)
			VALUES (?::uuid, ?, ?, ?)
		`, uploadID, chunkIndex, encryptedChunk, encryptedChunkSHA256).Error; err != nil {
			return err
		}
		updated, err := projectSnapshotUploadByID(ctx, tx, userID, uploadID)
		if err != nil {
			return err
		}
		result = updated
		return nil
	})
	return result, err
}

func (r *ProjectSnapshotRepo) CompleteProjectSnapshotUpload(ctx context.Context, userID, uploadID string) (ProjectSnapshotRow, error) {
	var result ProjectSnapshotRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockProjectSnapshotUpload(ctx, tx, uploadID); err != nil {
			return err
		}
		if err := purgeExpiredSnapshots(ctx, tx, userID); err != nil {
			return err
		}
		upload, err := projectSnapshotUploadByID(ctx, tx, userID, uploadID)
		if err != nil {
			return err
		}
		var chunks []struct {
			ChunkIndex           int32
			EncryptedChunk       []byte
			EncryptedChunkSHA256 string
		}
		if err := tx.Raw(`
			SELECT chunk_index, encrypted_chunk, encrypted_chunk_sha256
			FROM snapshot.project_snapshot_upload_chunks WHERE upload_id = ?::uuid ORDER BY chunk_index
		`, uploadID).Scan(&chunks).Error; err != nil {
			return err
		}
		expectedChunks := int32((upload.EncryptedBytes + ProjectSnapshotChunkBytes - 1) / ProjectSnapshotChunkBytes)
		if len(chunks) != int(expectedChunks) {
			return ErrProjectSnapshotUploadIncomplete
		}
		envelope := make([]byte, 0, upload.EncryptedBytes)
		for index, chunk := range chunks {
			if chunk.ChunkIndex != int32(index) || sha256Hex(chunk.EncryptedChunk) != chunk.EncryptedChunkSHA256 {
				return ErrProjectSnapshotUploadIncomplete
			}
			expectedBytes := int64(ProjectSnapshotChunkBytes)
			if int32(index) == expectedChunks-1 {
				expectedBytes = upload.EncryptedBytes - int64(index)*ProjectSnapshotChunkBytes
			}
			if int64(len(chunk.EncryptedChunk)) != expectedBytes {
				return ErrProjectSnapshotUploadIncomplete
			}
			envelope = append(envelope, chunk.EncryptedChunk...)
		}
		if sha256Hex(envelope) != upload.EncryptedSHA256 {
			return ErrProjectSnapshotUploadIncomplete
		}
		created, err := createProjectSnapshot(ctx, tx, userID, upload.IdempotencyKey, upload.EncryptedSHA256, envelope)
		if err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM snapshot.project_snapshot_uploads WHERE id = ?::uuid`, uploadID).Error; err != nil {
			return err
		}
		result = created
		return nil
	})
	return result, err
}

// PurgeExpiredProjectSnapshots clears ciphertext for every expired record.
// A scheduled domain-owned caller invokes this even when an inactive user no
// longer lists or downloads snapshots; per-user calls still purge eagerly.
func (r *ProjectSnapshotRepo) PurgeExpiredProjectSnapshots(ctx context.Context) (int64, error) {
	var cleared int64
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Exec(`
			UPDATE snapshot.project_snapshots
			SET encrypted_envelope = NULL, purged_at = now()
			WHERE encrypted_envelope IS NOT NULL AND expires_at <= now()
		`)
		if result.Error != nil {
			return result.Error
		}
		cleared = result.RowsAffected
		return purgeExpiredProjectSnapshotUploads(ctx, tx, "")
	})
	return cleared, err
}

func purgeExpiredSnapshots(ctx context.Context, db *gorm.DB, userID string) error {
	return db.WithContext(ctx).Exec(`
		UPDATE snapshot.project_snapshots
		SET encrypted_envelope = NULL, purged_at = now()
		WHERE user_id = ?::uuid AND encrypted_envelope IS NOT NULL AND expires_at <= now()
	`, userID).Error
}

func purgeExpiredProjectSnapshotUploads(ctx context.Context, db *gorm.DB, userID string) error {
	query := `DELETE FROM snapshot.project_snapshot_uploads WHERE expires_at <= now()`
	args := []any{}
	if userID != "" {
		query = `DELETE FROM snapshot.project_snapshot_uploads WHERE user_id = ?::uuid AND expires_at <= now()`
		args = append(args, userID)
	}
	return db.WithContext(ctx).Exec(query, args...).Error
}

// Serialise retries for one opaque upload without exposing its ciphertext to a
// lock key. Collisions can only add harmless waiting; they cannot mix users.
func lockProjectSnapshotUpload(ctx context.Context, db *gorm.DB, key string) error {
	return db.WithContext(ctx).Exec(`SELECT pg_advisory_xact_lock(hashtext(?))`, key).Error
}

func createProjectSnapshot(ctx context.Context, tx *gorm.DB, userID, idempotencyKey, encryptedSHA256 string, encryptedEnvelope []byte) (ProjectSnapshotRow, error) {
	existing, err := projectSnapshotByIdempotencyKey(ctx, tx, userID, idempotencyKey)
	if err == nil {
		if existing.EncryptedSHA256 != encryptedSHA256 {
			return ProjectSnapshotRow{}, ErrIdempotencyConflict
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return ProjectSnapshotRow{}, err
	}
	var activeCount int64
	if err := tx.Raw(`
		SELECT COUNT(*) FROM snapshot.project_snapshots
		WHERE user_id = ?::uuid AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
	`, userID).Scan(&activeCount).Error; err != nil {
		return ProjectSnapshotRow{}, err
	}
	if activeCount >= MaxActiveProjectSnapshots {
		return ProjectSnapshotRow{}, ErrProjectSnapshotLimitReached
	}
	id := platform.NewUUID()
	if err := tx.Exec(`
		INSERT INTO snapshot.project_snapshots
		  (id, user_id, idempotency_key, encrypted_envelope, encrypted_bytes, encrypted_sha256, expires_at)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, now() + interval '30 days')
	`, id, userID, idempotencyKey, encryptedEnvelope, len(encryptedEnvelope), encryptedSHA256).Error; err != nil {
		return ProjectSnapshotRow{}, err
	}
	return projectSnapshotByID(ctx, tx, userID, id, false)
}

func projectSnapshotByIdempotencyKey(ctx context.Context, db *gorm.DB, userID, idempotencyKey string) (ProjectSnapshotRow, error) {
	var row ProjectSnapshotRow
	err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshots
		WHERE user_id = ?::uuid AND idempotency_key = ? AND deleted_at IS NULL AND purged_at IS NULL AND expires_at > now()
		LIMIT 1
	`, userID, idempotencyKey).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProjectSnapshotRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func projectSnapshotUploadByIdempotencyKey(ctx context.Context, db *gorm.DB, userID, idempotencyKey string) (ProjectSnapshotUploadRow, error) {
	var row ProjectSnapshotUploadRow
	err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshot_uploads
		WHERE user_id = ?::uuid AND idempotency_key = ? AND expires_at > now() LIMIT 1
	`, userID, idempotencyKey).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProjectSnapshotUploadRow{}, gorm.ErrRecordNotFound
	}
	indexes, err := projectSnapshotUploadChunkIndexes(ctx, db, row.ID)
	if err != nil {
		return ProjectSnapshotUploadRow{}, err
	}
	row.ReceivedChunkIndexes = indexes
	return row, nil
}

func projectSnapshotUploadByID(ctx context.Context, db *gorm.DB, userID, uploadID string) (ProjectSnapshotUploadRow, error) {
	var row ProjectSnapshotUploadRow
	err := db.WithContext(ctx).Raw(`
		SELECT id::text AS id, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
		FROM snapshot.project_snapshot_uploads
		WHERE user_id = ?::uuid AND id = ?::uuid AND expires_at > now() LIMIT 1
	`, userID, uploadID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ProjectSnapshotUploadRow{}, gorm.ErrRecordNotFound
	}
	indexes, err := projectSnapshotUploadChunkIndexes(ctx, db, row.ID)
	if err != nil {
		return ProjectSnapshotUploadRow{}, err
	}
	row.ReceivedChunkIndexes = indexes
	return row, nil
}

func projectSnapshotUploadChunkIndexes(ctx context.Context, db *gorm.DB, uploadID string) ([]int32, error) {
	var indexes []int32
	err := db.WithContext(ctx).Raw(`
		SELECT chunk_index FROM snapshot.project_snapshot_upload_chunks
		WHERE upload_id = ?::uuid ORDER BY chunk_index
	`, uploadID).Scan(&indexes).Error
	return indexes, err
}

func projectSnapshotUploadChunkSHA256(ctx context.Context, db *gorm.DB, uploadID string, chunkIndex int32) (string, error) {
	var digest string
	err := db.WithContext(ctx).Raw(`
		SELECT encrypted_chunk_sha256 FROM snapshot.project_snapshot_upload_chunks
		WHERE upload_id = ?::uuid AND chunk_index = ?
	`, uploadID, chunkIndex).Scan(&digest).Error
	if err != nil || digest == "" {
		return "", gorm.ErrRecordNotFound
	}
	return digest, nil
}

func sha256Hex(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
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
