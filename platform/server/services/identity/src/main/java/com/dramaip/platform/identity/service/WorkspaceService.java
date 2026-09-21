package com.dramaip.platform.identity.service;

import com.dramaip.platform.common.observability.OutboxObservability;
import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.RequestContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceService {
    private static final int MIN_INVITATION_HOURS = 1;
    private static final int MAX_INVITATION_HOURS = 168;

    private final JdbcTemplate jdbc;
    private final OutboxObservability outbox;
    private final SecureRandom random = new SecureRandom();

    public WorkspaceService(JdbcTemplate jdbc, OutboxObservability outbox) {
        this.jdbc = jdbc;
        this.outbox = outbox;
    }

    public List<Workspace> workspaces(String userId) {
        return jdbc.query("""
                select workspace.id::text, workspace.owner_user_id::text, workspace.name, workspace.plan_code,
                  workspace.included_seats,
                  (select count(*) from user_profile.workspace_members active_member
                   where active_member.workspace_id = workspace.id and active_member.status = 'active'),
                  (select count(*) from user_profile.workspace_invitations pending
                   where pending.workspace_id = workspace.id and pending.accepted_at is null
                     and pending.revoked_at is null and pending.expires_at > now()),
                  member.role, workspace.review_storage_bytes, workspace.review_retention_days,
                  workspace.status, workspace.created_at
                from user_profile.workspace_members member
                join user_profile.workspaces workspace on workspace.id = member.workspace_id
                where member.user_id = ?::uuid and member.status = 'active'
                order by workspace.created_at, workspace.id
                """, (rs, row) -> new Workspace(
                rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5),
                rs.getInt(6), rs.getInt(7), rs.getString(8), rs.getLong(9), rs.getInt(10),
                rs.getString(11), rs.getTimestamp(12).toInstant()), userId);
    }

    public List<Member> members(String actorUserId, String workspaceId) {
        requireMember(actorUserId, workspaceId);
        return jdbc.query("""
                select member.id::text, member.workspace_id::text, member.user_id::text, member.role, member.status,
                  coalesce(profile.display_name, ''), coalesce(user_record.email, ''), member.created_at
                from user_profile.workspace_members member
                left join user_profile.profiles profile on profile.user_id = member.user_id
                left join auth.users user_record on user_record.id = member.user_id
                where member.workspace_id = ?::uuid and member.status = 'active'
                order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
                  lower(coalesce(user_record.email, '')), member.id
                """, (rs, row) -> member(rs), workspaceId);
    }

    public List<Invitation> invitations(String actorUserId, String workspaceId) {
        requireAdministrator(actorUserId, workspaceId);
        return jdbc.query(invitationSelect("""
                where invitation.workspace_id = ?::uuid and invitation.accepted_at is null
                  and invitation.revoked_at is null and invitation.expires_at > now()
                order by invitation.created_at desc, invitation.id desc
                """), (rs, row) -> invitation(rs, ""), workspaceId);
    }

    @Transactional
    public Invitation invite(String actorUserId, String workspaceId, InviteCommand command) {
        String email = normalizeEmail(command.email());
        String role = invitationRole(command.role());
        int expiresInHours = command.expiresInHours() == null ? 72 : command.expiresInHours();
        if (expiresInHours < MIN_INVITATION_HOURS || expiresInHours > MAX_INVITATION_HOURS) {
            throw new BusinessException("IDENTITY_INVITATION_EXPIRY_INVALID", "invitation expiry must be between 1 and 168 hours", HttpStatus.BAD_REQUEST);
        }
        requireAdministrator(actorUserId, workspaceId);
        WorkspaceLock workspace = lockWorkspace(workspaceId);
        if (!"active".equals(workspace.status())) {
            throw new BusinessException("IDENTITY_WORKSPACE_UNAVAILABLE", "workspace is not active", HttpStatus.CONFLICT);
        }
        int occupiedSeats = occupiedSeats(workspaceId);
        if (occupiedSeats >= workspace.includedSeats()) {
            throw new BusinessException("IDENTITY_WORKSPACE_SEAT_LIMIT", "workspace has no available seats", HttpStatus.CONFLICT);
        }
        Integer existingMember = jdbc.query("""
                select 1 from user_profile.workspace_members member
                join auth.users user_record on user_record.id = member.user_id
                where member.workspace_id = ?::uuid and member.status = 'active' and lower(user_record.email) = lower(?)
                """, rs -> rs.next() ? 1 : null, workspaceId, email);
        if (existingMember != null) {
            throw new BusinessException("IDENTITY_WORKSPACE_MEMBER_EXISTS", "email already belongs to an active member", HttpStatus.CONFLICT);
        }

        String rawToken = randomToken();
        String invitationId = UUID.randomUUID().toString();
        try {
            jdbc.update("""
                    insert into user_profile.workspace_invitations(
                      id, workspace_id, email, role, token_hash, invited_by, expires_at, updated_at
                    ) values (?::uuid, ?::uuid, ?, ?, decode(?, 'hex'), ?::uuid,
                      now() + (? * interval '1 hour'), now())
                    """, invitationId, workspaceId, email, role, sha256Hex(rawToken), actorUserId, expiresInHours);
        } catch (org.springframework.dao.DuplicateKeyException exception) {
            throw new BusinessException("IDENTITY_WORKSPACE_INVITATION_EXISTS", "an active invitation already exists for this email", HttpStatus.CONFLICT);
        }
        auditAndPublish(actorUserId, workspaceId, "workspace.invitation.created", "invitation", invitationId);
        return jdbc.query(invitationSelect("where invitation.id = ?::uuid"), rs -> {
            if (!rs.next()) throw new BusinessException("IDENTITY_WORKSPACE_INVITATION_NOT_FOUND", "invitation was not persisted", HttpStatus.CONFLICT);
            return invitation(rs, rawToken);
        }, invitationId);
    }

    @Transactional
    public Member updateMember(String actorUserId, String workspaceId, String memberId, String requestedRole) {
        requireAdministrator(actorUserId, workspaceId);
        String role = invitationRole(requestedRole);
        Member current = memberForUpdate(workspaceId, memberId);
        if ("owner".equals(current.role())) {
            throw new BusinessException("IDENTITY_WORKSPACE_OWNER_IMMUTABLE", "workspace owner role cannot be changed", HttpStatus.CONFLICT);
        }
        jdbc.update("""
                update user_profile.workspace_members set role = ?, updated_at = now()
                where id = ?::uuid and workspace_id = ?::uuid and status = 'active'
                """, role, memberId, workspaceId);
        auditAndPublish(actorUserId, workspaceId, "workspace.member.role_changed", "member", memberId);
        return memberForUpdate(workspaceId, memberId);
    }

    @Transactional
    public Member removeMember(String actorUserId, String workspaceId, String memberId) {
        requireAdministrator(actorUserId, workspaceId);
        Member current = memberForUpdate(workspaceId, memberId);
        if ("owner".equals(current.role())) {
            throw new BusinessException("IDENTITY_WORKSPACE_OWNER_IMMUTABLE", "workspace owner cannot be removed", HttpStatus.CONFLICT);
        }
        jdbc.update("""
                update user_profile.workspace_members set status = 'removed', updated_at = now()
                where id = ?::uuid and workspace_id = ?::uuid and status = 'active'
                """, memberId, workspaceId);
        auditAndPublish(actorUserId, workspaceId, "workspace.member.removed", "member", memberId);
        return new Member(current.id(), current.workspaceId(), current.userId(), current.role(), "removed",
                current.displayName(), current.email(), current.createdAt());
    }

    @Transactional
    public Invitation revokeInvitation(String actorUserId, String workspaceId, String invitationId) {
        requireAdministrator(actorUserId, workspaceId);
        Invitation current = invitationForUpdate(workspaceId, invitationId);
        if (current.acceptedAt() != null || current.revokedAt() != null) {
            throw new BusinessException("IDENTITY_WORKSPACE_INVITATION_NOT_PENDING", "invitation is no longer pending", HttpStatus.CONFLICT);
        }
        jdbc.update("""
                update user_profile.workspace_invitations set revoked_at = now(), updated_at = now()
                where id = ?::uuid and workspace_id = ?::uuid and accepted_at is null and revoked_at is null
                """, invitationId, workspaceId);
        auditAndPublish(actorUserId, workspaceId, "workspace.invitation.revoked", "invitation", invitationId);
        return invitationForUpdate(workspaceId, invitationId);
    }

    @Transactional
    public Member acceptInvitation(String userId, String rawToken) {
        if (rawToken == null || !rawToken.matches("^[A-Za-z0-9_-]{64}$")) {
            throw invalidInvitation();
        }
        Invitation invitation = jdbc.query(invitationSelect("""
                where invitation.token_hash = decode(?, 'hex')
                for update
                """), rs -> rs.next() ? invitation(rs, "") : null, sha256Hex(rawToken));
        if (invitation == null || invitation.acceptedAt() != null || invitation.revokedAt() != null
                || !invitation.expiresAt().isAfter(Instant.now())) {
            throw invalidInvitation();
        }
        String userEmail = jdbc.query("select email from auth.users where id = ?::uuid and status = 'active'",
                rs -> rs.next() ? rs.getString(1) : null, userId);
        if (userEmail == null || !normalizeEmail(userEmail).equals(normalizeEmail(invitation.email()))) {
            throw new BusinessException("IDENTITY_WORKSPACE_INVITATION_EMAIL_MISMATCH", "invitation email does not match the authenticated account", HttpStatus.FORBIDDEN);
        }
        WorkspaceLock workspace = lockWorkspace(invitation.workspaceId());
        if (!"active".equals(workspace.status())) {
            throw new BusinessException("IDENTITY_WORKSPACE_UNAVAILABLE", "workspace is not active", HttpStatus.CONFLICT);
        }
        if (activeMemberCount(invitation.workspaceId()) >= workspace.includedSeats()) {
            throw new BusinessException("IDENTITY_WORKSPACE_SEAT_LIMIT", "workspace has no available seats", HttpStatus.CONFLICT);
        }
        String memberId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into user_profile.workspace_members(id, workspace_id, user_id, role, status)
                values (?::uuid, ?::uuid, ?::uuid, ?, 'active')
                on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now()
                """, memberId, invitation.workspaceId(), userId, invitation.role());
        jdbc.update("""
                update user_profile.workspace_invitations set accepted_by = ?::uuid, accepted_at = now(), updated_at = now()
                where id = ?::uuid and accepted_at is null and revoked_at is null
                """, userId, invitation.id());
        Member accepted = jdbc.query("""
                select member.id::text, member.workspace_id::text, member.user_id::text, member.role, member.status,
                  coalesce(profile.display_name, ''), coalesce(user_record.email, ''), member.created_at
                from user_profile.workspace_members member
                left join user_profile.profiles profile on profile.user_id = member.user_id
                left join auth.users user_record on user_record.id = member.user_id
                where member.workspace_id = ?::uuid and member.user_id = ?::uuid
                """, rs -> rs.next() ? member(rs) : null, invitation.workspaceId(), userId);
        if (accepted == null) throw new BusinessException("IDENTITY_WORKSPACE_ACCEPT_FAILED", "workspace membership was not persisted", HttpStatus.CONFLICT);
        auditAndPublish(userId, invitation.workspaceId(), "workspace.invitation.accepted", "member", accepted.id());
        return accepted;
    }

    private String requireMember(String actorUserId, String workspaceId) {
        String role = jdbc.query("""
                select member.role from user_profile.workspace_members member
                join user_profile.workspaces workspace on workspace.id = member.workspace_id
                where member.workspace_id = ?::uuid and member.user_id = ?::uuid
                  and member.status = 'active' and workspace.status = 'active'
                """, rs -> rs.next() ? rs.getString(1) : null, workspaceId, actorUserId);
        if (role == null) throw new BusinessException("IDENTITY_WORKSPACE_ACCESS_DENIED", "workspace membership is required", HttpStatus.FORBIDDEN);
        return role;
    }

    private void requireAdministrator(String actorUserId, String workspaceId) {
        String role = requireMember(actorUserId, workspaceId);
        if (!"owner".equals(role) && !"admin".equals(role)) {
            throw new BusinessException("IDENTITY_WORKSPACE_ADMIN_REQUIRED", "workspace owner or admin role is required", HttpStatus.FORBIDDEN);
        }
    }

    private WorkspaceLock lockWorkspace(String workspaceId) {
        WorkspaceLock workspace = jdbc.query("""
                select included_seats, status from user_profile.workspaces where id = ?::uuid for update
                """, rs -> rs.next() ? new WorkspaceLock(rs.getInt(1), rs.getString(2)) : null, workspaceId);
        if (workspace == null) throw new BusinessException("IDENTITY_WORKSPACE_NOT_FOUND", "workspace not found", HttpStatus.NOT_FOUND);
        return workspace;
    }

    private int occupiedSeats(String workspaceId) {
        Integer count = jdbc.query("""
                select
                  (select count(*) from user_profile.workspace_members member
                   where member.workspace_id = ?::uuid and member.status = 'active') +
                  (select count(*) from user_profile.workspace_invitations invitation
                   where invitation.workspace_id = ?::uuid and invitation.accepted_at is null
                     and invitation.revoked_at is null and invitation.expires_at > now())
                """, rs -> rs.next() ? rs.getInt(1) : 0, workspaceId, workspaceId);
        return count == null ? 0 : count;
    }

    private int activeMemberCount(String workspaceId) {
        Integer count = jdbc.query("""
                select count(*) from user_profile.workspace_members member
                where member.workspace_id = ?::uuid and member.status = 'active'
                """, rs -> rs.next() ? rs.getInt(1) : 0, workspaceId);
        return count == null ? 0 : count;
    }

    private Member memberForUpdate(String workspaceId, String memberId) {
        Member member = jdbc.query("""
                select member.id::text, member.workspace_id::text, member.user_id::text, member.role, member.status,
                  coalesce(profile.display_name, ''), coalesce(user_record.email, ''), member.created_at
                from user_profile.workspace_members member
                left join user_profile.profiles profile on profile.user_id = member.user_id
                left join auth.users user_record on user_record.id = member.user_id
                where member.id = ?::uuid and member.workspace_id = ?::uuid and member.status = 'active'
                for update of member
                """, rs -> rs.next() ? member(rs) : null, memberId, workspaceId);
        if (member == null) throw new BusinessException("IDENTITY_WORKSPACE_MEMBER_NOT_FOUND", "workspace member not found", HttpStatus.NOT_FOUND);
        return member;
    }

    private Invitation invitationForUpdate(String workspaceId, String invitationId) {
        Invitation invitation = jdbc.query(invitationSelect("""
                where invitation.id = ?::uuid and invitation.workspace_id = ?::uuid
                for update
                """), rs -> rs.next() ? invitation(rs, "") : null, invitationId, workspaceId);
        if (invitation == null) throw new BusinessException("IDENTITY_WORKSPACE_INVITATION_NOT_FOUND", "workspace invitation not found", HttpStatus.NOT_FOUND);
        return invitation;
    }

    private void auditAndPublish(String actorUserId, String workspaceId, String eventType, String targetType, String targetId) {
        jdbc.update("""
                insert into user_profile.workspace_audit_events(
                  id, workspace_id, actor_user_id, event_type, target_type, target_id, payload, trace_id
                ) values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid, '{}'::jsonb, ?)
                """, UUID.randomUUID().toString(), workspaceId, actorUserId, eventType, targetType, targetId,
                RequestContext.traceId());
        outbox.stage("identity", eventType, () -> jdbc.update("""
                    insert into user_profile.identity_outbox_events(
                      id, aggregate_type, aggregate_id, event_type, payload
                    ) values (?::uuid, 'workspace', ?::uuid, ?,
                      jsonb_build_object('workspaceId', ?, 'targetType', ?, 'targetId', ?, 'actorUserId', ?, 'traceId', ?))
                    """, UUID.randomUUID().toString(), workspaceId, eventType, workspaceId, targetType, targetId, actorUserId,
                    RequestContext.traceId()));
    }

    private static String invitationSelect(String where) {
        return """
                select invitation.id::text, invitation.workspace_id::text, invitation.email, invitation.role,
                  invitation.invited_by::text, invitation.expires_at, invitation.accepted_by::text,
                  invitation.accepted_at, invitation.revoked_at, invitation.created_at
                from user_profile.workspace_invitations invitation
                """ + where;
    }

    private static Member member(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Member(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getTimestamp(8).toInstant());
    }

    private static Invitation invitation(java.sql.ResultSet rs, String token) throws java.sql.SQLException {
        return new Invitation(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getTimestamp(6).toInstant(), rs.getString(7), instant(rs, 8), instant(rs, 9),
                rs.getTimestamp(10).toInstant(), token);
    }

    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException {
        var value = rs.getTimestamp(index);
        return value == null ? null : value.toInstant();
    }

    private String randomToken() {
        byte[] bytes = new byte[48];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String normalizeEmail(String email) {
        String value = email == null ? "" : email.trim().toLowerCase(java.util.Locale.ROOT);
        if (!value.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || value.length() > 254) {
            throw new BusinessException("IDENTITY_INVALID_EMAIL", "email is invalid", HttpStatus.BAD_REQUEST);
        }
        return value;
    }

    private static String invitationRole(String role) {
        if (!"admin".equals(role) && !"member".equals(role)) {
            throw new BusinessException("IDENTITY_WORKSPACE_ROLE_INVALID", "role must be admin or member", HttpStatus.BAD_REQUEST);
        }
        return role;
    }

    private static BusinessException invalidInvitation() {
        return new BusinessException("IDENTITY_WORKSPACE_INVITATION_INVALID", "invitation is invalid or expired", HttpStatus.NOT_FOUND);
    }

    private record WorkspaceLock(int includedSeats, String status) { }

    public record Workspace(String id, String ownerUserId, String name, String planCode, int includedSeats,
                            int activeMemberCount, int pendingInvitationCount, String currentUserRole,
                            long reviewStorageBytes, int reviewRetentionDays, String status, Instant createdAt) { }
    public record Member(String id, String workspaceId, String userId, String role, String status,
                         String displayName, String email, Instant createdAt) { }
    public record Invitation(String id, String workspaceId, String email, String role, String invitedBy,
                             Instant expiresAt, String acceptedBy, Instant acceptedAt, Instant revokedAt,
                             Instant createdAt, String token) { }
    public record InviteCommand(String email, String role, Integer expiresInHours) { }
}
