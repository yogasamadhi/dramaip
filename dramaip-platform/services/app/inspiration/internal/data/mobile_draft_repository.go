// Package data owns the persisted mobile-to-desktop handoff queue. It is
// intentionally separate from the later general project-sync domain.
package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct{ DB *gorm.DB }

func NewData() (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "inspiration")
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

type MobileDraftRow struct {
	ID          string
	ClientID    string
	Kind        string
	CaptureMode string
	Title       string
	Content     string
	AIExpansion string
	CreatedAt   string
	UpdatedAt   string
}

type MobileDraftRepo struct{ data *Data }

func NewMobileDraftRepo(data *Data) *MobileDraftRepo { return &MobileDraftRepo{data: data} }

func (r *MobileDraftRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
	}
}

// UpsertMobileDraft is deliberately create-once per device-generated client
// id. Retrying an offline queue item cannot replace a later desktop edit or
// silently mutate previously handed-off content.
func (r *MobileDraftRepo) UpsertMobileDraft(ctx context.Context, userID string, clientID string, kind string, captureMode string, title string, content string, aiExpansion string) (MobileDraftRow, error) {
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO inspiration.mobile_drafts (id, user_id, client_id, kind, capture_mode, title, content, ai_expansion)
		VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, client_id) DO NOTHING
	`, platform.NewUUID(), userID, clientID, kind, captureMode, title, content, aiExpansion).Error; err != nil {
		return MobileDraftRow{}, err
	}
	return r.mobileDraftByClientID(ctx, userID, clientID)
}

func (r *MobileDraftRepo) ListMobileDrafts(ctx context.Context, userID string, limit int32) ([]MobileDraftRow, error) {
	var rows []MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, client_id, kind, capture_mode, title, content, ai_expansion,
		       created_at::text AS created_at, updated_at::text AS updated_at
		FROM inspiration.mobile_drafts
		WHERE user_id = ?::uuid
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	return rows, err
}

// RecordMobileDraftAdoption creates a narrow audit record. Replayed desktop
// requests share the idempotency key and do not create duplicate adoption
// evidence; drafts remain listed so a user can explicitly adopt them again in
// another local project.
func (r *MobileDraftRepo) RecordMobileDraftAdoption(ctx context.Context, userID string, draftID string, idempotencyKey string) (MobileDraftRow, error) {
	row, err := r.mobileDraftByID(ctx, userID, draftID)
	if err != nil {
		return MobileDraftRow{}, err
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO inspiration.mobile_draft_adoptions (id, user_id, draft_id, idempotency_key)
		VALUES (?::uuid, ?::uuid, ?::uuid, ?)
		ON CONFLICT (user_id, draft_id, idempotency_key) DO NOTHING
	`, platform.NewUUID(), userID, draftID, idempotencyKey).Error; err != nil {
		return MobileDraftRow{}, err
	}
	return row, nil
}

func (r *MobileDraftRepo) mobileDraftByClientID(ctx context.Context, userID string, clientID string) (MobileDraftRow, error) {
	var row MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, client_id, kind, capture_mode, title, content, ai_expansion,
		       created_at::text AS created_at, updated_at::text AS updated_at
		FROM inspiration.mobile_drafts WHERE user_id = ?::uuid AND client_id = ? LIMIT 1
	`, userID, clientID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return MobileDraftRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func (r *MobileDraftRepo) mobileDraftByID(ctx context.Context, userID string, draftID string) (MobileDraftRow, error) {
	var row MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, client_id, kind, capture_mode, title, content, ai_expansion,
		       created_at::text AS created_at, updated_at::text AS updated_at
		FROM inspiration.mobile_drafts WHERE user_id = ?::uuid AND id = ?::uuid LIMIT 1
	`, userID, draftID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return MobileDraftRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}
