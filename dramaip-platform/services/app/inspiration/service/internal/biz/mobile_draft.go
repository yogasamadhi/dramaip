package biz

import (
	"context"
	"errors"
	"strings"

	"github.com/dramaip/dramaip-platform/services/app/inspiration/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type MobileDraftRepository interface {
	Checks() map[string]func(context.Context) error
	UpsertMobileDraft(context.Context, string, string, string, string, string, string, string) (data.MobileDraftRow, error)
	ListMobileDrafts(context.Context, string, int32) ([]data.MobileDraftRow, error)
	RecordMobileDraftAdoption(context.Context, string, string, string) (data.MobileDraftRow, error)
}

type MobileDraftUsecase struct{ repo MobileDraftRepository }

type MobileDraft struct {
	ID, ClientID, Kind, CaptureMode, Title, Content, AIExpansion, CreatedAt, UpdatedAt string
}

func NewMobileDraftUsecase(repo MobileDraftRepository) *MobileDraftUsecase {
	return &MobileDraftUsecase{repo: repo}
}
func (u *MobileDraftUsecase) Checks() map[string]func(context.Context) error { return u.repo.Checks() }

func (u *MobileDraftUsecase) Upsert(ctx context.Context, userID, clientID, kind, captureMode, title, content, aiExpansion string) (MobileDraft, error) {
	userID, clientID, kind, captureMode = strings.TrimSpace(userID), strings.TrimSpace(clientID), strings.TrimSpace(kind), strings.TrimSpace(captureMode)
	title, content, aiExpansion = strings.TrimSpace(title), strings.TrimSpace(content), strings.TrimSpace(aiExpansion)
	if userID == "" || !validClientID(clientID) || !validKind(kind) || !validCaptureMode(captureMode) || title == "" || content == "" || len(title) > 120 || len(content) > 3_000 || len(aiExpansion) > 2_400 {
		return MobileDraft{}, status.Error(codes.InvalidArgument, "invalid_mobile_draft")
	}
	row, err := u.repo.UpsertMobileDraft(ctx, userID, clientID, kind, captureMode, title, content, aiExpansion)
	if err != nil {
		return MobileDraft{}, err
	}
	return mobileDraftFromRow(row), nil
}

func (u *MobileDraftUsecase) List(ctx context.Context, userID string, limit int32) ([]MobileDraft, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id_required")
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := u.repo.ListMobileDrafts(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	drafts := make([]MobileDraft, 0, len(rows))
	for _, row := range rows {
		drafts = append(drafts, mobileDraftFromRow(row))
	}
	return drafts, nil
}

func (u *MobileDraftUsecase) RecordAdoption(ctx context.Context, userID, draftID, idempotencyKey string) (MobileDraft, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(draftID) == "" || !validClientID(idempotencyKey) {
		return MobileDraft{}, status.Error(codes.InvalidArgument, "invalid_mobile_draft_adoption")
	}
	row, err := u.repo.RecordMobileDraftAdoption(ctx, strings.TrimSpace(userID), strings.TrimSpace(draftID), strings.TrimSpace(idempotencyKey))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MobileDraft{}, status.Error(codes.NotFound, "mobile_draft_not_found")
	}
	if err != nil {
		return MobileDraft{}, err
	}
	return mobileDraftFromRow(row), nil
}

func mobileDraftFromRow(row data.MobileDraftRow) MobileDraft {
	return MobileDraft{ID: row.ID, ClientID: row.ClientID, Kind: row.Kind, CaptureMode: row.CaptureMode, Title: row.Title, Content: row.Content, AIExpansion: row.AIExpansion, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func validClientID(value string) bool {
	return len(value) >= 8 && len(value) <= 128
}
func validKind(value string) bool {
	return value == "inspiration" || value == "character" || value == "project"
}
func validCaptureMode(value string) bool { return value == "text" || value == "voice" }
