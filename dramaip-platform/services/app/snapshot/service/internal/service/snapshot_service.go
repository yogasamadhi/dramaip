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
