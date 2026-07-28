package service

import (
	"context"

	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type UserService struct {
	userv1.UnimplementedUserServiceServer
	uc *biz.UserUsecase
}

func NewUserService(uc *biz.UserUsecase) *UserService {
	return &UserService{uc: uc}
}

func (s *UserService) GetProfile(ctx context.Context, req *userv1.GetProfileRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	profile, err := s.uc.GetProfile(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) EnsureProfile(ctx context.Context, req *userv1.EnsureProfileRequest) (*userv1.UserProfile, error) {
	profile, err := s.uc.EnsureProfile(ctx, biz.Profile{
		ID: req.UserId, Email: req.Email, Phone: req.Phone, DisplayName: req.DisplayName, Status: req.Status,
	})
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) UpdateProfile(ctx context.Context, req *userv1.UpdateProfileRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	profile, err := s.uc.UpdateProfile(ctx, biz.Profile{
		ID: req.UserId, Phone: req.Phone, DisplayName: req.DisplayName,
		AvatarURL: req.AvatarUrl, Locale: req.Locale, Timezone: req.Timezone,
	})
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) SetProfileStatus(ctx context.Context, req *userv1.SetProfileStatusRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return nil, err
	}
	profile, err := s.uc.SetProfileStatus(ctx, req.UserId, req.Status, req.OperatorId, req.Reason, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) ListWorkspaces(ctx context.Context, req *userv1.ListWorkspacesRequest) (*userv1.ListWorkspacesReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListWorkspaces(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	result := make([]*userv1.Workspace, 0, len(rows))
	for _, row := range rows {
		result = append(result, workspaceReply(row))
	}
	return &userv1.ListWorkspacesReply{Workspaces: result}, nil
}

func (s *UserService) ListWorkspaceMembers(ctx context.Context, req *userv1.ListWorkspaceMembersRequest) (*userv1.ListWorkspaceMembersReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListWorkspaceMembers(ctx, req.UserId, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	result := make([]*userv1.WorkspaceMember, 0, len(rows))
	for _, row := range rows {
		result = append(result, workspaceMemberReply(row))
	}
	return &userv1.ListWorkspaceMembersReply{Members: result}, nil
}

func (s *UserService) ListWorkspaceInvitations(ctx context.Context, req *userv1.ListWorkspaceInvitationsRequest) (*userv1.ListWorkspaceInvitationsReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListWorkspaceInvitations(ctx, req.UserId, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	result := make([]*userv1.WorkspaceInvitation, 0, len(rows))
	for _, row := range rows {
		result = append(result, workspaceInvitationReply(row, ""))
	}
	return &userv1.ListWorkspaceInvitationsReply{Invitations: result}, nil
}

func (s *UserService) InviteWorkspaceMember(ctx context.Context, req *userv1.InviteWorkspaceMemberRequest) (*userv1.WorkspaceInvitation, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	created, err := s.uc.InviteWorkspaceMember(ctx, req.UserId, req.WorkspaceId, req.Email, req.Role, req.ExpiresInHours)
	if err != nil {
		return nil, err
	}
	return workspaceInvitationReply(created.WorkspaceInvitation, created.Token), nil
}

func (s *UserService) AcceptWorkspaceInvitation(ctx context.Context, req *userv1.AcceptWorkspaceInvitationRequest) (*userv1.WorkspaceMember, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	member, err := s.uc.AcceptWorkspaceInvitation(ctx, req.UserId, req.Token)
	if err != nil {
		return nil, err
	}
	return workspaceMemberReply(member), nil
}

func (s *UserService) RevokeWorkspaceInvitation(ctx context.Context, req *userv1.RevokeWorkspaceInvitationRequest) (*userv1.WorkspaceInvitation, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	invitation, err := s.uc.RevokeWorkspaceInvitation(ctx, req.UserId, req.WorkspaceId, req.InvitationId)
	if err != nil {
		return nil, err
	}
	return workspaceInvitationReply(invitation, ""), nil
}

func (s *UserService) UpdateWorkspaceMemberRole(ctx context.Context, req *userv1.UpdateWorkspaceMemberRoleRequest) (*userv1.WorkspaceMember, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	member, err := s.uc.UpdateWorkspaceMemberRole(ctx, req.UserId, req.WorkspaceId, req.MemberUserId, req.Role)
	if err != nil {
		return nil, err
	}
	return workspaceMemberReply(member), nil
}

func (s *UserService) RemoveWorkspaceMember(ctx context.Context, req *userv1.RemoveWorkspaceMemberRequest) (*userv1.WorkspaceMember, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	member, err := s.uc.RemoveWorkspaceMember(ctx, req.UserId, req.WorkspaceId, req.MemberUserId)
	if err != nil {
		return nil, err
	}
	return workspaceMemberReply(member), nil
}

func (s *UserService) SetWorkspacePlan(ctx context.Context, req *userv1.SetWorkspacePlanRequest) (*userv1.Workspace, error) {
	if err := platform.RequireInternalPeer(ctx, "web-bff", "admin-bff"); err != nil {
		return nil, err
	}
	workspace, err := s.uc.SetWorkspacePlan(ctx, req.WorkspaceId, req.PlanCode, req.IncludedSeats, req.ReviewStorageBytes, req.ReviewRetentionDays)
	if err != nil {
		return nil, err
	}
	return workspaceReply(workspace), nil
}

func profileReply(profile biz.Profile) *userv1.UserProfile {
	return &userv1.UserProfile{
		Id: profile.ID, Email: profile.Email, Phone: profile.Phone, DisplayName: profile.DisplayName,
		AvatarUrl: profile.AvatarURL, Locale: profile.Locale, Timezone: profile.Timezone, Status: profile.Status,
	}
}

func workspaceReply(workspace biz.Workspace) *userv1.Workspace {
	return &userv1.Workspace{
		Id: workspace.ID, OwnerUserId: workspace.OwnerUserID, Name: workspace.Name,
		PlanCode: workspace.PlanCode, IncludedSeats: workspace.IncludedSeats,
		ActiveMemberCount:      workspace.ActiveMemberCount,
		PendingInvitationCount: workspace.PendingInvitationCount,
		CurrentUserRole:        workspace.CurrentUserRole,
		ReviewStorageBytes:     workspace.ReviewStorageBytes,
		ReviewRetentionDays:    workspace.ReviewRetentionDays,
	}
}

func workspaceMemberReply(member biz.WorkspaceMember) *userv1.WorkspaceMember {
	return &userv1.WorkspaceMember{
		Id: member.ID, WorkspaceId: member.WorkspaceID, UserId: member.UserID,
		Role: member.Role, Status: member.Status, DisplayName: member.DisplayName,
		Email: member.Email, CreatedAt: member.CreatedAt,
	}
}

func workspaceInvitationReply(invitation biz.WorkspaceInvitation, token string) *userv1.WorkspaceInvitation {
	return &userv1.WorkspaceInvitation{
		Id: invitation.ID, WorkspaceId: invitation.WorkspaceID, Email: invitation.Email,
		Role: invitation.Role, InvitedBy: invitation.InvitedBy, ExpiresAt: invitation.ExpiresAt,
		AcceptedBy: invitation.AcceptedBy, AcceptedAt: invitation.AcceptedAt,
		RevokedAt: invitation.RevokedAt, CreatedAt: invitation.CreatedAt, Token: token,
	}
}
