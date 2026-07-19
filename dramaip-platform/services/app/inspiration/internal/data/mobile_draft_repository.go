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
	ID            string
	ClientID      string
	Kind          string
	CaptureMode   string
	Title         string
	Content       string
	AIExpansion   string
	CreatedAt     string
	UpdatedAt     string
	AdoptionCount int32
	LastAdoptedAt string
}

type MobileDraftPage struct {
	Drafts     []MobileDraftRow
	NextCursor string
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
		ON CONFLICT (user_id, client_id) DO UPDATE SET
			kind = EXCLUDED.kind, capture_mode = EXCLUDED.capture_mode, title = EXCLUDED.title,
			content = EXCLUDED.content, ai_expansion = EXCLUDED.ai_expansion, updated_at = now()
		WHERE inspiration.mobile_drafts.deleted_at IS NULL
	`, platform.NewUUID(), userID, clientID, kind, captureMode, title, content, aiExpansion).Error; err != nil {
		return MobileDraftRow{}, err
	}
	return r.mobileDraftByClientID(ctx, userID, clientID)
}

func (r *MobileDraftRepo) ListMobileDrafts(ctx context.Context, userID string, limit int32, cursor string) (MobileDraftPage, error) {
	var rows []MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT d.id::text AS id, d.client_id, d.kind, d.capture_mode, d.title, d.content, d.ai_expansion,
		       d.created_at::text AS created_at, d.updated_at::text AS updated_at,
		       COALESCE((SELECT COUNT(*) FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), 0) AS adoption_count,
		       COALESCE((SELECT MAX(a.adopted_at)::text FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), '') AS last_adopted_at
		FROM inspiration.mobile_drafts d
		WHERE d.user_id = ?::uuid AND d.deleted_at IS NULL
		  AND (? = '' OR (d.updated_at, d.id) < (
			SELECT c.updated_at, c.id FROM inspiration.mobile_drafts c WHERE c.user_id = ?::uuid AND c.id::text = ? AND c.deleted_at IS NULL
		  ))
		ORDER BY d.updated_at DESC, d.id DESC
		LIMIT ?
	`, userID, cursor, userID, cursor, limit+1).Scan(&rows).Error
	if err != nil {
		return MobileDraftPage{}, err
	}
	page := MobileDraftPage{Drafts: rows}
	if len(page.Drafts) > int(limit) {
		page.NextCursor = page.Drafts[limit-1].ID
		page.Drafts = page.Drafts[:limit]
	}
	return page, nil
}

// RecordMobileDraftAdoption creates a narrow audit record. Replayed desktop
// requests share the idempotency key and do not create duplicate adoption
// evidence; drafts remain listed so a user can explicitly adopt them again in
// another local project.
func (r *MobileDraftRepo) RecordMobileDraftAdoption(ctx context.Context, userID string, draftID string, idempotencyKey string) (MobileDraftRow, error) {
	_, err := r.mobileDraftByID(ctx, userID, draftID)
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
	return r.mobileDraftByID(ctx, userID, draftID)
}

func (r *MobileDraftRepo) DeleteMobileDraft(ctx context.Context, userID string, draftID string) (MobileDraftRow, error) {
	row, err := r.mobileDraftByID(ctx, userID, draftID)
	if err != nil {
		return MobileDraftRow{}, err
	}
	if err := r.data.DB.WithContext(ctx).Exec(`
		UPDATE inspiration.mobile_drafts SET deleted_at = now(), updated_at = now()
		WHERE user_id = ?::uuid AND id = ?::uuid AND deleted_at IS NULL
	`, userID, draftID).Error; err != nil {
		return MobileDraftRow{}, err
	}
	return row, nil
}

func (r *MobileDraftRepo) mobileDraftByClientID(ctx context.Context, userID string, clientID string) (MobileDraftRow, error) {
	var row MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT d.id::text AS id, d.client_id, d.kind, d.capture_mode, d.title, d.content, d.ai_expansion,
		       d.created_at::text AS created_at, d.updated_at::text AS updated_at,
		       COALESCE((SELECT COUNT(*) FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), 0) AS adoption_count,
		       COALESCE((SELECT MAX(a.adopted_at)::text FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), '') AS last_adopted_at
		FROM inspiration.mobile_drafts d WHERE d.user_id = ?::uuid AND d.client_id = ? AND d.deleted_at IS NULL LIMIT 1
	`, userID, clientID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return MobileDraftRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}

func (r *MobileDraftRepo) mobileDraftByID(ctx context.Context, userID string, draftID string) (MobileDraftRow, error) {
	var row MobileDraftRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT d.id::text AS id, d.client_id, d.kind, d.capture_mode, d.title, d.content, d.ai_expansion,
		       d.created_at::text AS created_at, d.updated_at::text AS updated_at,
		       COALESCE((SELECT COUNT(*) FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), 0) AS adoption_count,
		       COALESCE((SELECT MAX(a.adopted_at)::text FROM inspiration.mobile_draft_adoptions a WHERE a.user_id = d.user_id AND a.draft_id = d.id), '') AS last_adopted_at
		FROM inspiration.mobile_drafts d WHERE d.user_id = ?::uuid AND d.id = ?::uuid AND d.deleted_at IS NULL LIMIT 1
	`, userID, draftID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return MobileDraftRow{}, gorm.ErrRecordNotFound
	}
	return row, nil
}
