package biz

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/snapshot/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`)

type ProjectSnapshotRepository interface {
	Checks() map[string]func(context.Context) error
	CreateProjectSnapshot(context.Context, string, string, string, []byte) (data.ProjectSnapshotRow, error)
	ListProjectSnapshots(context.Context, string) ([]data.ProjectSnapshotRow, error)
	GetProjectSnapshot(context.Context, string, string) (data.ProjectSnapshotRow, error)
	DeleteProjectSnapshot(context.Context, string, string) (time.Time, error)
	StartProjectSnapshotUpload(context.Context, string, string, int64, string) (data.ProjectSnapshotUploadStart, error)
	UploadProjectSnapshotChunk(context.Context, string, string, int32, string, []byte) (data.ProjectSnapshotUploadRow, error)
	CompleteProjectSnapshotUpload(context.Context, string, string) (data.ProjectSnapshotRow, error)
	PurgeExpiredProjectSnapshots(context.Context) (int64, error)
}

type ProjectSnapshotUsecase struct{ repo ProjectSnapshotRepository }

type ProjectSnapshot struct {
	ID, EncryptedSHA256, CreatedAt, ExpiresAt string
	EncryptedBytes                            int64
}

type DownloadedProjectSnapshot struct {
	ProjectSnapshot
	EncryptedEnvelope []byte
}

type ProjectSnapshotUpload struct {
	ID, EncryptedSHA256, CreatedAt, ExpiresAt string
	EncryptedBytes                            int64
	ReceivedChunkIndexes                      []int32
}

type ProjectSnapshotUploadStart struct {
	Snapshot *ProjectSnapshot
	Upload   *ProjectSnapshotUpload
}

func NewProjectSnapshotUsecase(repo ProjectSnapshotRepository) *ProjectSnapshotUsecase {
	return &ProjectSnapshotUsecase{repo: repo}
}
func (u *ProjectSnapshotUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *ProjectSnapshotUsecase) Create(ctx context.Context, userID, idempotencyKey string, envelope []byte) (ProjectSnapshot, error) {
	if strings.TrimSpace(userID) == "" || !idempotencyKeyPattern.MatchString(strings.TrimSpace(idempotencyKey)) || len(envelope) == 0 || len(envelope) > data.MaxInlineProjectSnapshotBytes {
		return ProjectSnapshot{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot")
	}
	digest := sha256.Sum256(envelope)
	row, err := u.repo.CreateProjectSnapshot(ctx, strings.TrimSpace(userID), strings.TrimSpace(idempotencyKey), hex.EncodeToString(digest[:]), envelope)
	if errors.Is(err, data.ErrProjectSnapshotLimitReached) {
		return ProjectSnapshot{}, status.Error(codes.ResourceExhausted, "project_snapshot_limit_reached")
	}
	if errors.Is(err, data.ErrIdempotencyConflict) {
		return ProjectSnapshot{}, status.Error(codes.AlreadyExists, "project_snapshot_idempotency_conflict")
	}
	if err != nil {
		return ProjectSnapshot{}, err
	}
	return projectSnapshotFromRow(row), nil
}

func (u *ProjectSnapshotUsecase) StartUpload(ctx context.Context, userID, idempotencyKey string, encryptedBytes int64, encryptedSHA256 string) (ProjectSnapshotUploadStart, error) {
	if strings.TrimSpace(userID) == "" || !idempotencyKeyPattern.MatchString(strings.TrimSpace(idempotencyKey)) || encryptedBytes <= data.MaxInlineProjectSnapshotBytes || encryptedBytes > data.MaxProjectSnapshotBytes || !validSHA256(encryptedSHA256) {
		return ProjectSnapshotUploadStart{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot_upload")
	}
	start, err := u.repo.StartProjectSnapshotUpload(ctx, strings.TrimSpace(userID), strings.TrimSpace(idempotencyKey), encryptedBytes, strings.TrimSpace(encryptedSHA256))
	if errors.Is(err, data.ErrIdempotencyConflict) {
		return ProjectSnapshotUploadStart{}, status.Error(codes.AlreadyExists, "project_snapshot_idempotency_conflict")
	}
	if errors.Is(err, data.ErrProjectSnapshotUploadLimit) {
		return ProjectSnapshotUploadStart{}, status.Error(codes.ResourceExhausted, "project_snapshot_upload_limit_reached")
	}
	if err != nil {
		return ProjectSnapshotUploadStart{}, err
	}
	result := ProjectSnapshotUploadStart{}
	if start.Snapshot != nil {
		snapshot := projectSnapshotFromRow(*start.Snapshot)
		result.Snapshot = &snapshot
	}
	if start.Upload != nil {
		upload := projectSnapshotUploadFromRow(*start.Upload)
		result.Upload = &upload
	}
	return result, nil
}

func (u *ProjectSnapshotUsecase) UploadChunk(ctx context.Context, userID, uploadID string, chunkIndex int32, encryptedChunkSHA256 string, encryptedChunk []byte) (ProjectSnapshotUpload, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(uploadID) == "" || chunkIndex < 0 || len(encryptedChunk) == 0 || len(encryptedChunk) > data.ProjectSnapshotChunkBytes || !validSHA256(encryptedChunkSHA256) {
		return ProjectSnapshotUpload{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot_chunk")
	}
	upload, err := u.repo.UploadProjectSnapshotChunk(ctx, strings.TrimSpace(userID), strings.TrimSpace(uploadID), chunkIndex, strings.TrimSpace(encryptedChunkSHA256), encryptedChunk)
	if errors.Is(err, data.ErrProjectSnapshotUploadNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
		return ProjectSnapshotUpload{}, status.Error(codes.NotFound, "project_snapshot_upload_not_found")
	}
	if errors.Is(err, data.ErrProjectSnapshotChunkConflict) {
		return ProjectSnapshotUpload{}, status.Error(codes.AlreadyExists, "project_snapshot_chunk_conflict")
	}
	if errors.Is(err, data.ErrProjectSnapshotUploadIncomplete) {
		return ProjectSnapshotUpload{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot_chunk")
	}
	if err != nil {
		return ProjectSnapshotUpload{}, err
	}
	return projectSnapshotUploadFromRow(upload), nil
}

func (u *ProjectSnapshotUsecase) CompleteUpload(ctx context.Context, userID, uploadID string) (ProjectSnapshot, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(uploadID) == "" {
		return ProjectSnapshot{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot_upload")
	}
	snapshot, err := u.repo.CompleteProjectSnapshotUpload(ctx, strings.TrimSpace(userID), strings.TrimSpace(uploadID))
	if errors.Is(err, data.ErrProjectSnapshotUploadNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
		return ProjectSnapshot{}, status.Error(codes.NotFound, "project_snapshot_upload_not_found")
	}
	if errors.Is(err, data.ErrProjectSnapshotUploadIncomplete) {
		return ProjectSnapshot{}, status.Error(codes.FailedPrecondition, "project_snapshot_upload_incomplete")
	}
	if errors.Is(err, data.ErrProjectSnapshotLimitReached) {
		return ProjectSnapshot{}, status.Error(codes.ResourceExhausted, "project_snapshot_limit_reached")
	}
	if err != nil {
		return ProjectSnapshot{}, err
	}
	return projectSnapshotFromRow(snapshot), nil
}

func (u *ProjectSnapshotUsecase) List(ctx context.Context, userID string) ([]ProjectSnapshot, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id_required")
	}
	rows, err := u.repo.ListProjectSnapshots(ctx, strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	items := make([]ProjectSnapshot, 0, len(rows))
	for _, row := range rows {
		items = append(items, projectSnapshotFromRow(row))
	}
	return items, nil
}

func (u *ProjectSnapshotUsecase) Get(ctx context.Context, userID, snapshotID string) (DownloadedProjectSnapshot, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(snapshotID) == "" {
		return DownloadedProjectSnapshot{}, status.Error(codes.InvalidArgument, "invalid_project_snapshot_reference")
	}
	row, err := u.repo.GetProjectSnapshot(ctx, strings.TrimSpace(userID), strings.TrimSpace(snapshotID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DownloadedProjectSnapshot{}, status.Error(codes.NotFound, "project_snapshot_not_found")
	}
	if err != nil {
		return DownloadedProjectSnapshot{}, err
	}
	return DownloadedProjectSnapshot{ProjectSnapshot: projectSnapshotFromRow(row), EncryptedEnvelope: row.EncryptedEnvelope}, nil
}

func (u *ProjectSnapshotUsecase) Delete(ctx context.Context, userID, snapshotID string) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(snapshotID) == "" {
		return "", status.Error(codes.InvalidArgument, "invalid_project_snapshot_reference")
	}
	deletedAt, err := u.repo.DeleteProjectSnapshot(ctx, strings.TrimSpace(userID), strings.TrimSpace(snapshotID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", status.Error(codes.NotFound, "project_snapshot_not_found")
	}
	if err != nil {
		return "", err
	}
	return deletedAt.UTC().Format(time.RFC3339Nano), nil
}

func (u *ProjectSnapshotUsecase) PurgeExpired(ctx context.Context) (int64, error) {
	return u.repo.PurgeExpiredProjectSnapshots(ctx)
}

func projectSnapshotFromRow(row data.ProjectSnapshotRow) ProjectSnapshot {
	return ProjectSnapshot{ID: row.ID, EncryptedBytes: row.EncryptedBytes, EncryptedSHA256: row.EncryptedSHA256, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano), ExpiresAt: row.ExpiresAt.UTC().Format(time.RFC3339Nano)}
}

func projectSnapshotUploadFromRow(row data.ProjectSnapshotUploadRow) ProjectSnapshotUpload {
	return ProjectSnapshotUpload{ID: row.ID, EncryptedBytes: row.EncryptedBytes, EncryptedSHA256: row.EncryptedSHA256, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano), ExpiresAt: row.ExpiresAt.UTC().Format(time.RFC3339Nano), ReceivedChunkIndexes: append([]int32(nil), row.ReceivedChunkIndexes...)}
}

func validSHA256(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'f') || (char >= '0' && char <= '9')) {
			return false
		}
	}
	return true
}
