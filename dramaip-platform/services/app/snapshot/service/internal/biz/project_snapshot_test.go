package biz

import (
	"context"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/snapshot/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

func TestProjectSnapshotUsecaseHashesOpaqueEnvelopeAndMapsBoundaryErrors(t *testing.T) {
	repo := &fakeProjectSnapshotRepo{row: snapshotRow()}
	uc := NewProjectSnapshotUsecase(repo)
	snapshot, err := uc.Create(context.Background(), "user-1", "snapshot-upload-0001", []byte("opaque encrypted envelope"))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ID != "snapshot-1" || repo.userID != "user-1" || repo.idempotencyKey != "snapshot-upload-0001" || repo.encryptedSHA256 != "06a146bd327d5e60a5834700fab103ac715af562c29496f3fe05a34186d1ef40" {
		t.Fatalf("create boundary = %#v repo=%#v", snapshot, repo)
	}

	repo.err = data.ErrProjectSnapshotLimitReached
	_, err = uc.Create(context.Background(), "user-1", "snapshot-upload-0002", []byte("another envelope"))
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("limit code = %v, want %v", status.Code(err), codes.ResourceExhausted)
	}
	repo.err = data.ErrIdempotencyConflict
	_, err = uc.Create(context.Background(), "user-1", "snapshot-upload-0003", []byte("another envelope"))
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("conflict code = %v, want %v", status.Code(err), codes.AlreadyExists)
	}
}

func TestProjectSnapshotUsecaseRejectsInvalidRequestsAndDeletedDownloads(t *testing.T) {
	repo := &fakeProjectSnapshotRepo{err: gorm.ErrRecordNotFound}
	uc := NewProjectSnapshotUsecase(repo)
	for _, input := range []struct {
		user, key string
		body      []byte
	}{{"", "snapshot-upload-0001", []byte("x")}, {"user", "short", []byte("x")}, {"user", "snapshot-upload-0001", nil}, {"user", "snapshot-upload-0001", make([]byte, data.MaxProjectSnapshotBytes+1)}} {
		if _, err := uc.Create(context.Background(), input.user, input.key, input.body); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("invalid input code = %v", status.Code(err))
		}
	}
	if _, err := uc.Get(context.Background(), "user-1", "snapshot-1"); status.Code(err) != codes.NotFound {
		t.Fatalf("get deleted code = %v, want %v", status.Code(err), codes.NotFound)
	}
	if _, err := uc.Delete(context.Background(), "user-1", "snapshot-1"); status.Code(err) != codes.NotFound {
		t.Fatalf("delete deleted code = %v, want %v", status.Code(err), codes.NotFound)
	}
}

func TestProjectSnapshotUsecaseAcceptsOnlyBoundedResumableCiphertext(t *testing.T) {
	repo := &fakeProjectSnapshotRepo{row: snapshotRow()}
	uc := NewProjectSnapshotUsecase(repo)
	const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	start, err := uc.StartUpload(context.Background(), "user-1", "snapshot-resume-0001", data.MaxInlineProjectSnapshotBytes+1, digest)
	if err != nil || start.Upload == nil || start.Upload.ID != "upload-1" {
		t.Fatalf("start = %#v, %v", start, err)
	}
	if _, err := uc.UploadChunk(context.Background(), "user-1", "upload-1", 0, digest, []byte("opaque")); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("short chunk code = %v", status.Code(err))
	}
	chunk := make([]byte, data.ProjectSnapshotChunkBytes)
	if _, err := uc.UploadChunk(context.Background(), "user-1", "upload-1", 0, digest, chunk); err != nil {
		t.Fatalf("chunk = %v", err)
	}
	if _, err := uc.CompleteUpload(context.Background(), "user-1", "upload-1"); err != nil {
		t.Fatalf("complete = %v", err)
	}
	if _, err := uc.StartUpload(context.Background(), "user-1", "snapshot-resume-0001", data.MaxInlineProjectSnapshotBytes, digest); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("inline upload code = %v", status.Code(err))
	}
}

type fakeProjectSnapshotRepo struct {
	row                                     data.ProjectSnapshotRow
	err                                     error
	userID, idempotencyKey, encryptedSHA256 string
}

func (f *fakeProjectSnapshotRepo) Checks() map[string]func(context.Context) error { return nil }
func (f *fakeProjectSnapshotRepo) CreateProjectSnapshot(_ context.Context, userID, idempotencyKey, encryptedSHA256 string, _ []byte) (data.ProjectSnapshotRow, error) {
	f.userID, f.idempotencyKey, f.encryptedSHA256 = userID, idempotencyKey, encryptedSHA256
	if f.err != nil {
		return data.ProjectSnapshotRow{}, f.err
	}
	return f.row, nil
}
func (f *fakeProjectSnapshotRepo) ListProjectSnapshots(context.Context, string) ([]data.ProjectSnapshotRow, error) {
	if f.err != nil {
		return nil, f.err
	}
	return []data.ProjectSnapshotRow{f.row}, nil
}
func (f *fakeProjectSnapshotRepo) GetProjectSnapshot(context.Context, string, string) (data.ProjectSnapshotRow, error) {
	if f.err != nil {
		return data.ProjectSnapshotRow{}, f.err
	}
	return f.row, nil
}
func (f *fakeProjectSnapshotRepo) DeleteProjectSnapshot(context.Context, string, string) (time.Time, error) {
	if f.err != nil {
		return time.Time{}, f.err
	}
	return time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC), nil
}
func (f *fakeProjectSnapshotRepo) StartProjectSnapshotUpload(_ context.Context, _ string, _ string, encryptedBytes int64, encryptedSHA256 string) (data.ProjectSnapshotUploadStart, error) {
	if f.err != nil {
		return data.ProjectSnapshotUploadStart{}, f.err
	}
	upload := data.ProjectSnapshotUploadRow{ID: "upload-1", EncryptedBytes: encryptedBytes, EncryptedSHA256: encryptedSHA256, CreatedAt: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2026, 7, 21, 0, 0, 0, 0, time.UTC)}
	return data.ProjectSnapshotUploadStart{Upload: &upload}, nil
}
func (f *fakeProjectSnapshotRepo) UploadProjectSnapshotChunk(_ context.Context, _ string, _ string, _ int32, encryptedChunkSHA256 string, encryptedChunk []byte) (data.ProjectSnapshotUploadRow, error) {
	if f.err != nil {
		return data.ProjectSnapshotUploadRow{}, f.err
	}
	if len(encryptedChunk) != data.ProjectSnapshotChunkBytes {
		return data.ProjectSnapshotUploadRow{}, data.ErrProjectSnapshotUploadIncomplete
	}
	return data.ProjectSnapshotUploadRow{ID: "upload-1", EncryptedBytes: data.MaxInlineProjectSnapshotBytes + 1, EncryptedSHA256: encryptedChunkSHA256, ReceivedChunkIndexes: []int32{0}, CreatedAt: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2026, 7, 21, 0, 0, 0, 0, time.UTC)}, nil
}
func (f *fakeProjectSnapshotRepo) CompleteProjectSnapshotUpload(context.Context, string, string) (data.ProjectSnapshotRow, error) {
	if f.err != nil {
		return data.ProjectSnapshotRow{}, f.err
	}
	return f.row, nil
}
func (f *fakeProjectSnapshotRepo) PurgeExpiredProjectSnapshots(context.Context) (int64, error) {
	return 0, f.err
}

func snapshotRow() data.ProjectSnapshotRow {
	return data.ProjectSnapshotRow{ID: "snapshot-1", EncryptedBytes: 23, EncryptedSHA256: "9a09d17f5a34ce4e7b3f567f78b8a3e91e4e80653e259ab974cb2ed56ae7c5bb", CreatedAt: time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC)}
}
