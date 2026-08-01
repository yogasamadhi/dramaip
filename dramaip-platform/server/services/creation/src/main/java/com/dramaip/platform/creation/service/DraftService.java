package com.dramaip.platform.creation.service;

import com.dramaip.platform.common.web.BusinessException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DraftService {
    private final JdbcTemplate jdbc;
    public DraftService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Draft> list(String userId) {
        return jdbc.query("""
                select id::text, client_id, kind, capture_mode, title, content, ai_expansion, created_at, updated_at
                from inspiration.mobile_drafts where user_id = ?::uuid order by updated_at desc
                """, (rs, row) -> draft(rs), userId);
    }

    @Transactional
    public Draft upsert(String userId, CreateDraft input) {
        if (!List.of("inspiration", "character", "project").contains(input.kind()) || !List.of("text", "voice").contains(input.captureMode())) {
            throw new BusinessException("CREATION_INVALID_DRAFT", "unsupported draft kind or capture mode", HttpStatus.BAD_REQUEST);
        }
        return jdbc.query("""
                insert into inspiration.mobile_drafts(id, user_id, client_id, kind, capture_mode, title, content)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, ?)
                on conflict (user_id, client_id) do update set kind = excluded.kind, capture_mode = excluded.capture_mode,
                    title = excluded.title, content = excluded.content, updated_at = now()
                returning id::text, client_id, kind, capture_mode, title, content, ai_expansion, created_at, updated_at
                """, rs -> { rs.next(); return draft(rs); }, UUID.randomUUID().toString(), userId, input.clientId(), input.kind(), input.captureMode(), input.title(), input.content());
    }

    @Transactional
    public void delete(String userId, String draftId) {
        if (jdbc.update("delete from inspiration.mobile_drafts where id = ?::uuid and user_id = ?::uuid", draftId, userId) != 1) {
            throw new BusinessException("CREATION_DRAFT_NOT_FOUND", "draft not found", HttpStatus.NOT_FOUND);
        }
    }

    private Draft draft(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Draft(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getObject(8, Instant.class), rs.getObject(9, Instant.class));
    }
    public record CreateDraft(String clientId, String kind, String captureMode, String title, String content) { }
    public record Draft(String id, String clientId, String kind, String captureMode, String title, String content, String aiExpansion, Instant createdAt, Instant updatedAt) { }
}
