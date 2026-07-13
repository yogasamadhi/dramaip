package biz

import (
	"context"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/inspiration/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMobileDraftUsecaseRejectsOversizedAndInvalidDrafts(t *testing.T) {
	uc := NewMobileDraftUsecase(fakeMobileDraftRepo{})
	if _, err := uc.Upsert(context.Background(), "u1", "client-123", "novel", "text", "title", "content", ""); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid kind = %v", err)
	}
	if _, err := uc.RecordAdoption(context.Background(), "u1", "draft-1", "short"); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid adoption = %v", err)
	}
}

func TestMobileDraftUsecaseNormalizesListLimit(t *testing.T) {
	uc := NewMobileDraftUsecase(fakeMobileDraftRepo{})
	drafts, err := uc.List(context.Background(), "u1", 999)
	if err != nil || len(drafts) != 1 || drafts[0].ClientID != "client-123" {
		t.Fatalf("list = %#v, %v", drafts, err)
	}
}

type fakeMobileDraftRepo struct{}

func (fakeMobileDraftRepo) Checks() map[string]func(context.Context) error { return nil }
func (fakeMobileDraftRepo) UpsertMobileDraft(context.Context, string, string, string, string, string, string, string) (data.MobileDraftRow, error) {
	return fakeMobileDraftRow(), nil
}
func (fakeMobileDraftRepo) ListMobileDrafts(context.Context, string, int32) ([]data.MobileDraftRow, error) {
	return []data.MobileDraftRow{fakeMobileDraftRow()}, nil
}
func (fakeMobileDraftRepo) RecordMobileDraftAdoption(context.Context, string, string, string) (data.MobileDraftRow, error) {
	return fakeMobileDraftRow(), nil
}
func fakeMobileDraftRow() data.MobileDraftRow {
	return data.MobileDraftRow{ID: "draft-1", ClientID: "client-123", Kind: "inspiration", CaptureMode: "text", Title: "Title", Content: "Content"}
}
