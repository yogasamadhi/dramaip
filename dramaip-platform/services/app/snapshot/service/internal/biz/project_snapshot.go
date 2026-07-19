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

func NewProjectSnapshotUsecase(repo ProjectSnapshotRepository) *ProjectSnapshotUsecase {
	return &ProjectSnapshotUsecase{repo: repo}
}
func (u *ProjectSnapshotUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *ProjectSnapshotUsecase) Create(ctx context.Context, userID, idempotencyKey string, envelope []byte) (ProjectSnapshot, error) {
	if strings.TrimSpace(userID) == "" || !idempotencyKeyPattern.MatchString(strings.TrimSpace(idempotencyKey)) || len(envelope) == 0 || len(envelope) > data.MaxProjectSnapshotBytes {
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
