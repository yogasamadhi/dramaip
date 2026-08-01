package com.dramaip.platform.identity.service;

import com.dramaip.platform.common.web.BusinessException;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {
    private final JdbcTemplate jdbc;
    public ProfileService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Profile profile(String userId) {
        Profile profile = jdbc.query("""
                select users.id::text, users.email, users.phone, users.status, profiles.display_name, profiles.avatar_url, profiles.locale, profiles.timezone
                from auth.users users left join user_profile.profiles profiles on profiles.user_id = users.id
                where users.id = ?::uuid
                """, rs -> rs.next() ? new Profile(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8)) : null, userId);
        if (profile == null) throw new BusinessException("IDENTITY_USER_NOT_FOUND", "user not found", HttpStatus.NOT_FOUND);
        return profile;
    }

    @Transactional
    public Profile update(String userId, UpdateProfile update) {
        if (jdbc.update("""
                insert into user_profile.profiles(user_id, display_name, avatar_url, locale, timezone)
                values (?::uuid, ?, ?, ?, ?)
                on conflict(user_id) do update set display_name = excluded.display_name, avatar_url = excluded.avatar_url,
                  locale = excluded.locale, timezone = excluded.timezone, updated_at = now()
                """, userId, update.displayName(), update.avatarUrl(), update.locale(), update.timezone()) != 1) {
            throw new BusinessException("IDENTITY_PROFILE_UPDATE_FAILED", "profile update failed", HttpStatus.CONFLICT);
        }
        return profile(userId);
    }

    public List<Workspace> workspaces(String userId) {
        return jdbc.query("""
                select workspace.id::text, workspace.name, workspace.plan_code, member.role, workspace.included_seats,
                  workspace.review_storage_bytes, workspace.review_retention_days, workspace.created_at
                from user_profile.workspace_members member join user_profile.workspaces workspace on workspace.id = member.workspace_id
                where member.user_id = ?::uuid and member.status = 'active' order by workspace.created_at
                """, (rs, row) -> new Workspace(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5), rs.getLong(6), rs.getInt(7), rs.getTimestamp(8).toInstant()), userId);
    }

    /** Internal callers receive only the authenticated caller's membership, never an arbitrary workspace roster. */
    public Workspace workspace(String userId, String workspaceId) {
        Workspace workspace = jdbc.query("""
                select workspace.id::text, workspace.name, workspace.plan_code, member.role, workspace.included_seats,
                  workspace.review_storage_bytes, workspace.review_retention_days, workspace.created_at
                from user_profile.workspace_members member join user_profile.workspaces workspace on workspace.id = member.workspace_id
                where member.user_id = ?::uuid and member.workspace_id = ?::uuid and member.status = 'active'
                """, rs -> rs.next() ? new Workspace(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5), rs.getLong(6), rs.getInt(7), rs.getTimestamp(8).toInstant()) : null, userId, workspaceId);
        if (workspace == null) throw new BusinessException("IDENTITY_WORKSPACE_ACCESS_DENIED", "workspace membership is required", HttpStatus.FORBIDDEN);
        return workspace;
    }

    public record Profile(String id, String email, String phone, String status, String displayName, String avatarUrl, String locale, String timezone) { }
    public record UpdateProfile(String displayName, String avatarUrl, String locale, String timezone) { }
    public record Workspace(String id, String name, String planCode, String currentUserRole, int includedSeats, long reviewStorageBytes, int reviewRetentionDays, Instant createdAt) { }
}
