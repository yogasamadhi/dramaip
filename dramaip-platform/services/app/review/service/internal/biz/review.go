package biz

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path"
	"regexp"
	"strings"
	"time"

	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/data"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var (
	reviewIDPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$`)
	reviewClientIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`)
	reviewPINPattern      = regexp.MustCompile(`^[0-9]{4,12}$`)
)

type ReviewRepository interface {
	Checks() map[string]func(context.Context) error
	ObjectStoreReady() error
	Workspace(context.Context, string, string) (*userv1.Workspace, error)
	CreatePackage(context.Context, string, string, string, string, string, []byte, []byte, int32, int64, []data.ReviewMediaInput) (data.ReviewPackageRow, []data.ReviewMediaRow, error)
	UploadTarget(context.Context, string, string, string) (data.ReviewMediaRow, data.SignedObjectURL, error)
	PresignUpload(data.ReviewMediaRow) (data.SignedObjectURL, error)
	CompletePackage(context.Context, string, string) (data.ReviewPackageRow, []data.ReviewMediaRow, error)
	PublicPackage(context.Context, []byte) (data.ReviewPackageRow, []data.ReviewMediaRow, error)
	DownloadTarget(data.ReviewMediaRow) (data.SignedObjectURL, error)
	SyncPackage(context.Context, string, string, int64) (data.ReviewSync, error)
	SubmitComment(context.Context, string, string, string, float64, string, string) (data.ReviewCommentRow, error)
	SubmitDecision(context.Context, string, string, string, string, string, string) (data.ReviewDecisionRow, error)
	DeletePackage(context.Context, string, string) error
	PurgeExpired(context.Context) (int, error)
}

type ReviewUsecase struct{ repo ReviewRepository }

type ReviewMediaDeclaration struct {
	ID, RelativePath, MIMEType, SHA256 string
	SizeBytes                          int64
}

type ReviewMedia struct {
	ID, RelativePath, MIMEType, SHA256, Status string
	SizeBytes                                  int64
	DownloadURL, DownloadURLExpiresAt          string
}

type ReviewPackage struct {
	ID, WorkspaceID, DesktopPackageID, Title, Status, ManifestJSON string
	StorageBytes, SyncCursor                                       int64
	ExpiresAt, CreatedAt                                           string
	Media                                                          []ReviewMedia
}

type UploadTarget struct {
	MediaID, Method, URL, ExpiresAt string
	RequiredHeaders                 map[string]string
}

type CreatedPackage struct {
	Package       ReviewPackage
	ShareToken    string
	UploadTargets []UploadTarget
}

type ReviewComment struct {
	ID, PackageID, ClientID, ShotID, AuthorAlias, Body string
	TimecodeSeconds                                    float64
	Resolved                                           bool
	Cursor                                             int64
	CreatedAt, UpdatedAt                               string
}

type ReviewDecision struct {
	ID, PackageID, ClientID, ShotID, Decision, AuthorAlias, Note string
	Cursor                                                       int64
	CreatedAt                                                    string
}

type ReviewSync struct {
	NextCursor int64
	Comments   []ReviewComment
	Decisions  []ReviewDecision
}

func NewReviewUsecase(repo ReviewRepository) *ReviewUsecase { return &ReviewUsecase{repo: repo} }

func (usecase *ReviewUsecase) Checks() map[string]func(context.Context) error {
	return usecase.repo.Checks()
}

func (usecase *ReviewUsecase) Create(
	ctx context.Context,
	userID, workspaceID, desktopPackageID, title, manifestJSON, pin string,
	media []ReviewMediaDeclaration,
) (CreatedPackage, error) {
	userID, workspaceID = strings.TrimSpace(userID), strings.TrimSpace(workspaceID)
	desktopPackageID, title = strings.TrimSpace(desktopPackageID), strings.TrimSpace(title)
	if userID == "" || workspaceID == "" || !reviewIDPattern.MatchString(desktopPackageID) || len(title) == 0 || len(title) > 200 {
		return CreatedPackage{}, status.Error(codes.InvalidArgument, "invalid_review_package")
	}
	if err := usecase.repo.ObjectStoreReady(); err != nil {
		return CreatedPackage{}, status.Error(codes.Unavailable, "private_review_storage_unavailable")
	}
	manifest, err := validateReviewManifest(manifestJSON, desktopPackageID, title, media)
	if err != nil {
		return CreatedPackage{}, status.Error(codes.InvalidArgument, err.Error())
	}
	normalizedManifest, err := json.Marshal(manifest)
	if err != nil {
		return CreatedPackage{}, status.Error(codes.InvalidArgument, "invalid_review_manifest")
	}
	workspace, err := usecase.repo.Workspace(ctx, userID, workspaceID)
	if err != nil {
		return CreatedPackage{}, err
	}
	if workspace.PlanCode != "studio" && workspace.PlanCode != "enterprise" {
		return CreatedPackage{}, status.Error(codes.PermissionDenied, "cloud_review_entitlement_required")
	}
	if workspace.ReviewStorageBytes <= 0 || workspace.ReviewRetentionDays <= 0 {
		return CreatedPackage{}, status.Error(codes.FailedPrecondition, "cloud_review_entitlement_is_not_configured")
	}
	if workspace.ReviewRetentionDays > 30 {
		return CreatedPackage{}, status.Error(codes.FailedPrecondition, "cloud_review_retention_exceeds_30_days")
	}
	totalBytes := int64(0)
	inputRows := make([]data.ReviewMediaInput, 0, len(media))
	for _, item := range media {
		if item.SizeBytes > data.MaxReviewPackageBytes-totalBytes {
			return CreatedPackage{}, status.Error(codes.InvalidArgument, "review_package_exceeds_512_mib")
		}
		totalBytes += item.SizeBytes
		inputRows = append(inputRows, data.ReviewMediaInput{
			ID: item.ID, RelativePath: item.RelativePath, MimeType: item.MIMEType,
			SizeBytes: item.SizeBytes, SHA256: item.SHA256,
		})
	}
	if totalBytes <= 0 || totalBytes > data.MaxReviewPackageBytes {
		return CreatedPackage{}, status.Error(codes.InvalidArgument, "review_package_size_is_invalid")
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return CreatedPackage{}, status.Error(codes.Internal, "review_token_generation_failed")
	}
	shareToken := base64.RawURLEncoding.EncodeToString(rawToken)
	tokenHash := sha256.Sum256(rawToken)
	var pinHash []byte
	if pin = strings.TrimSpace(pin); pin != "" {
		if !reviewPINPattern.MatchString(pin) {
			return CreatedPackage{}, status.Error(codes.InvalidArgument, "review_pin_must_be_4_to_12_digits")
		}
		pinHash, err = bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
		if err != nil {
			return CreatedPackage{}, status.Error(codes.Internal, "review_pin_hash_failed")
		}
	}
	packageRow, mediaRows, err := usecase.repo.CreatePackage(
		ctx, userID, workspaceID, desktopPackageID, title, string(normalizedManifest),
		tokenHash[:], pinHash, workspace.ReviewRetentionDays, workspace.ReviewStorageBytes, inputRows,
	)
	switch {
	case errors.Is(err, data.ErrReviewPackageExists):
		return CreatedPackage{}, status.Error(codes.AlreadyExists, "review_package_already_exists")
	case errors.Is(err, data.ErrReviewStorageExhausted):
		return CreatedPackage{}, status.Error(codes.ResourceExhausted, "review_workspace_storage_exhausted")
	case err != nil:
		return CreatedPackage{}, err
	}
	targets := make([]UploadTarget, 0, len(mediaRows))
	for _, mediaRow := range mediaRows {
		signed, err := usecase.repo.PresignUpload(mediaRow)
		if err != nil {
			return CreatedPackage{}, status.Error(codes.Unavailable, "review_upload_signing_failed")
		}
		targets = append(targets, uploadTarget(mediaRow.ID, signed))
	}
	return CreatedPackage{
		Package:    reviewPackage(packageRow, mediaRows),
		ShareToken: shareToken, UploadTargets: targets,
	}, nil
}

func (usecase *ReviewUsecase) RefreshUploadTarget(ctx context.Context, userID, packageID, mediaID string) (UploadTarget, error) {
	if strings.TrimSpace(packageID) == "" || strings.TrimSpace(mediaID) == "" {
		return UploadTarget{}, status.Error(codes.InvalidArgument, "package_and_media_are_required")
	}
	media, signed, err := usecase.repo.UploadTarget(ctx, strings.TrimSpace(userID), strings.TrimSpace(packageID), strings.TrimSpace(mediaID))
	if err != nil {
		return UploadTarget{}, err
	}
	return uploadTarget(media.ID, signed), nil
}

func (usecase *ReviewUsecase) Complete(ctx context.Context, userID, packageID string) (ReviewPackage, error) {
	if strings.TrimSpace(packageID) == "" {
		return ReviewPackage{}, status.Error(codes.InvalidArgument, "package_id_required")
	}
	packageRow, media, err := usecase.repo.CompletePackage(ctx, strings.TrimSpace(userID), strings.TrimSpace(packageID))
	if errors.Is(err, data.ErrReviewUploadIncomplete) {
		return ReviewPackage{}, status.Error(codes.FailedPrecondition, "review_upload_incomplete_or_invalid")
	}
	if err != nil {
		return ReviewPackage{}, err
	}
	return reviewPackage(packageRow, media), nil
}

func (usecase *ReviewUsecase) PublicPackage(ctx context.Context, token, pin string) (ReviewPackage, error) {
	packageRow, media, err := usecase.authenticatePublic(ctx, token, pin)
	if err != nil {
		return ReviewPackage{}, err
	}
	result := reviewPackage(packageRow, media)
	for index, item := range media {
		signed, err := usecase.repo.DownloadTarget(item)
		if err != nil {
			return ReviewPackage{}, status.Error(codes.Unavailable, "review_media_signing_failed")
		}
		result.Media[index].DownloadURL = signed.URL
		result.Media[index].DownloadURLExpiresAt = signed.ExpiresAt.UTC().Format(time.RFC3339Nano)
	}
	return result, nil
}

func (usecase *ReviewUsecase) SubmitComment(ctx context.Context, token, pin, clientID, shotID string, timecode float64, author, body string) (ReviewComment, error) {
	packageRow, _, err := usecase.authenticatePublic(ctx, token, pin)
	if err != nil {
		return ReviewComment{}, err
	}
	clientID, shotID, author, body = strings.TrimSpace(clientID), strings.TrimSpace(shotID), strings.TrimSpace(author), strings.TrimSpace(body)
	if !reviewClientIDPattern.MatchString(clientID) || timecode < 0 || len(shotID) > 128 || len(author) > 80 || len(body) == 0 || len(body) > 4000 {
		return ReviewComment{}, status.Error(codes.InvalidArgument, "invalid_review_comment")
	}
	row, err := usecase.repo.SubmitComment(ctx, packageRow.ID, clientID, shotID, timecode, author, body)
	if errors.Is(err, data.ErrReviewIdempotencyConflict) {
		return ReviewComment{}, status.Error(codes.AlreadyExists, "review_comment_idempotency_conflict")
	}
	if err != nil {
		return ReviewComment{}, err
	}
	return reviewComment(row), nil
}

func (usecase *ReviewUsecase) SubmitDecision(ctx context.Context, token, pin, clientID, shotID, decision, author, note string) (ReviewDecision, error) {
	packageRow, _, err := usecase.authenticatePublic(ctx, token, pin)
	if err != nil {
		return ReviewDecision{}, err
	}
	clientID, shotID = strings.TrimSpace(clientID), strings.TrimSpace(shotID)
	decision, author, note = strings.TrimSpace(decision), strings.TrimSpace(author), strings.TrimSpace(note)
	if !reviewClientIDPattern.MatchString(clientID) || len(shotID) > 128 || len(author) > 80 || len(note) > 4000 {
		return ReviewDecision{}, status.Error(codes.InvalidArgument, "invalid_review_decision")
	}
	switch decision {
	case "approve", "return", "request_changes", "note":
	default:
		return ReviewDecision{}, status.Error(codes.InvalidArgument, "invalid_review_decision")
	}
	row, err := usecase.repo.SubmitDecision(ctx, packageRow.ID, clientID, shotID, decision, author, note)
	if errors.Is(err, data.ErrReviewIdempotencyConflict) {
		return ReviewDecision{}, status.Error(codes.AlreadyExists, "review_decision_idempotency_conflict")
	}
	if err != nil {
		return ReviewDecision{}, err
	}
	return reviewDecision(row), nil
}

func (usecase *ReviewUsecase) Sync(ctx context.Context, userID, packageID string, afterCursor int64) (ReviewSync, error) {
	if strings.TrimSpace(packageID) == "" || afterCursor < 0 {
		return ReviewSync{}, status.Error(codes.InvalidArgument, "invalid_review_sync_cursor")
	}
	sync, err := usecase.repo.SyncPackage(ctx, strings.TrimSpace(userID), strings.TrimSpace(packageID), afterCursor)
	if err != nil {
		return ReviewSync{}, err
	}
	result := ReviewSync{NextCursor: sync.NextCursor}
	for _, row := range sync.Comments {
		result.Comments = append(result.Comments, reviewComment(row))
	}
	for _, row := range sync.Decisions {
		result.Decisions = append(result.Decisions, reviewDecision(row))
	}
	return result, nil
}

func (usecase *ReviewUsecase) Delete(ctx context.Context, userID, packageID string) error {
	if strings.TrimSpace(packageID) == "" {
		return status.Error(codes.InvalidArgument, "package_id_required")
	}
	return usecase.repo.DeletePackage(ctx, strings.TrimSpace(userID), strings.TrimSpace(packageID))
}

func (usecase *ReviewUsecase) PurgeExpired(ctx context.Context) (int, error) {
	return usecase.repo.PurgeExpired(ctx)
}

func (usecase *ReviewUsecase) authenticatePublic(ctx context.Context, token, pin string) (data.ReviewPackageRow, []data.ReviewMediaRow, error) {
	rawToken, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil || len(rawToken) != 32 {
		return data.ReviewPackageRow{}, nil, status.Error(codes.NotFound, "review package not found")
	}
	tokenHash := sha256.Sum256(rawToken)
	packageRow, media, err := usecase.repo.PublicPackage(ctx, tokenHash[:])
	if err != nil {
		return data.ReviewPackageRow{}, nil, err
	}
	if len(packageRow.PinHash) > 0 {
		if err := bcrypt.CompareHashAndPassword(packageRow.PinHash, []byte(strings.TrimSpace(pin))); err != nil {
			return data.ReviewPackageRow{}, nil, status.Error(codes.Unauthenticated, "invalid review PIN")
		}
	}
	return packageRow, media, nil
}

type reviewManifest struct {
	Format              string                `json:"format"`
	Version             int                   `json:"version"`
	PackageID           string                `json:"packageId"`
	ProjectID           string                `json:"projectId"`
	AdaptationProjectID string                `json:"adaptationProjectId"`
	EpisodeID           string                `json:"episodeId"`
	Title               string                `json:"title"`
	CreatedAt           string                `json:"createdAt"`
	ExpiresAt           string                `json:"expiresAt,omitempty"`
	Media               []reviewManifestMedia `json:"media"`
}

type reviewManifestMedia struct {
	ID              string   `json:"id"`
	ShotID          string   `json:"shotId"`
	OrderIndex      int      `json:"orderIndex"`
	Label           string   `json:"label"`
	RelativePath    string   `json:"relativePath"`
	MIMEType        string   `json:"mimeType"`
	DurationSeconds *float64 `json:"durationSeconds,omitempty"`
	SHA256          string   `json:"sha256,omitempty"`
	SizeBytes       *int64   `json:"sizeBytes,omitempty"`
}

func validateReviewManifest(raw, desktopPackageID, title string, declarations []ReviewMediaDeclaration) (reviewManifest, error) {
	if len(raw) == 0 || len(raw) > 2<<20 || len(declarations) == 0 || len(declarations) > 500 {
		return reviewManifest{}, errors.New("invalid_review_manifest")
	}
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	var manifest reviewManifest
	if err := decoder.Decode(&manifest); err != nil {
		return reviewManifest{}, errors.New("invalid_review_manifest")
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return reviewManifest{}, errors.New("invalid_review_manifest")
	}
	if manifest.Format != "dramaip-review" || manifest.Version != 1 ||
		manifest.PackageID != desktopPackageID || strings.TrimSpace(manifest.Title) != title ||
		manifest.ProjectID == "" || manifest.AdaptationProjectID == "" || manifest.EpisodeID == "" ||
		len(manifest.Media) != len(declarations) {
		return reviewManifest{}, errors.New("review_manifest_contract_mismatch")
	}
	declared := make(map[string]ReviewMediaDeclaration, len(declarations))
	for _, item := range declarations {
		item.RelativePath = strings.TrimSpace(item.RelativePath)
		item.MIMEType = strings.ToLower(strings.TrimSpace(item.MIMEType))
		item.SHA256 = strings.ToLower(strings.TrimSpace(item.SHA256))
		if !safeReviewPath(item.RelativePath) || !allowedReviewMIME(item.MIMEType) || item.SizeBytes <= 0 || !validSHA256(item.SHA256) {
			return reviewManifest{}, errors.New("invalid_review_media_declaration")
		}
		if _, exists := declared[item.RelativePath]; exists {
			return reviewManifest{}, errors.New("duplicate_review_media_path")
		}
		declared[item.RelativePath] = item
	}
	for _, item := range manifest.Media {
		declaration, ok := declared[item.RelativePath]
		if !ok || strings.ToLower(item.MIMEType) != declaration.MIMEType || item.SHA256 != declaration.SHA256 ||
			item.SizeBytes == nil || *item.SizeBytes != declaration.SizeBytes || item.ID == "" || item.ShotID == "" ||
			item.OrderIndex < 0 || len(item.Label) > 200 {
			return reviewManifest{}, errors.New("review_manifest_media_mismatch")
		}
		if item.DurationSeconds != nil && *item.DurationSeconds < 0 {
			return reviewManifest{}, errors.New("review_manifest_media_mismatch")
		}
	}
	return manifest, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func safeReviewPath(value string) bool {
	if value == "" || len(value) > 240 || strings.ContainsRune(value, '\x00') || strings.HasPrefix(value, "/") || strings.Contains(value, "\\") {
		return false
	}
	cleaned := path.Clean(value)
	return cleaned == value && cleaned != "." && cleaned != ".." && !strings.HasPrefix(cleaned, "../")
}

func allowedReviewMIME(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mpeg", "audio/wav", "text/vtt":
		return true
	default:
		return false
	}
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func uploadTarget(mediaID string, signed data.SignedObjectURL) UploadTarget {
	return UploadTarget{
		MediaID: mediaID, Method: "PUT", URL: signed.URL,
		RequiredHeaders: signed.Headers, ExpiresAt: signed.ExpiresAt.UTC().Format(time.RFC3339Nano),
	}
}

func reviewPackage(row data.ReviewPackageRow, mediaRows []data.ReviewMediaRow) ReviewPackage {
	result := ReviewPackage{
		ID: row.ID, WorkspaceID: row.WorkspaceID, DesktopPackageID: row.DesktopPackageID,
		Title: row.Title, Status: row.Status, ManifestJSON: row.ManifestJSON,
		StorageBytes: row.StorageBytes, SyncCursor: row.SyncCursor,
		ExpiresAt: row.ExpiresAt.UTC().Format(time.RFC3339Nano),
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	for _, item := range mediaRows {
		result.Media = append(result.Media, ReviewMedia{
			ID: item.ID, RelativePath: item.RelativePath, MIMEType: item.MimeType,
			SizeBytes: item.SizeBytes, SHA256: item.SHA256, Status: item.Status,
		})
	}
	return result
}

func reviewComment(row data.ReviewCommentRow) ReviewComment {
	return ReviewComment{
		ID: row.ID, PackageID: row.PackageID, ClientID: row.ClientID, ShotID: row.ShotID,
		TimecodeSeconds: row.TimecodeSeconds, AuthorAlias: row.AuthorAlias, Body: row.Body,
		Resolved: row.Resolved, Cursor: row.Cursor,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func reviewDecision(row data.ReviewDecisionRow) ReviewDecision {
	return ReviewDecision{
		ID: row.ID, PackageID: row.PackageID, ClientID: row.ClientID, ShotID: row.ShotID,
		Decision: row.Decision, AuthorAlias: row.AuthorAlias, Note: row.Note, Cursor: row.Cursor,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}
