package data

import (
	"context"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type WorkspaceRow struct {
	ID                     string
	OwnerUserID            string
	Name                   string
	PlanCode               string
	IncludedSeats          int32
	ActiveMemberCount      int32
	PendingInvitationCount int32
	CurrentUserRole        string
	ReviewStorageBytes     int64
	ReviewRetentionDays    int32
}

type WorkspaceMemberRow struct {
	ID          string
	WorkspaceID string
	UserID      string
	Role        string
	Status      string
	DisplayName string
	Email       string
	CreatedAt   string
}

type WorkspaceInvitationRow struct {
	ID          string
	WorkspaceID string
	Email       string
	Role        string
	InvitedBy   string
	ExpiresAt   string
	AcceptedBy  string
	AcceptedAt  string
	RevokedAt   string
	CreatedAt   string
}

func (r *UserRepo) ListWorkspaces(ctx context.Context, userID string) ([]WorkspaceRow, error) {
	var rows []WorkspaceRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT workspace.id::text AS id, workspace.owner_user_id::text AS owner_user_id,
		       workspace.name, workspace.plan_code, workspace.included_seats,
		       workspace.review_storage_bytes, workspace.review_retention_days,
		       member.role AS current_user_role,
		       (SELECT count(*) FROM user_profile.workspace_members active
		        WHERE active.workspace_id = workspace.id AND active.status = 'active') AS active_member_count,
		       (SELECT count(*) FROM user_profile.workspace_invitations invitation
		        WHERE invitation.workspace_id = workspace.id AND invitation.accepted_at IS NULL
		          AND invitation.revoked_at IS NULL AND invitation.expires_at > now()) AS pending_invitation_count
		FROM user_profile.workspaces workspace
		JOIN user_profile.workspace_members member
		  ON member.workspace_id = workspace.id AND member.user_id = ?::uuid AND member.status = 'active'
		ORDER BY workspace.created_at
	`, userID).Scan(&rows).Error
	return rows, err
}

func (r *UserRepo) ListWorkspaceMembers(ctx context.Context, userID, workspaceID string) ([]WorkspaceMemberRow, error) {
	if _, err := r.workspaceRole(ctx, r.data.DB, userID, workspaceID, false); err != nil {
		return nil, err
	}
	var rows []WorkspaceMemberRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT member.id::text AS id, member.workspace_id::text AS workspace_id,
		       member.user_id::text AS user_id, member.role, member.status,
		       COALESCE(NULLIF(profile.display_name, ''), profile.email) AS display_name,
		       profile.email, member.created_at::text AS created_at
		FROM user_profile.workspace_members member
		LEFT JOIN user_profile.profiles profile ON profile.user_id = member.user_id
		WHERE member.workspace_id = ?::uuid AND member.status = 'active'
		ORDER BY CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, member.created_at
	`, workspaceID).Scan(&rows).Error
	return rows, err
}

func (r *UserRepo) ListWorkspaceInvitations(ctx context.Context, userID, workspaceID string) ([]WorkspaceInvitationRow, error) {
	if _, err := r.workspaceRole(ctx, r.data.DB, userID, workspaceID, true); err != nil {
		return nil, err
	}
	var rows []WorkspaceInvitationRow
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, workspace_id::text AS workspace_id, email, role,
		       invited_by::text AS invited_by, expires_at::text AS expires_at,
		       COALESCE(accepted_by::text, '') AS accepted_by,
		       COALESCE(accepted_at::text, '') AS accepted_at,
		       COALESCE(revoked_at::text, '') AS revoked_at,
		       created_at::text AS created_at
		FROM user_profile.workspace_invitations
		WHERE workspace_id = ?::uuid
		ORDER BY created_at DESC
		LIMIT 100
	`, workspaceID).Scan(&rows).Error
	return rows, err
}

func (r *UserRepo) CreateWorkspaceInvitation(
	ctx context.Context,
	userID, workspaceID, email, role string,
	tokenHash []byte,
	expiresAt time.Time,
) (WorkspaceInvitationRow, error) {
	var result WorkspaceInvitationRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actorRole, err := r.workspaceRole(ctx, tx, userID, workspaceID, true)
		if err != nil {
			return err
		}
		if actorRole == "admin" && role == "admin" {
			return status.Error(codes.PermissionDenied, "only the workspace owner can invite an admin")
		}
		var capacity struct {
			IncludedSeats int32
			UsedSeats     int32
		}
		if err := tx.Raw(`
			SELECT workspace.included_seats,
			       (SELECT count(*) FROM user_profile.workspace_members member
			        WHERE member.workspace_id = workspace.id AND member.status = 'active')
			       + (SELECT count(*) FROM user_profile.workspace_invitations invitation
			          WHERE invitation.workspace_id = workspace.id AND invitation.accepted_at IS NULL
			            AND invitation.revoked_at IS NULL AND invitation.expires_at > now()) AS used_seats
			FROM user_profile.workspaces workspace
			WHERE workspace.id = ?::uuid
			FOR UPDATE
		`, workspaceID).Scan(&capacity).Error; err != nil {
			return err
		}
		if capacity.IncludedSeats == 0 {
			return status.Error(codes.NotFound, "workspace not found")
		}
		if capacity.UsedSeats >= capacity.IncludedSeats {
			return status.Errorf(codes.ResourceExhausted, "workspace seat limit reached (%d)", capacity.IncludedSeats)
		}
		if err := tx.Exec(`
			UPDATE user_profile.workspace_invitations
			SET revoked_at = now()
			WHERE workspace_id = ?::uuid AND lower(email) = lower(?)
			  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()
		`, workspaceID, email).Error; err != nil {
			return err
		}
		invitationID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO user_profile.workspace_invitations
			  (id, workspace_id, email, role, token_hash, invited_by, expires_at)
			VALUES (?::uuid, ?::uuid, lower(?), ?, ?, ?::uuid, ?)
		`, invitationID, workspaceID, email, role, tokenHash, userID, expiresAt).Error; err != nil {
			return status.Error(codes.AlreadyExists, "an active invitation already exists for this email")
		}
		loaded, err := loadWorkspaceInvitation(tx, invitationID)
		result = loaded
		return err
	})
	return result, err
}

func (r *UserRepo) AcceptWorkspaceInvitation(ctx context.Context, userID string, tokenHash []byte) (WorkspaceMemberRow, error) {
	var result WorkspaceMemberRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var invitation struct {
			ID          string
			WorkspaceID string
			Email       string
			Role        string
			AcceptedAt  string
			RevokedAt   string
			ExpiresAt   time.Time
		}
		if err := tx.Raw(`
			SELECT id::text AS id, workspace_id::text AS workspace_id, email, role,
			       COALESCE(accepted_at::text, '') AS accepted_at,
			       COALESCE(revoked_at::text, '') AS revoked_at, expires_at
			FROM user_profile.workspace_invitations
			WHERE token_hash = ?
			LIMIT 1
			FOR UPDATE
		`, tokenHash).Scan(&invitation).Error; err != nil {
			return err
		}
		if invitation.ID == "" {
			return status.Error(codes.NotFound, "invitation not found")
		}
		if invitation.AcceptedAt != "" {
			return status.Error(codes.AlreadyExists, "invitation was already accepted")
		}
		if invitation.RevokedAt != "" || !invitation.ExpiresAt.After(time.Now().UTC()) {
			return status.Error(codes.FailedPrecondition, "invitation is revoked or expired")
		}
		var profile struct{ Email string }
		if err := tx.Raw(`SELECT email FROM user_profile.profiles WHERE user_id = ?::uuid LIMIT 1`, userID).Scan(&profile).Error; err != nil {
			return err
		}
		if profile.Email == "" || !equalEmail(profile.Email, invitation.Email) {
			return status.Error(codes.PermissionDenied, "invitation email does not match the signed-in account")
		}
		var capacity struct {
			IncludedSeats int32
			ActiveMembers int32
		}
		if err := tx.Raw(`
			SELECT workspace.included_seats,
			       (SELECT count(*) FROM user_profile.workspace_members member
			        WHERE member.workspace_id = workspace.id AND member.status = 'active') AS active_members
			FROM user_profile.workspaces workspace
			WHERE workspace.id = ?::uuid
			FOR UPDATE
		`, invitation.WorkspaceID).Scan(&capacity).Error; err != nil {
			return err
		}
		var existing struct{ Status string }
		if err := tx.Raw(`
			SELECT status FROM user_profile.workspace_members
			WHERE workspace_id = ?::uuid AND user_id = ?::uuid
			LIMIT 1
		`, invitation.WorkspaceID, userID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.Status != "active" && capacity.ActiveMembers >= capacity.IncludedSeats {
			return status.Errorf(codes.ResourceExhausted, "workspace seat limit reached (%d)", capacity.IncludedSeats)
		}
		if err := tx.Exec(`
			INSERT INTO user_profile.workspace_members (id, workspace_id, user_id, role, status)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, 'active')
			ON CONFLICT (workspace_id, user_id) DO UPDATE
			SET role = EXCLUDED.role, status = 'active', updated_at = now()
		`, platform.NewUUID(), invitation.WorkspaceID, userID, invitation.Role).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE user_profile.workspace_invitations
			SET accepted_by = ?::uuid, accepted_at = now()
			WHERE id = ?::uuid AND accepted_at IS NULL AND revoked_at IS NULL
		`, userID, invitation.ID).Error; err != nil {
			return err
		}
		loaded, err := loadWorkspaceMember(tx, invitation.WorkspaceID, userID)
		result = loaded
		return err
	})
	return result, err
}

func (r *UserRepo) RevokeWorkspaceInvitation(ctx context.Context, userID, workspaceID, invitationID string) (WorkspaceInvitationRow, error) {
	var result WorkspaceInvitationRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := r.workspaceRole(ctx, tx, userID, workspaceID, true); err != nil {
			return err
		}
		res := tx.Exec(`
			UPDATE user_profile.workspace_invitations
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE id = ?::uuid AND workspace_id = ?::uuid AND accepted_at IS NULL
		`, invitationID, workspaceID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return status.Error(codes.NotFound, "pending invitation not found")
		}
		loaded, err := loadWorkspaceInvitation(tx, invitationID)
		result = loaded
		return err
	})
	return result, err
}

func (r *UserRepo) UpdateWorkspaceMemberRole(ctx context.Context, userID, workspaceID, memberUserID, role string) (WorkspaceMemberRow, error) {
	var result WorkspaceMemberRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actorRole, err := r.workspaceRole(ctx, tx, userID, workspaceID, true)
		if err != nil {
			return err
		}
		if actorRole != "owner" {
			return status.Error(codes.PermissionDenied, "only the workspace owner can change roles")
		}
		var target struct{ Role string }
		if err := tx.Raw(`
			SELECT role FROM user_profile.workspace_members
			WHERE workspace_id = ?::uuid AND user_id = ?::uuid AND status = 'active'
			LIMIT 1 FOR UPDATE
		`, workspaceID, memberUserID).Scan(&target).Error; err != nil {
			return err
		}
		if target.Role == "" {
			return status.Error(codes.NotFound, "workspace member not found")
		}
		if target.Role == "owner" {
			return status.Error(codes.FailedPrecondition, "workspace owner role cannot be changed")
		}
		if err := tx.Exec(`
			UPDATE user_profile.workspace_members SET role = ?, updated_at = now()
			WHERE workspace_id = ?::uuid AND user_id = ?::uuid
		`, role, workspaceID, memberUserID).Error; err != nil {
			return err
		}
		loaded, err := loadWorkspaceMember(tx, workspaceID, memberUserID)
		result = loaded
		return err
	})
	return result, err
}

func (r *UserRepo) RemoveWorkspaceMember(ctx context.Context, userID, workspaceID, memberUserID string) (WorkspaceMemberRow, error) {
	var result WorkspaceMemberRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actorRole, err := r.workspaceRole(ctx, tx, userID, workspaceID, true)
		if err != nil {
			return err
		}
		target, err := loadWorkspaceMember(tx, workspaceID, memberUserID)
		if err != nil {
			return err
		}
		if target.Role == "owner" {
			return status.Error(codes.FailedPrecondition, "workspace owner cannot be removed")
		}
		if actorRole == "admin" && target.Role != "member" {
			return status.Error(codes.PermissionDenied, "an admin can remove members only")
		}
		if err := tx.Exec(`
			UPDATE user_profile.workspace_members SET status = 'removed', updated_at = now()
			WHERE workspace_id = ?::uuid AND user_id = ?::uuid AND status = 'active'
		`, workspaceID, memberUserID).Error; err != nil {
			return err
		}
		target.Status = "removed"
		result = target
		return nil
	})
	return result, err
}

func (r *UserRepo) SetWorkspacePlan(ctx context.Context, workspaceID, planCode string, includedSeats int32, reviewStorageBytes int64, reviewRetentionDays int32) (WorkspaceRow, error) {
	var result WorkspaceRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var used struct{ Count int32 }
		if err := tx.Raw(`
			SELECT (SELECT count(*) FROM user_profile.workspace_members member
			        WHERE member.workspace_id = workspace.id AND member.status = 'active')
			       + (SELECT count(*) FROM user_profile.workspace_invitations invitation
			          WHERE invitation.workspace_id = workspace.id AND invitation.accepted_at IS NULL
			            AND invitation.revoked_at IS NULL AND invitation.expires_at > now()) AS count
			FROM user_profile.workspaces workspace WHERE workspace.id = ?::uuid FOR UPDATE
		`, workspaceID).Scan(&used).Error; err != nil {
			return err
		}
		if includedSeats < 1 || reviewStorageBytes < 0 || reviewRetentionDays < 0 || reviewRetentionDays > 30 || used.Count > includedSeats {
			return status.Errorf(codes.FailedPrecondition, "workspace uses %d seats; reduce members or invitations before downgrade", used.Count)
		}
		res := tx.Exec(`
			UPDATE user_profile.workspaces
			SET plan_code = ?, included_seats = ?, review_storage_bytes = ?,
			    review_retention_days = ?, updated_at = now()
			WHERE id = ?::uuid
		`, planCode, includedSeats, reviewStorageBytes, reviewRetentionDays, workspaceID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return status.Error(codes.NotFound, "workspace not found")
		}
		var rows []WorkspaceRow
		if err := tx.Raw(`
			SELECT workspace.id::text AS id, workspace.owner_user_id::text AS owner_user_id,
			       workspace.name, workspace.plan_code, workspace.included_seats,
			       workspace.review_storage_bytes, workspace.review_retention_days,
			       (SELECT count(*) FROM user_profile.workspace_members member
			        WHERE member.workspace_id = workspace.id AND member.status = 'active') AS active_member_count,
			       (SELECT count(*) FROM user_profile.workspace_invitations invitation
			        WHERE invitation.workspace_id = workspace.id AND invitation.accepted_at IS NULL
			          AND invitation.revoked_at IS NULL AND invitation.expires_at > now()) AS pending_invitation_count
			FROM user_profile.workspaces workspace WHERE workspace.id = ?::uuid
		`, workspaceID).Scan(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return status.Error(codes.NotFound, "workspace not found")
		}
		result = rows[0]
		return nil
	})
	return result, err
}

func (r *UserRepo) workspaceRole(ctx context.Context, db *gorm.DB, userID, workspaceID string, managerOnly bool) (string, error) {
	var row struct{ Role string }
	if err := db.WithContext(ctx).Raw(`
		SELECT role FROM user_profile.workspace_members
		WHERE workspace_id = ?::uuid AND user_id = ?::uuid AND status = 'active'
		LIMIT 1
	`, workspaceID, userID).Scan(&row).Error; err != nil {
		return "", err
	}
	if row.Role == "" {
		return "", status.Error(codes.PermissionDenied, "workspace membership is required")
	}
	if managerOnly && row.Role != "owner" && row.Role != "admin" {
		return "", status.Error(codes.PermissionDenied, "workspace owner or admin role is required")
	}
	return row.Role, nil
}

func loadWorkspaceInvitation(tx *gorm.DB, invitationID string) (WorkspaceInvitationRow, error) {
	var row WorkspaceInvitationRow
	err := tx.Raw(`
		SELECT id::text AS id, workspace_id::text AS workspace_id, email, role,
		       invited_by::text AS invited_by, expires_at::text AS expires_at,
		       COALESCE(accepted_by::text, '') AS accepted_by,
		       COALESCE(accepted_at::text, '') AS accepted_at,
		       COALESCE(revoked_at::text, '') AS revoked_at,
		       created_at::text AS created_at
		FROM user_profile.workspace_invitations WHERE id = ?::uuid LIMIT 1
	`, invitationID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return WorkspaceInvitationRow{}, status.Error(codes.NotFound, "workspace invitation not found")
	}
	return row, nil
}

func loadWorkspaceMember(tx *gorm.DB, workspaceID, userID string) (WorkspaceMemberRow, error) {
	var row WorkspaceMemberRow
	err := tx.Raw(`
		SELECT member.id::text AS id, member.workspace_id::text AS workspace_id,
		       member.user_id::text AS user_id, member.role, member.status,
		       COALESCE(NULLIF(profile.display_name, ''), profile.email) AS display_name,
		       profile.email, member.created_at::text AS created_at
		FROM user_profile.workspace_members member
		LEFT JOIN user_profile.profiles profile ON profile.user_id = member.user_id
		WHERE member.workspace_id = ?::uuid AND member.user_id = ?::uuid
		LIMIT 1
	`, workspaceID, userID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return WorkspaceMemberRow{}, status.Error(codes.NotFound, "workspace member not found")
	}
	return row, nil
}

func equalEmail(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		a, b := left[index], right[index]
		if a >= 'A' && a <= 'Z' {
			a += 'a' - 'A'
		}
		if b >= 'A' && b <= 'Z' {
			b += 'a' - 'A'
		}
		if a != b {
			return false
		}
	}
	return true
}
