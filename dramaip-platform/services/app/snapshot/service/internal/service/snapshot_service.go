package service

import (
	"context"

	snapshotv1 "github.com/dramaip/dramaip-platform/services/api/snapshot/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/snapshot/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type SnapshotService struct {
	snapshotv1.UnimplementedSnapshotServiceServer
	uc *biz.ProjectSnapshotUsecase
}

func NewSnapshotService(uc *biz.ProjectSnapshotUsecase) *SnapshotService {
	return &SnapshotService{uc: uc}
}

func (s *SnapshotService) CreateProjectSnapshot(ctx context.Context, req *snapshotv1.CreateProjectSnapshotRequest) (*snapshotv1.CreateProjectSnapshotResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	snapshot, err := s.uc.Create(ctx, req.UserId, req.IdempotencyKey, req.EncryptedEnvelope)
	if err != nil {
		return nil, err
	}
	return &snapshotv1.CreateProjectSnapshotResponse{Snapshot: reply(snapshot)}, nil
}

func (s *SnapshotService) StartProjectSnapshotUpload(ctx context.Context, req *snapshotv1.StartProjectSnapshotUploadRequest) (*snapshotv1.StartProjectSnapshotUploadResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	start, err := s.uc.StartUpload(ctx, req.UserId, req.IdempotencyKey, req.EncryptedBytes, req.EncryptedSha256)
	if err != nil {
		return nil, err
	}
	reply := &snapshotv1.StartProjectSnapshotUploadResponse{}
	if start.Snapshot != nil {
		reply.Snapshot = replySnapshot(*start.Snapshot)
	}
	if start.Upload != nil {
		reply.Upload = replyUpload(*start.Upload)
	}
	return reply, nil
}

func (s *SnapshotService) UploadProjectSnapshotChunk(ctx context.Context, req *snapshotv1.UploadProjectSnapshotChunkRequest) (*snapshotv1.UploadProjectSnapshotChunkResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	upload, err := s.uc.UploadChunk(ctx, req.UserId, req.UploadId, req.ChunkIndex, req.EncryptedChunkSha256, req.EncryptedChunk)
	if err != nil {
		return nil, err
	}
	return &snapshotv1.UploadProjectSnapshotChunkResponse{Upload: replyUpload(upload)}, nil
}

func (s *SnapshotService) CompleteProjectSnapshotUpload(ctx context.Context, req *snapshotv1.CompleteProjectSnapshotUploadRequest) (*snapshotv1.CompleteProjectSnapshotUploadResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	snapshot, err := s.uc.CompleteUpload(ctx, req.UserId, req.UploadId)
	if err != nil {
		return nil, err
	}
	return &snapshotv1.CompleteProjectSnapshotUploadResponse{Snapshot: replySnapshot(snapshot)}, nil
}

func (s *SnapshotService) ListProjectSnapshots(ctx context.Context, req *snapshotv1.ListProjectSnapshotsRequest) (*snapshotv1.ListProjectSnapshotsResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	snapshots, err := s.uc.List(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	reply := &snapshotv1.ListProjectSnapshotsResponse{Snapshots: make([]*snapshotv1.ProjectSnapshot, 0, len(snapshots))}
	for _, snapshot := range snapshots {
		reply.Snapshots = append(reply.Snapshots, replySnapshot(snapshot))
	}
	return reply, nil
}

func (s *SnapshotService) GetProjectSnapshot(ctx context.Context, req *snapshotv1.GetProjectSnapshotRequest) (*snapshotv1.GetProjectSnapshotResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	snapshot, err := s.uc.Get(ctx, req.UserId, req.SnapshotId)
	if err != nil {
		return nil, err
	}
	return &snapshotv1.GetProjectSnapshotResponse{Snapshot: replySnapshot(snapshot.ProjectSnapshot), EncryptedEnvelope: snapshot.EncryptedEnvelope}, nil
}

func (s *SnapshotService) DeleteProjectSnapshot(ctx context.Context, req *snapshotv1.DeleteProjectSnapshotRequest) (*snapshotv1.DeleteProjectSnapshotResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	deletedAt, err := s.uc.Delete(ctx, req.UserId, req.SnapshotId)
	if err != nil {
		return nil, err
	}
	return &snapshotv1.DeleteProjectSnapshotResponse{SnapshotId: req.SnapshotId, DeletedAt: deletedAt}, nil
}

func reply(snapshot biz.ProjectSnapshot) *snapshotv1.ProjectSnapshot { return replySnapshot(snapshot) }
func replySnapshot(snapshot biz.ProjectSnapshot) *snapshotv1.ProjectSnapshot {
	return &snapshotv1.ProjectSnapshot{Id: snapshot.ID, EncryptedBytes: snapshot.EncryptedBytes, EncryptedSha256: snapshot.EncryptedSHA256, CreatedAt: snapshot.CreatedAt, ExpiresAt: snapshot.ExpiresAt}
}

func replyUpload(upload biz.ProjectSnapshotUpload) *snapshotv1.ProjectSnapshotUpload {
	return &snapshotv1.ProjectSnapshotUpload{Id: upload.ID, EncryptedBytes: upload.EncryptedBytes, EncryptedSha256: upload.EncryptedSHA256, CreatedAt: upload.CreatedAt, ExpiresAt: upload.ExpiresAt, ReceivedChunkIndexes: upload.ReceivedChunkIndexes}
}
