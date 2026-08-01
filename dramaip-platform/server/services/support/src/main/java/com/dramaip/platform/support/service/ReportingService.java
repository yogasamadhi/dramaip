package com.dramaip.platform.support.service;

import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-only reporting projection API. The source of truth remains the owning domain services. */
@Service
public class ReportingService {
    private final JdbcTemplate jdbc;
    public ReportingService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public UserReport reportFor(String userId, int limit) {
        var bounded = Math.max(1, Math.min(limit, 100));
        var summary = jdbc.query("""
                select first_seen_at, last_seen_at, total_tokens, last_plan_code
                from reporting.user_summaries where user_id = ?::uuid
                """, (rs, row) -> new UsageSummary(rs.getObject(1, Instant.class), rs.getObject(2, Instant.class), rs.getLong(3), rs.getString(4)), userId);
        var orders = jdbc.query("""
                select order_id::text, plan_code, provider, round(amount * 100)::bigint, currency, status, subscription_id::text, updated_at
                from reporting.order_summaries where user_id = ?::uuid order by updated_at desc limit ?
                """, (rs, row) -> new OrderSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getObject(8, Instant.class)), userId, bounded);
        var subscriptions = jdbc.query("""
                select subscription_id::text, plan_code, status, period_start, period_end, updated_at
                from reporting.subscription_summaries where user_id = ?::uuid order by updated_at desc limit ?
                """, (rs, row) -> new SubscriptionSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, Instant.class),
                rs.getObject(5, Instant.class), rs.getObject(6, Instant.class)), userId, bounded);
        return new UserReport(summary.isEmpty() ? UsageSummary.empty() : summary.getFirst(), orders, subscriptions);
    }

    public record UserReport(UsageSummary usage, List<OrderSummary> orders, List<SubscriptionSummary> subscriptions) { }
    public record UsageSummary(Instant firstSeenAt, Instant lastSeenAt, long totalTokens, String lastPlanCode) {
        static UsageSummary empty() { return new UsageSummary(null, null, 0, ""); }
    }
    public record OrderSummary(String orderId, String planCode, String provider, long amountMinor, String currency, String status,
                               String subscriptionId, Instant updatedAt) { }
    public record SubscriptionSummary(String subscriptionId, String planCode, String status, Instant periodStart, Instant periodEnd,
                                      Instant updatedAt) { }
}
