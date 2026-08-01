package com.dramaip.platform.support.service;

import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.annotation.JsonProperty;
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

    public List<DeliveryAttempt> deliveryAttempts(String status, int limit) {
        String requestedStatus = status == null ? "" : status.trim();
        if (!requestedStatus.isEmpty() && !"failed".equals(requestedStatus) && !"delivered".equals(requestedStatus)) {
            throw new BusinessException("SUPPORT_DELIVERY_STATUS_INVALID", "delivery status is invalid", HttpStatus.BAD_REQUEST);
        }
        int bounded = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                select attempt.id::text, attempt.event_id, attempt.notification_id::text, notification.user_id::text,
                       attempt.channel, attempt.status, coalesce(attempt.failure, ''), attempt.attempted_at::text
                from notification.delivery_attempts attempt
                join notification.notifications notification on notification.id = attempt.notification_id
                where (? = '' or attempt.status = ?)
                order by attempt.attempted_at desc limit ?
                """, (rs, row) -> new DeliveryAttempt(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8)), requestedStatus, requestedStatus, bounded);
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
    public record DeliveryAttempt(String id, @JsonProperty("event_id") String eventId, @JsonProperty("notification_id") String notificationId,
                                  @JsonProperty("user_id") String userId, String channel, String status, String failure,
                                  @JsonProperty("attempted_at") String attemptedAt) { }
}
