package data

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

const (
	MaxReviewPackageBytes = int64(512 << 20)
	UploadURLLifetime     = 15 * time.Minute
	DownloadURLLifetime   = 5 * time.Minute
)

var (
	ErrReviewPackageExists       = errors.New("review package already exists")
	ErrReviewStorageExhausted    = errors.New("review workspace storage exhausted")
	ErrReviewUploadIncomplete    = errors.New("review package upload is incomplete")
	ErrReviewIdempotencyConflict = errors.New("review client id names different content")
)

type Data struct {
	DB    *gorm.DB
	User  userv1.UserServiceClient
	Store ObjectStore
	conns []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap, store *S3CompatibleStore) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "review")
	if err != nil {
		return nil, nil, err
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.User.DialTimeout, 3*time.Second))
	defer cancel()
	userConn, err := platform.DialGRPC(dialCtx, cfg.User.GRPCEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	data := &Data{DB: db, User: userv1.NewUserServiceClient(userConn), Store: store, conns: []*grpc.ClientConn{userConn}}
	return data, data.Close, nil
}

func (data *Data) Close() {
	for _, conn := range data.conns {
		_ = conn.Close()
	}
}

type ReviewPackageRow struct {
	ID               string
	WorkspaceID      string
	OwnerUserID      string
	DesktopPackageID string
	Title            string
	Status           string
	ManifestJSON     string
	StorageBytes     int64
	SyncCursor       int64
	ExpiresAt        time.Time
	CreatedAt        time.Time
	PinHash          []byte
}

type ReviewMediaRow struct {
	ID           string
	PackageID    string
	ObjectKey    string
	RelativePath string
	MimeType     string
	SizeBytes    int64
	SHA256       string
	Status       string
}

type ReviewMediaInput struct {
	ID, RelativePath, MimeType, SHA256 string
	SizeBytes                          int64
}

type ReviewCommentRow struct {
	ID, PackageID, ClientID, ShotID, AuthorAlias, Body string
	TimecodeSeconds                                    float64
	Resolved                                           bool
	Cursor                                             int64
	CreatedAt, UpdatedAt                               time.Time
}

type ReviewDecisionRow struct {
	ID, PackageID, ClientID, ShotID, Decision, AuthorAlias, Note string
	Cursor                                                       int64
	CreatedAt                                                    time.Time
}

type ReviewSync struct {
	NextCursor int64
	Comments   []ReviewCommentRow
	Decisions  []ReviewDecisionRow
}

type ReviewRepo struct{ data *Data }

func NewReviewRepo(data *Data) *ReviewRepo { return &ReviewRepo{data: data} }

func (repo *ReviewRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres":     func(ctx context.Context) error { return platform.CheckPostgres(ctx, repo.data.DB) },
		"object_store": repo.data.Store.Check,
	}
}

func (repo *ReviewRepo) ObjectStoreReady() error {
	_, err := repo.data.Store.PresignGet("review/readiness", time.Minute)
	return err
}

func (repo *ReviewRepo) Workspace(ctx context.Context, userID, workspaceID string) (*userv1.Workspace, error) {
	reply, err := repo.data.User.ListWorkspaces(platform.WithUserIdentity(ctx, userID), &userv1.ListWorkspacesRequest{UserId: userID})
	if err != nil {
		return nil, err
	}
	for _, workspace := range reply.Workspaces {
		if workspace.Id == workspaceID {
			return workspace, nil
		}
	}
	return nil, status.Error(codes.PermissionDenied, "workspace membership is required")
}

func (repo *ReviewRepo) CreatePackage(
	ctx context.Context,
	userID, workspaceID, desktopPackageID, title, manifestJSON string,
	tokenHash, pinHash []byte,
	retentionDays int32,
	storageLimit int64,
	media []ReviewMediaInput,
) (ReviewPackageRow, []ReviewMediaRow, error) {
	var packageRow ReviewPackageRow
	var mediaRows []ReviewMediaRow
	totalBytes := int64(0)
	for _, item := range media {
		totalBytes += item.SizeBytes
	}
	err := repo.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext(?))`, "review:"+workspaceID).Error; err != nil {
			return err
		}
		var existing string
		if err := tx.Raw(`
			SELECT id::text FROM review.packages
			WHERE workspace_id = ?::uuid AND desktop_package_id = ? LIMIT 1
		`, workspaceID, desktopPackageID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing != "" {
			return ErrReviewPackageExists
		}
		var activeBytes int64
		if err := tx.Raw(`
			SELECT COALESCE(sum(storage_bytes), 0)
			FROM review.packages
			WHERE workspace_id = ?::uuid AND status IN ('uploading', 'published') AND expires_at > now()
		`, workspaceID).Scan(&activeBytes).Error; err != nil {
			return err
		}
		if storageLimit <= 0 || activeBytes+totalBytes > storageLimit {
			return ErrReviewStorageExhausted
		}
		packageID := platform.NewUUID()
		expiresAt := time.Now().UTC().Add(time.Duration(retentionDays) * 24 * time.Hour)
		if err := tx.Exec(`
			INSERT INTO review.packages (
			  id, workspace_id, owner_user_id, desktop_package_id, title, token_hash,
			  pin_hash, status, manifest, storage_bytes, expires_at
			) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, NULLIF(?::bytea, ''::bytea), 'uploading', ?::jsonb, ?, ?)
		`, packageID, workspaceID, userID, desktopPackageID, title, tokenHash, pinHash, manifestJSON, totalBytes, expiresAt).Error; err != nil {
			return err
		}
		for _, item := range media {
			mediaID := platform.NewUUID()
			objectKey := fmt.Sprintf("review/%s/%s/%s", workspaceID, packageID, mediaID)
			if err := tx.Exec(`
				INSERT INTO review.media_objects (
				  id, package_id, object_key, relative_path, mime_type, size_bytes, sha256
				) VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?)
			`, mediaID, packageID, objectKey, item.RelativePath, item.MimeType, item.SizeBytes, item.SHA256).Error; err != nil {
				return err
			}
		}
		loaded, err := loadReviewPackage(tx, packageID)
		if err != nil {
			return err
		}
		loadedMedia, err := loadReviewMedia(tx, packageID)
		if err != nil {
			return err
		}
		packageRow, mediaRows = loaded, loadedMedia
		return nil
	})
	return packageRow, mediaRows, err
}

func (repo *ReviewRepo) UploadTarget(ctx context.Context, userID, packageID, mediaID string) (ReviewMediaRow, SignedObjectURL, error) {
	packageRow, err := repo.packageForUser(ctx, userID, packageID)
	if err != nil {
		return ReviewMediaRow{}, SignedObjectURL{}, err
	}
	if packageRow.Status != "uploading" || !packageRow.ExpiresAt.After(time.Now().UTC()) {
		return ReviewMediaRow{}, SignedObjectURL{}, status.Error(codes.FailedPrecondition, "review package is not accepting uploads")
	}
	var media ReviewMediaRow
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, package_id::text AS package_id, object_key, relative_path,
		       mime_type, size_bytes, sha256, upload_status AS status
		FROM review.media_objects WHERE package_id = ?::uuid AND id = ?::uuid LIMIT 1
	`, packageID, mediaID).Scan(&media).Error; err != nil {
		return ReviewMediaRow{}, SignedObjectURL{}, err
	}
	if media.ID == "" {
		return ReviewMediaRow{}, SignedObjectURL{}, status.Error(codes.NotFound, "review media not found")
	}
	signed, err := repo.PresignUpload(media)
	return media, signed, err
}

func (repo *ReviewRepo) PresignUpload(media ReviewMediaRow) (SignedObjectURL, error) {
	return repo.data.Store.PresignPut(media.ObjectKey, media.MimeType, media.SHA256, UploadURLLifetime)
}

func (repo *ReviewRepo) CompletePackage(ctx context.Context, userID, packageID string) (ReviewPackageRow, []ReviewMediaRow, error) {
	packageRow, err := repo.packageForUser(ctx, userID, packageID)
	if err != nil {
		return ReviewPackageRow{}, nil, err
	}
	if packageRow.Status == "published" {
		media, err := repo.Media(ctx, packageID)
		return packageRow, media, err
	}
	if packageRow.Status != "uploading" || !packageRow.ExpiresAt.After(time.Now().UTC()) {
		return ReviewPackageRow{}, nil, status.Error(codes.FailedPrecondition, "review package cannot be completed")
	}
	media, err := repo.Media(ctx, packageID)
	if err != nil {
		return ReviewPackageRow{}, nil, err
	}
	for _, item := range media {
		if err := repo.data.Store.Verify(ctx, item.ObjectKey, item.SizeBytes, item.SHA256); err != nil {
			return ReviewPackageRow{}, nil, fmt.Errorf("%w: %v", ErrReviewUploadIncomplete, err)
		}
	}
	err = repo.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`UPDATE review.media_objects SET upload_status = 'complete' WHERE package_id = ?::uuid`, packageID).Error; err != nil {
			return err
		}
		result := tx.Exec(`
			UPDATE review.packages SET status = 'published', updated_at = now()
			WHERE id = ?::uuid AND status = 'uploading' AND expires_at > now()
		`, packageID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return status.Error(codes.FailedPrecondition, "review package changed while completing")
		}
		return nil
	})
	if err != nil {
		return ReviewPackageRow{}, nil, err
	}
	packageRow, err = repo.Package(ctx, packageID)
	if err != nil {
		return ReviewPackageRow{}, nil, err
	}
	media, err = repo.Media(ctx, packageID)
	return packageRow, media, err
}

func (repo *ReviewRepo) Package(ctx context.Context, packageID string) (ReviewPackageRow, error) {
	return loadReviewPackage(repo.data.DB.WithContext(ctx), packageID)
}

func (repo *ReviewRepo) Media(ctx context.Context, packageID string) ([]ReviewMediaRow, error) {
	return loadReviewMedia(repo.data.DB.WithContext(ctx), packageID)
}

func (repo *ReviewRepo) PublicPackage(ctx context.Context, tokenHash []byte) (ReviewPackageRow, []ReviewMediaRow, error) {
	var packageRow ReviewPackageRow
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, workspace_id::text AS workspace_id, owner_user_id::text AS owner_user_id,
		       desktop_package_id, title, status, manifest::text AS manifest_json, storage_bytes,
		       sync_cursor, expires_at, created_at, COALESCE(pin_hash, ''::bytea) AS pin_hash
		FROM review.packages WHERE token_hash = ? LIMIT 1
	`, tokenHash).Scan(&packageRow).Error; err != nil {
		return ReviewPackageRow{}, nil, err
	}
	if packageRow.ID == "" || packageRow.Status != "published" || !packageRow.ExpiresAt.After(time.Now().UTC()) {
		return ReviewPackageRow{}, nil, status.Error(codes.NotFound, "review package not found")
	}
	if err := repo.enforcePublicRateLimit(ctx, packageRow.ID); err != nil {
		return ReviewPackageRow{}, nil, err
	}
	media, err := repo.Media(ctx, packageRow.ID)
	return packageRow, media, err
}

func (repo *ReviewRepo) DownloadTarget(item ReviewMediaRow) (SignedObjectURL, error) {
	return repo.data.Store.PresignGet(item.ObjectKey, DownloadURLLifetime)
}

func (repo *ReviewRepo) SyncPackage(ctx context.Context, userID, packageID string, afterCursor int64) (ReviewSync, error) {
	if _, err := repo.packageForUser(ctx, userID, packageID); err != nil {
		return ReviewSync{}, err
	}
	var result ReviewSync
	if err := repo.data.DB.WithContext(ctx).Raw(`SELECT sync_cursor FROM review.packages WHERE id = ?::uuid`, packageID).Scan(&result.NextCursor).Error; err != nil {
		return ReviewSync{}, err
	}
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, package_id::text AS package_id, client_id,
		       COALESCE(shot_id, '') AS shot_id, COALESCE(timecode_seconds, 0)::float8 AS timecode_seconds,
		       COALESCE(author_alias, '') AS author_alias, body, resolved, cursor, created_at, updated_at
		FROM review.comments WHERE package_id = ?::uuid AND cursor > ? ORDER BY cursor
	`, packageID, afterCursor).Scan(&result.Comments).Error; err != nil {
		return ReviewSync{}, err
	}
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, package_id::text AS package_id, client_id,
		       COALESCE(shot_id, '') AS shot_id, decision, COALESCE(author_alias, '') AS author_alias,
		       COALESCE(note, '') AS note, cursor, created_at
		FROM review.decisions WHERE package_id = ?::uuid AND cursor > ? ORDER BY cursor
	`, packageID, afterCursor).Scan(&result.Decisions).Error; err != nil {
		return ReviewSync{}, err
	}
	return result, nil
}

func (repo *ReviewRepo) SubmitComment(ctx context.Context, packageID, clientID, shotID string, timecode float64, author, body string) (ReviewCommentRow, error) {
	var result ReviewCommentRow
	err := repo.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing ReviewCommentRow
		if err := tx.Raw(`
			SELECT id::text AS id, package_id::text AS package_id, client_id,
			       COALESCE(shot_id, '') AS shot_id, COALESCE(timecode_seconds, 0)::float8 AS timecode_seconds,
			       COALESCE(author_alias, '') AS author_alias, body, resolved, cursor, created_at, updated_at
			FROM review.comments WHERE package_id = ?::uuid AND client_id = ? LIMIT 1
		`, packageID, clientID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			if existing.ShotID != shotID || existing.TimecodeSeconds != timecode || existing.AuthorAlias != author || existing.Body != body {
				return ErrReviewIdempotencyConflict
			}
			result = existing
			return nil
		}
		cursor, err := nextCursor(tx, packageID)
		if err != nil {
			return err
		}
		id := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO review.comments (
			  id, package_id, client_id, shot_id, timecode_seconds, author_alias, body, cursor
			) VALUES (?::uuid, ?::uuid, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?)
		`, id, packageID, clientID, shotID, timecode, author, body, cursor).Error; err != nil {
			return err
		}
		var loadErr error
		result, loadErr = loadReviewComment(tx, packageID, clientID)
		return loadErr
	})
	return result, err
}

func (repo *ReviewRepo) SubmitDecision(ctx context.Context, packageID, clientID, shotID, decision, author, note string) (ReviewDecisionRow, error) {
	var result ReviewDecisionRow
	err := repo.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing ReviewDecisionRow
		if err := tx.Raw(`
			SELECT id::text AS id, package_id::text AS package_id, client_id,
			       COALESCE(shot_id, '') AS shot_id, decision, COALESCE(author_alias, '') AS author_alias,
			       COALESCE(note, '') AS note, cursor, created_at
			FROM review.decisions WHERE package_id = ?::uuid AND client_id = ? LIMIT 1
		`, packageID, clientID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			if existing.ShotID != shotID || existing.Decision != decision || existing.AuthorAlias != author || existing.Note != note {
				return ErrReviewIdempotencyConflict
			}
			result = existing
			return nil
		}
		cursor, err := nextCursor(tx, packageID)
		if err != nil {
			return err
		}
		id := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO review.decisions (
			  id, package_id, client_id, shot_id, decision, author_alias, note, cursor
			) VALUES (?::uuid, ?::uuid, ?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?)
		`, id, packageID, clientID, shotID, decision, author, note, cursor).Error; err != nil {
			return err
		}
		var loadErr error
		result, loadErr = loadReviewDecision(tx, packageID, clientID)
		return loadErr
	})
	return result, err
}

func (repo *ReviewRepo) DeletePackage(ctx context.Context, userID, packageID string) error {
	packageRow, err := repo.packageForUser(ctx, userID, packageID)
	if err != nil {
		return err
	}
	return repo.deletePackage(ctx, packageRow)
}

func (repo *ReviewRepo) deletePackage(ctx context.Context, packageRow ReviewPackageRow) error {
	packageID := packageRow.ID
	media, err := repo.Media(ctx, packageID)
	if err != nil {
		return err
	}
	if err := repo.data.DB.WithContext(ctx).Exec(`
		UPDATE review.packages SET status = 'deleting', revoked_at = COALESCE(revoked_at, now()), updated_at = now()
		WHERE id = ?::uuid AND status <> 'deleted'
	`, packageID).Error; err != nil {
		return err
	}
	for _, item := range media {
		if err := repo.data.Store.Delete(ctx, item.ObjectKey); err != nil {
			return err
		}
	}
	replacementHash := sha256.Sum256([]byte(platform.NewUUID() + platform.NewUUID()))
	return repo.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`DELETE FROM review.media_objects WHERE package_id = ?::uuid`, packageID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			UPDATE review.packages
			SET status = 'deleted', title = 'deleted', manifest = '{}'::jsonb, pin_hash = NULL,
			    token_hash = ?, desktop_package_id = 'deleted:' || id::text,
			    storage_bytes = 0, deleted_at = now(), updated_at = now()
			WHERE id = ?::uuid AND workspace_id = ?::uuid
		`, replacementHash[:], packageID, packageRow.WorkspaceID).Error
	})
}

func (repo *ReviewRepo) PurgeExpired(ctx context.Context) (int, error) {
	var packages []ReviewPackageRow
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, owner_user_id::text AS owner_user_id
		FROM review.packages
		WHERE expires_at <= now() AND status IN ('uploading', 'published', 'revoked', 'failed')
		ORDER BY expires_at LIMIT 100
	`).Scan(&packages).Error; err != nil {
		return 0, err
	}
	cleared := 0
	for _, packageRow := range packages {
		loaded, err := repo.Package(ctx, packageRow.ID)
		if err != nil {
			return cleared, err
		}
		if err := repo.deletePackage(ctx, loaded); err != nil {
			return cleared, err
		}
		cleared++
	}
	return cleared, nil
}

func (repo *ReviewRepo) packageForUser(ctx context.Context, userID, packageID string) (ReviewPackageRow, error) {
	packageRow, err := repo.Package(ctx, packageID)
	if err != nil {
		return ReviewPackageRow{}, err
	}
	if _, err := repo.Workspace(ctx, userID, packageRow.WorkspaceID); err != nil {
		return ReviewPackageRow{}, err
	}
	return packageRow, nil
}

func (repo *ReviewRepo) enforcePublicRateLimit(ctx context.Context, packageID string) error {
	var attempts int64
	if err := repo.data.DB.WithContext(ctx).Raw(`
		SELECT count(*) FROM review.access_audit
		WHERE package_id = ?::uuid AND occurred_at > now() - interval '1 minute'
	`, packageID).Scan(&attempts).Error; err != nil {
		return err
	}
	if attempts >= 120 {
		return status.Error(codes.ResourceExhausted, "review access rate limit reached")
	}
	return repo.data.DB.WithContext(ctx).Exec(`
		INSERT INTO review.access_audit (id, package_id, action, result)
		VALUES (?::uuid, ?::uuid, 'public_access', 'allowed')
	`, platform.NewUUID(), packageID).Error
}

func loadReviewPackage(db *gorm.DB, packageID string) (ReviewPackageRow, error) {
	var row ReviewPackageRow
	err := db.Raw(`
		SELECT id::text AS id, workspace_id::text AS workspace_id, owner_user_id::text AS owner_user_id,
		       desktop_package_id, title, status, manifest::text AS manifest_json, storage_bytes,
		       sync_cursor, expires_at, created_at, COALESCE(pin_hash, ''::bytea) AS pin_hash
		FROM review.packages WHERE id = ?::uuid LIMIT 1
	`, packageID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return ReviewPackageRow{}, status.Error(codes.NotFound, "review package not found")
	}
	return row, nil
}

func loadReviewMedia(db *gorm.DB, packageID string) ([]ReviewMediaRow, error) {
	var rows []ReviewMediaRow
	err := db.Raw(`
		SELECT id::text AS id, package_id::text AS package_id, object_key, relative_path,
		       mime_type, size_bytes, sha256, upload_status AS status
		FROM review.media_objects WHERE package_id = ?::uuid ORDER BY relative_path, id
	`, packageID).Scan(&rows).Error
	return rows, err
}

func nextCursor(tx *gorm.DB, packageID string) (int64, error) {
	var cursor int64
	err := tx.Raw(`
		UPDATE review.packages SET sync_cursor = sync_cursor + 1, updated_at = now()
		WHERE id = ?::uuid AND status = 'published' AND expires_at > now()
		RETURNING sync_cursor
	`, packageID).Scan(&cursor).Error
	if err != nil {
		return 0, err
	}
	if cursor == 0 {
		return 0, status.Error(codes.FailedPrecondition, "review package is not active")
	}
	return cursor, nil
}

func loadReviewComment(tx *gorm.DB, packageID, clientID string) (ReviewCommentRow, error) {
	var row ReviewCommentRow
	err := tx.Raw(`
		SELECT id::text AS id, package_id::text AS package_id, client_id,
		       COALESCE(shot_id, '') AS shot_id, COALESCE(timecode_seconds, 0)::float8 AS timecode_seconds,
		       COALESCE(author_alias, '') AS author_alias, body, resolved, cursor, created_at, updated_at
		FROM review.comments WHERE package_id = ?::uuid AND client_id = ? LIMIT 1
	`, packageID, clientID).Scan(&row).Error
	return row, err
}

func loadReviewDecision(tx *gorm.DB, packageID, clientID string) (ReviewDecisionRow, error) {
	var row ReviewDecisionRow
	err := tx.Raw(`
		SELECT id::text AS id, package_id::text AS package_id, client_id,
		       COALESCE(shot_id, '') AS shot_id, decision, COALESCE(author_alias, '') AS author_alias,
		       COALESCE(note, '') AS note, cursor, created_at
		FROM review.decisions WHERE package_id = ?::uuid AND client_id = ? LIMIT 1
	`, packageID, clientID).Scan(&row).Error
	return row, err
}
