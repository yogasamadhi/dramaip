package biz

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/mail"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type UserUsecase struct {
	repo *data.UserRepo
}

type Profile struct {
	ID          string
	Email       string
	Phone       string
	DisplayName string
	AvatarURL   string
	Locale      string
	Timezone    string
	Status      string
}

type Workspace = data.WorkspaceRow
type WorkspaceMember = data.WorkspaceMemberRow
type WorkspaceInvitation = data.WorkspaceInvitationRow

type CreatedWorkspaceInvitation struct {
	WorkspaceInvitation
	Token string
}

func NewUserUsecase(repo *data.UserRepo) *UserUsecase {
	return &UserUsecase{repo: repo}
}

func (u *UserUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *UserUsecase) GetProfile(ctx context.Context, userID string) (Profile, error) {
	row, err := u.repo.GetProfile(ctx, userID)
	if err != nil {
		return Profile{}, status.Error(codes.NotFound, "profile not found")
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName, AvatarURL: row.AvatarURL,
		Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) EnsureProfile(ctx context.Context, profile Profile) (Profile, error) {
	row, err := u.repo.EnsureProfile(ctx, data.ProfileRow{
		ID: profile.ID, Email: profile.Email, Phone: profile.Phone, DisplayName: profile.DisplayName, Status: profile.Status,
	})
	if err != nil {
		return Profile{}, err
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName,
		AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) UpdateProfile(ctx context.Context, profile Profile) (Profile, error) {
	if strings.TrimSpace(profile.DisplayName) == "" {
		return Profile{}, status.Error(codes.InvalidArgument, "display_name_required")
	}
	row, err := u.repo.UpdateProfile(ctx, data.ProfileRow{
		ID: profile.ID, Phone: profile.Phone, DisplayName: strings.TrimSpace(profile.DisplayName),
		AvatarURL: strings.TrimSpace(profile.AvatarURL), Locale: strings.TrimSpace(profile.Locale), Timezone: strings.TrimSpace(profile.Timezone),
	})
	if err != nil {
		return Profile{}, err
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName,
		AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) SetProfileStatus(ctx context.Context, userID, state, operatorID, reason, idempotencyKey string) (Profile, error) {
	userID, state = strings.TrimSpace(userID), strings.TrimSpace(state)
	if userID == "" || strings.TrimSpace(operatorID) == "" || strings.TrimSpace(idempotencyKey) == "" || len(strings.TrimSpace(reason)) < 4 || len(strings.TrimSpace(reason)) > 300 || (state != "active" && state != "suspended") {
		return Profile{}, status.Error(codes.InvalidArgument, "invalid_profile_status_change")
	}
	row, err := u.repo.SetProfileStatus(ctx, userID, state, strings.TrimSpace(operatorID), strings.TrimSpace(reason), strings.TrimSpace(idempotencyKey))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return Profile{}, status.Error(codes.NotFound, "profile not found")
		}
		return Profile{}, err
	}
	return Profile{ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName, AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status}, nil
}

func (u *UserUsecase) ListWorkspaces(ctx context.Context, userID string) ([]Workspace, error) {
	return u.repo.ListWorkspaces(ctx, strings.TrimSpace(userID))
}

func (u *UserUsecase) ListWorkspaceMembers(ctx context.Context, userID, workspaceID string) ([]WorkspaceMember, error) {
	if strings.TrimSpace(workspaceID) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id_required")
	}
	return u.repo.ListWorkspaceMembers(ctx, strings.TrimSpace(userID), strings.TrimSpace(workspaceID))
}

func (u *UserUsecase) ListWorkspaceInvitations(ctx context.Context, userID, workspaceID string) ([]WorkspaceInvitation, error) {
	if strings.TrimSpace(workspaceID) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id_required")
	}
	return u.repo.ListWorkspaceInvitations(ctx, strings.TrimSpace(userID), strings.TrimSpace(workspaceID))
}

func (u *UserUsecase) InviteWorkspaceMember(ctx context.Context, userID, workspaceID, email, role string, expiresInHours int32) (CreatedWorkspaceInvitation, error) {
	userID, workspaceID = strings.TrimSpace(userID), strings.TrimSpace(workspaceID)
	role = strings.ToLower(strings.TrimSpace(role))
	if workspaceID == "" || (role != "admin" && role != "member") {
		return CreatedWorkspaceInvitation{}, status.Error(codes.InvalidArgument, "invalid_workspace_invitation")
	}
	parsed, err := mail.ParseAddress(strings.TrimSpace(email))
	if err != nil || !strings.Contains(parsed.Address, "@") {
		return CreatedWorkspaceInvitation{}, status.Error(codes.InvalidArgument, "valid_email_required")
	}
	email = strings.ToLower(parsed.Address)
	if expiresInHours == 0 {
		expiresInHours = 72
	}
	if expiresInHours < 1 || expiresInHours > 168 {
		return CreatedWorkspaceInvitation{}, status.Error(codes.InvalidArgument, "invitation_expiry_must_be_between_1_and_168_hours")
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return CreatedWorkspaceInvitation{}, status.Error(codes.Internal, "invitation_token_generation_failed")
	}
	token := base64.RawURLEncoding.EncodeToString(rawToken)
	tokenHash := sha256.Sum256(rawToken)
	row, err := u.repo.CreateWorkspaceInvitation(ctx, userID, workspaceID, email, role, tokenHash[:], time.Now().UTC().Add(time.Duration(expiresInHours)*time.Hour))
	if err != nil {
		return CreatedWorkspaceInvitation{}, err
	}
	return CreatedWorkspaceInvitation{WorkspaceInvitation: row, Token: token}, nil
}

func (u *UserUsecase) AcceptWorkspaceInvitation(ctx context.Context, userID, token string) (WorkspaceMember, error) {
	rawToken, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil || len(rawToken) != 32 {
		return WorkspaceMember{}, status.Error(codes.InvalidArgument, "invalid_invitation_token")
	}
	tokenHash := sha256.Sum256(rawToken)
	return u.repo.AcceptWorkspaceInvitation(ctx, strings.TrimSpace(userID), tokenHash[:])
}

func (u *UserUsecase) RevokeWorkspaceInvitation(ctx context.Context, userID, workspaceID, invitationID string) (WorkspaceInvitation, error) {
	if strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(invitationID) == "" {
		return WorkspaceInvitation{}, status.Error(codes.InvalidArgument, "workspace_and_invitation_are_required")
	}
	return u.repo.RevokeWorkspaceInvitation(ctx, strings.TrimSpace(userID), strings.TrimSpace(workspaceID), strings.TrimSpace(invitationID))
}

func (u *UserUsecase) UpdateWorkspaceMemberRole(ctx context.Context, userID, workspaceID, memberUserID, role string) (WorkspaceMember, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	if strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(memberUserID) == "" || (role != "admin" && role != "member") {
		return WorkspaceMember{}, status.Error(codes.InvalidArgument, "invalid_workspace_role_change")
	}
	return u.repo.UpdateWorkspaceMemberRole(ctx, strings.TrimSpace(userID), strings.TrimSpace(workspaceID), strings.TrimSpace(memberUserID), role)
}

func (u *UserUsecase) RemoveWorkspaceMember(ctx context.Context, userID, workspaceID, memberUserID string) (WorkspaceMember, error) {
	if strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(memberUserID) == "" {
		return WorkspaceMember{}, status.Error(codes.InvalidArgument, "workspace_and_member_are_required")
	}
	return u.repo.RemoveWorkspaceMember(ctx, strings.TrimSpace(userID), strings.TrimSpace(workspaceID), strings.TrimSpace(memberUserID))
}

func (u *UserUsecase) SetWorkspacePlan(ctx context.Context, workspaceID, planCode string, includedSeats int32, reviewStorageBytes int64, reviewRetentionDays int32) (Workspace, error) {
	workspaceID, planCode = strings.TrimSpace(workspaceID), strings.ToLower(strings.TrimSpace(planCode))
	if workspaceID == "" || includedSeats < 1 || reviewStorageBytes < 0 || reviewRetentionDays < 0 || reviewRetentionDays > 30 {
		return Workspace{}, status.Error(codes.InvalidArgument, "invalid_workspace_plan")
	}
	switch planCode {
	case "free", "creator", "studio", "enterprise":
	default:
		return Workspace{}, status.Error(codes.InvalidArgument, "unknown_workspace_plan")
	}
	if planCode != "enterprise" && reviewRetentionDays > 30 {
		return Workspace{}, status.Error(codes.InvalidArgument, "review_retention_exceeds_plan_limit")
	}
	return u.repo.SetWorkspacePlan(ctx, workspaceID, planCode, includedSeats, reviewStorageBytes, reviewRetentionDays)
}
