package com.dramaip.platform.reporting.service;

import com.fasterxml.jackson.annotation.JsonProperty;
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
                """, (rs, row) -> new UsageSummary(instant(rs, 1), instant(rs, 2), rs.getLong(3), rs.getString(4)), userId);
        var orders = jdbc.query("""
                select order_id::text, plan_code, provider, round(amount * 100)::bigint, currency, status, subscription_id::text, updated_at
                from reporting.order_summaries where user_id = ?::uuid order by updated_at desc limit ?
                """, (rs, row) -> new OrderSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5),
                rs.getString(6), rs.getString(7), instant(rs, 8)), userId, bounded);
        var subscriptions = jdbc.query("""
                select subscription_id::text, plan_code, status, period_start, period_end, updated_at
                from reporting.subscription_summaries where user_id = ?::uuid order by updated_at desc limit ?
                """, (rs, row) -> new SubscriptionSummary(rs.getString(1), rs.getString(2), rs.getString(3), instant(rs, 4),
                instant(rs, 5), instant(rs, 6)), userId, bounded);
        return new UserReport(summary.isEmpty() ? UsageSummary.empty() : summary.getFirst(), orders, subscriptions);
    }

    public AdminOverview adminOverview() {
        return jdbc.queryForObject("""
                select
                  (select count(*) from reporting.user_summaries) as user_count,
                  (select count(*) from reporting.order_summaries where status = 'paid') as paid_order_count,
                  (select count(*) from reporting.subscription_summaries where status = 'active') as active_subscription_count,
                  coalesce((select sum(total_tokens) from reporting.user_summaries), 0) as total_tokens,
                  (select count(*) from reporting.projection_exceptions where status = 'open') as open_exception_count,
                  coalesce((select max(received_at)::text from reporting.source_events), '') as last_event_at
                """, (rs, row) -> new AdminOverview(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getString(6)));
    }

    public AdminUsers adminUsers(int limit, String cursor, String query) {
        Page page = page(limit, cursor);
        String search = clean(query);
        List<AdminUserSummary> rows = jdbc.query("""
                select user_id::text, first_seen_at::text, last_seen_at::text, total_tokens, last_plan_code
                from reporting.user_summaries
                where (? = '' or user_id::text ilike '%' || ? || '%' or last_plan_code ilike '%' || ? || '%')
                order by last_seen_at desc, user_id desc limit ? offset ?
                """, (rs, row) -> new AdminUserSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5)),
                search, search, search, page.limit() + 1, page.offset());
        return new AdminUsers(page.rows(rows), page.nextCursor(rows.size()));
    }

    public AdminOrders adminOrders(int limit, String cursor, String query) {
        Page page = page(limit, cursor);
        String search = clean(query);
        List<AdminOrderSummary> rows = jdbc.query("""
                select order_id::text, user_id::text, plan_code, provider, amount, currency, status,
                       coalesce(subscription_id::text, ''), updated_at::text
                from reporting.order_summaries
                where (? = '' or order_id::text ilike '%' || ? || '%' or user_id::text ilike '%' || ? || '%' or plan_code ilike '%' || ? || '%')
                order by updated_at desc, order_id desc limit ? offset ?
                """, (rs, row) -> new AdminOrderSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9)),
                search, search, search, search, page.limit() + 1, page.offset());
        return new AdminOrders(page.rows(rows), page.nextCursor(rows.size()));
    }

    public AdminSubscriptions adminSubscriptions(int limit, String cursor, String query) {
        Page page = page(limit, cursor);
        String search = clean(query);
        List<AdminSubscriptionSummary> rows = jdbc.query("""
                select subscription_id::text, user_id::text, plan_code, status, coalesce(period_start::text, ''),
                       coalesce(period_end::text, ''), updated_at::text
                from reporting.subscription_summaries
                where (? = '' or subscription_id::text ilike '%' || ? || '%' or user_id::text ilike '%' || ? || '%' or plan_code ilike '%' || ? || '%')
                order by updated_at desc, subscription_id desc limit ? offset ?
                """, (rs, row) -> new AdminSubscriptionSummary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7)), search, search, search, search, page.limit() + 1, page.offset());
        return new AdminSubscriptions(page.rows(rows), page.nextCursor(rows.size()));
    }

    public AdminExceptions adminExceptions(int limit, boolean includeResolved, String cursor, String query) {
        Page page = page(limit, cursor);
        String search = clean(query);
        List<AdminProjectionException> rows = jdbc.query("""
                select id::text, event_id, event_type, status, summary, trace_id, created_at::text,
                       coalesce(resolved_at::text, ''), coalesce(resolved_by::text, ''), resolution_reason
                from reporting.projection_exceptions
                where (? or status = 'open')
                  and (? = '' or event_id ilike '%' || ? || '%' or event_type ilike '%' || ? || '%' or summary ilike '%' || ? || '%')
                order by created_at desc, id desc limit ? offset ?
                """, (rs, row) -> new AdminProjectionException(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10)), includeResolved, search, search, search, search,
                page.limit() + 1, page.offset());
        return new AdminExceptions(page.rows(rows), page.nextCursor(rows.size()));
    }

    private static Page page(int requestedLimit, String cursor) {
        int limit = requestedLimit <= 0 || requestedLimit > 100 ? 50 : requestedLimit;
        int offset;
        try { offset = Integer.parseInt(clean(cursor)); } catch (NumberFormatException exception) { offset = 0; }
        return new Page(limit, Math.max(0, Math.min(offset, 100_000)));
    }

    private static String clean(String value) { return value == null ? "" : value.trim(); }
    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException {
        var timestamp = rs.getTimestamp(index);
        return timestamp == null ? null : timestamp.toInstant();
    }

    private record Page(int limit, int offset) {
        <T> List<T> rows(List<T> rows) { return rows.size() > limit ? rows.subList(0, limit) : rows; }
        String nextCursor(int count) { return count > limit ? Integer.toString(offset + limit) : ""; }
    }

    public record UserReport(UsageSummary usage, List<OrderSummary> orders, List<SubscriptionSummary> subscriptions) { }
    public record UsageSummary(Instant firstSeenAt, Instant lastSeenAt, long totalTokens, String lastPlanCode) {
        static UsageSummary empty() { return new UsageSummary(null, null, 0, ""); }
    }
    public record OrderSummary(String orderId, String planCode, String provider, long amountMinor, String currency, String status,
                               String subscriptionId, Instant updatedAt) { }
    public record SubscriptionSummary(String subscriptionId, String planCode, String status, Instant periodStart, Instant periodEnd,
                                      Instant updatedAt) { }
    public record AdminOverview(@JsonProperty("user_count") long userCount, @JsonProperty("paid_order_count") long paidOrderCount,
                                @JsonProperty("active_subscription_count") long activeSubscriptionCount, @JsonProperty("total_tokens") long totalTokens,
                                @JsonProperty("open_exception_count") long openExceptionCount, @JsonProperty("last_event_at") String lastEventAt) { }
    public record AdminUserSummary(@JsonProperty("user_id") String userId, @JsonProperty("first_seen_at") String firstSeenAt,
                                   @JsonProperty("last_seen_at") String lastSeenAt, @JsonProperty("total_tokens") long totalTokens,
                                   @JsonProperty("last_plan_code") String lastPlanCode) { }
    public record AdminOrderSummary(@JsonProperty("order_id") String orderId, @JsonProperty("user_id") String userId,
                                    @JsonProperty("plan_code") String planCode, String provider, String amount, String currency, String status,
                                    @JsonProperty("subscription_id") String subscriptionId, @JsonProperty("updated_at") String updatedAt) { }
    public record AdminSubscriptionSummary(@JsonProperty("subscription_id") String subscriptionId, @JsonProperty("user_id") String userId,
                                           @JsonProperty("plan_code") String planCode, String status, @JsonProperty("period_start") String periodStart,
                                           @JsonProperty("period_end") String periodEnd, @JsonProperty("updated_at") String updatedAt) { }
    public record AdminProjectionException(String id, @JsonProperty("event_id") String eventId, @JsonProperty("event_type") String eventType,
                                           String status, String summary, @JsonProperty("trace_id") String traceId,
                                           @JsonProperty("created_at") String createdAt, @JsonProperty("resolved_at") String resolvedAt,
                                           @JsonProperty("resolved_by") String resolvedBy, @JsonProperty("resolution_reason") String resolutionReason) { }
    public record AdminUsers(List<AdminUserSummary> users, @JsonProperty("next_cursor") String nextCursor) { }
    public record AdminOrders(List<AdminOrderSummary> orders, @JsonProperty("next_cursor") String nextCursor) { }
    public record AdminSubscriptions(List<AdminSubscriptionSummary> subscriptions, @JsonProperty("next_cursor") String nextCursor) { }
    public record AdminExceptions(List<AdminProjectionException> exceptions, @JsonProperty("next_cursor") String nextCursor) { }
}
