package com.dramaip.platform.support.service;

import com.dramaip.platform.common.web.BusinessException;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
    private final JdbcTemplate jdbc;
    public NotificationService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Notification> list(String userId, int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                select id::text, type, title, body, source_event_id, read_at, created_at
                from notification.notifications where user_id = ?::uuid order by created_at desc limit ?
                """, (rs, row) -> new Notification(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getObject(6, Instant.class), rs.getObject(7, Instant.class)), userId, bounded);
    }

    @Transactional
    public Notification markRead(String userId, String notificationId) {
        Notification notification = jdbc.query("""
                update notification.notifications set read_at = coalesce(read_at, now()), updated_at = now()
                where id = ?::uuid and user_id = ?::uuid
                returning id::text, type, title, body, source_event_id, read_at, created_at
                """, rs -> rs.next() ? new Notification(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getObject(6, Instant.class), rs.getObject(7, Instant.class)) : null, notificationId, userId);
        if (notification == null) throw new BusinessException("SUPPORT_NOTIFICATION_NOT_FOUND", "notification not found", HttpStatus.NOT_FOUND);
        return notification;
    }

    public record Notification(String id, String type, String title, String body, String sourceEventId, Instant readAt, Instant createdAt) { }
}
