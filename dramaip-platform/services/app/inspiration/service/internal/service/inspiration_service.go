package service

import (
	"context"

	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/inspiration/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type InspirationService struct {
	inspirationv1.UnimplementedInspirationServiceServer
	uc *biz.MobileDraftUsecase
}

func NewInspirationService(uc *biz.MobileDraftUsecase) *InspirationService {
	return &InspirationService{uc: uc}
}

func (s *InspirationService) UpsertMobileDraft(ctx context.Context, req *inspirationv1.UpsertMobileDraftRequest) (*inspirationv1.UpsertMobileDraftResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	draft, err := s.uc.Upsert(ctx, req.UserId, req.ClientId, req.Kind, req.CaptureMode, req.Title, req.Content, req.AiExpansion)
	if err != nil {
		return nil, err
	}
	return &inspirationv1.UpsertMobileDraftResponse{Draft: reply(draft)}, nil
}

func (s *InspirationService) ListMobileDrafts(ctx context.Context, req *inspirationv1.ListMobileDraftsRequest) (*inspirationv1.ListMobileDraftsResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	drafts, err := s.uc.List(ctx, req.UserId, req.Limit)
	if err != nil {
		return nil, err
	}
	response := &inspirationv1.ListMobileDraftsResponse{Drafts: make([]*inspirationv1.MobileDraft, 0, len(drafts))}
	for _, draft := range drafts {
		response.Drafts = append(response.Drafts, reply(draft))
	}
	return response, nil
}

func (s *InspirationService) RecordMobileDraftAdoption(ctx context.Context, req *inspirationv1.RecordMobileDraftAdoptionRequest) (*inspirationv1.RecordMobileDraftAdoptionResponse, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	draft, err := s.uc.RecordAdoption(ctx, req.UserId, req.DraftId, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return &inspirationv1.RecordMobileDraftAdoptionResponse{Draft: reply(draft)}, nil
}

func reply(draft biz.MobileDraft) *inspirationv1.MobileDraft {
	return &inspirationv1.MobileDraft{Id: draft.ID, ClientId: draft.ClientID, Kind: draft.Kind, CaptureMode: draft.CaptureMode, Title: draft.Title, Content: draft.Content, AiExpansion: draft.AIExpansion, CreatedAt: draft.CreatedAt, UpdatedAt: draft.UpdatedAt}
}
