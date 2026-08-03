package com.dramaip.platform.quota.service;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.observability.DramaipMetrics;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Conditions every charge update in SQL, making concurrent reservations unable to overdraw an account. */
@Service
public class QuotaService {
    private final JdbcTemplate jdbc;
    private final DramaipMetrics metrics;

    public QuotaService(JdbcTemplate jdbc, DramaipMetrics metrics) {
        this.jdbc = jdbc;
        this.metrics = metrics;
    }

    public Balance balance(String userId) {
        return jdbc.query("""
                select plan_code, quota_tokens, used_tokens, period_start, period_end
                from quota.token_accounts
                where user_id = ?::uuid and status = 'active' and period_start <= now() and period_end > now()
                order by period_start desc limit 1
                """, result -> result.next()
                ? new Balance(result.getString("plan_code"), result.getLong("quota_tokens"), result.getLong("used_tokens"),
                    Math.max(0, result.getLong("quota_tokens") - result.getLong("used_tokens")),
                    instant(result, "period_start"), instant(result, "period_end")) : null, userId);
    }

    public List<Usage> usage(String userId, int limit) {
        int bounded = Math.max(1, Math.min(limit, 200));
        return jdbc.query("""
                select id::text, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at
                from quota.token_usage_logs where user_id = ?::uuid order by created_at desc limit ?
                """, (rs, row) -> usage(rs), userId, bounded);
    }

    public List<UsageTrendPoint> usageTrend(String userId, int days) {
        int bounded = Math.max(1, Math.min(days, 365));
        return jdbc.query("""
                select date_trunc('day', created_at)::date, coalesce(sum(total_tokens), 0)::bigint
                from quota.token_usage_logs where user_id = ?::uuid and created_at >= now() - (? * interval '1 day')
                group by 1 order by 1
                """, (rs, row) -> new UsageTrendPoint(rs.getObject(1, LocalDate.class), rs.getLong(2)), userId, bounded);
    }

    /** TCC try: creates an inactive account and a durable fence. No active balance is visible until confirm. */
    @Transactional
    public Provision tryProvision(ProvisionRequest request) {
        String key = request.subscriptionId() + ":" + request.periodStart();
        Fence fence = jdbc.query("select status, coalesce(account_id::text, '') from quota.tcc_provision_fences where business_key = ? for update", rs -> rs.next() ? new Fence(rs.getString(1), rs.getString(2)) : null, key);
        if (fence != null && "cancelled".equals(fence.status())) throw new BusinessException("QUOTA_TCC_HANGING", "provision was cancelled before try", HttpStatus.CONFLICT);
        if (fence != null && !fence.accountId().isBlank()) return provision(fence.accountId());
        if (fence == null) jdbc.update("insert into quota.tcc_provision_fences(business_key, status) values (?, 'tried')", key);
        String existing = jdbc.query("select id::text from quota.token_accounts where subscription_id = ?::uuid and period_start = ?::timestamptz for update", rs -> rs.next() ? rs.getString(1) : null, request.subscriptionId(), request.periodStart());
        String accountId = existing == null ? UUID.randomUUID().toString() : existing;
        if (existing == null) {
            jdbc.update("""
                    insert into quota.token_accounts(id, user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
                                                     period_start, period_end, quota_tokens, max_rpm, max_context_tokens, model_level,
                                                     plan_snapshot_source, plan_snapshot_at, status)
                    values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::numeric / 100, ?, ?::timestamptz, ?::timestamptz, ?, ?, ?, ?, 'billing_tcc', now(), 'tcc_pending')
                    """, accountId, request.userId(), request.subscriptionId(), request.planCode(), request.planName(), request.billingPeriod(),
                    request.planAmountMinor(), request.currency(), request.periodStart(), request.periodEnd(), request.quotaTokens(), request.maxRpm(), request.maxContextTokens(), request.modelLevel());
        }
        jdbc.update("update quota.tcc_provision_fences set account_id = ?::uuid, status = 'tried', updated_at = now() where business_key = ?", accountId, key);
        return provision(accountId);
    }

    /** TCC confirm is idempotent. An empty confirm remains harmless and never invents an account. */
    @Transactional
    public Provision confirmProvision(String subscriptionId, Instant periodStart) {
        String key = subscriptionId + ":" + periodStart;
        Fence fence = jdbc.query("select status, coalesce(account_id::text, '') from quota.tcc_provision_fences where business_key = ? for update", rs -> rs.next() ? new Fence(rs.getString(1), rs.getString(2)) : null, key);
        if (fence == null || fence.accountId().isBlank()) throw new BusinessException("QUOTA_TCC_EMPTY_CONFIRM", "provision try does not exist", HttpStatus.CONFLICT);
        if ("cancelled".equals(fence.status())) throw new BusinessException("QUOTA_TCC_HANGING", "provision has been cancelled", HttpStatus.CONFLICT);
        jdbc.update("update quota.token_accounts set status = 'active', updated_at = now() where id = ?::uuid and status = 'tcc_pending'", fence.accountId());
        jdbc.update("update quota.tcc_provision_fences set status = 'confirmed', updated_at = now() where business_key = ?", key);
        return provision(fence.accountId());
    }

    /** TCC cancel is idempotent and installs an empty-rollback fence when Try never arrived. */
    @Transactional
    public void cancelProvision(String subscriptionId, Instant periodStart) {
        String key = subscriptionId + ":" + periodStart;
        Fence fence = jdbc.query("select status, coalesce(account_id::text, '') from quota.tcc_provision_fences where business_key = ? for update", rs -> rs.next() ? new Fence(rs.getString(1), rs.getString(2)) : null, key);
        if (fence == null) {
            jdbc.update("insert into quota.tcc_provision_fences(business_key, status) values (?, 'cancelled')", key);
            return;
        }
        if ("confirmed".equals(fence.status())) throw new BusinessException("QUOTA_TCC_CONFIRMED", "confirmed provision must be compensated by a refund workflow", HttpStatus.CONFLICT);
        if (!fence.accountId().isBlank()) jdbc.update("update quota.token_accounts set status = 'cancelled', updated_at = now() where id = ?::uuid and status = 'tcc_pending'", fence.accountId());
        jdbc.update("update quota.tcc_provision_fences set status = 'cancelled', updated_at = now() where business_key = ?", key);
    }

    /**
     * Refunds are deliberately conservative: a token account may be frozen only before it has
     * recorded any settled or in-flight usage. The hold is durable and idempotent by refund id,
     * so billing can safely retry after a network failure without re-enabling entitlement.
     */
    @Transactional
    public RefundPreparation prepareRefund(String refundId, String userId, String subscriptionId, String reason) {
        RefundPreparation replay = jdbc.query("""
                select refund_id, coalesce(token_account_id::text, ''), status, used_tokens, reason
                from quota.refund_holds where refund_id = ? for update
                """, rs -> rs.next() ? new RefundPreparation(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5)) : null, refundId);
        if (replay != null) return replay;

        Account account = jdbc.query("""
                select id::text, quota_tokens, used_tokens from quota.token_accounts
                where user_id = ?::uuid and subscription_id = ?::uuid and status = 'active'
                  and period_start <= now() and period_end > now()
                order by period_start desc limit 1 for update
                """, rs -> rs.next() ? new Account(rs.getString(1), rs.getLong(2), rs.getLong(3)) : null, userId, subscriptionId);
        if (account == null) return persistRefundHold(new RefundPreparation(refundId, "", "manual_review", 0, "no active token account"), userId, subscriptionId);

        long inFlight = jdbc.queryForObject("""
                select count(*) from quota.token_reservations
                where token_account_id = ?::uuid and status in ('reserved', 'settlement_pending')
                """, Long.class, account.id());
        if (account.usedTokens() > 0 || inFlight > 0) {
            return persistRefundHold(new RefundPreparation(refundId, account.id(), "manual_review", account.usedTokens(), "quota has settled or in-flight usage"), userId, subscriptionId);
        }

        jdbc.update("update quota.token_accounts set status = 'refund_hold', updated_at = now() where id = ?::uuid and status = 'active'", account.id());
        RefundPreparation held = persistRefundHold(new RefundPreparation(refundId, account.id(), "held", 0, reason), userId, subscriptionId);
        jdbc.update("""
                insert into quota.quota_adjustments(id, adjustment_id, user_id, subscription_id, token_account_id, kind, reason,
                                                    delta_tokens, quota_before, quota_after)
                values (?::uuid, ?, ?::uuid, ?::uuid, ?::uuid, 'refund_hold', ?, 0, ?, ?)
                on conflict (adjustment_id) do nothing
                """, UUID.randomUUID().toString(), "refund-hold:" + refundId, userId, subscriptionId, account.id(), reason, account.quotaTokens(), account.quotaTokens());
        return held;
    }

    private RefundPreparation persistRefundHold(RefundPreparation preparation, String userId, String subscriptionId) {
        jdbc.update("""
                insert into quota.refund_holds(refund_id, user_id, subscription_id, token_account_id, status, used_tokens, reason)
                values (?, ?::uuid, ?::uuid, nullif(?, '')::uuid, ?, ?, ?)
                """, preparation.refundId(), userId, subscriptionId, preparation.tokenAccountId(), preparation.status(), preparation.usedTokens(), preparation.reason());
        return preparation;
    }

    private Provision provision(String accountId) {
        return jdbc.query("select id::text, status, quota_tokens, period_start, period_end from quota.token_accounts where id = ?::uuid", rs -> { if (!rs.next()) throw new BusinessException("QUOTA_ACCOUNT_NOT_FOUND", "token account not found", HttpStatus.NOT_FOUND); return new Provision(rs.getString(1), rs.getString(2), rs.getLong(3), instant(rs, 4), instant(rs, 5)); }, accountId);
    }

    @Transactional
    public Reservation reserve(String userId, String requestId, long requestedTokens) {
        if (requestId == null || requestId.isBlank() || requestedTokens < 1) {
            throw new BusinessException("QUOTA_INVALID_RESERVATION", "requestId and a positive token amount are required", HttpStatus.BAD_REQUEST);
        }
        Reservation replay = jdbc.query("""
                select id::text, token_account_id::text, request_id, reserved_tokens, status, created_at
                from quota.token_reservations where request_id = ? for update
                """, rs -> rs.next() ? reservation(rs) : null, requestId);
        if (replay != null) {
            String owner = jdbc.queryForObject("select user_id::text from quota.token_reservations where id = ?::uuid", String.class, replay.id());
            if (!owner.equals(userId)) throw new BusinessException("QUOTA_IDEMPOTENCY_CONFLICT", "requestId belongs to another user", HttpStatus.CONFLICT);
            metrics.quotaReservation("replayed");
            return replay;
        }
        Account account = jdbc.query("""
                select id::text, quota_tokens, used_tokens from quota.token_accounts
                where user_id = ?::uuid and status = 'active' and period_start <= now() and period_end > now()
                order by period_start desc limit 1 for update
                """, rs -> rs.next() ? new Account(rs.getString(1), rs.getLong(2), rs.getLong(3)) : null, userId);
        if (account == null) throw new BusinessException("QUOTA_ACCOUNT_NOT_FOUND", "active token account not found", HttpStatus.NOT_FOUND);
        int charged = jdbc.update("""
                update quota.token_accounts set used_tokens = used_tokens + ?, updated_at = now()
                where id = ?::uuid and used_tokens + ? <= quota_tokens
                """, requestedTokens, account.id(), requestedTokens);
        if (charged != 1) throw new BusinessException("QUOTA_INSUFFICIENT", "insufficient token quota", HttpStatus.PAYMENT_REQUIRED);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into quota.token_reservations(id, user_id, token_account_id, request_id, reserved_tokens, status)
                values (?::uuid, ?::uuid, ?::uuid, ?, ?, 'reserved')
                """, id, userId, account.id(), requestId, requestedTokens);
        Reservation reserved = jdbc.query("select id::text, token_account_id::text, request_id, reserved_tokens, status, created_at from quota.token_reservations where id = ?::uuid", rs -> {
            rs.next(); return reservation(rs);
        }, id);
        metrics.quotaReservation("accepted");
        return reserved;
    }

    @Transactional
    public Usage settle(String userId, String reservationId, String requestId, String model, long promptTokens, long completionTokens) {
        if (promptTokens < 0 || completionTokens < 0) throw new BusinessException("QUOTA_INVALID_USAGE", "token counts cannot be negative", HttpStatus.BAD_REQUEST);
        Reservation reservation = jdbc.query("""
                select id::text, token_account_id::text, request_id, reserved_tokens, status, created_at
                from quota.token_reservations where id = ?::uuid for update
                """, rs -> rs.next() ? reservation(rs) : null, reservationId);
        if (reservation == null) throw new BusinessException("QUOTA_RESERVATION_NOT_FOUND", "reservation not found", HttpStatus.NOT_FOUND);
        requireOwner(userId, reservation.id());
        if (!reservation.requestId().equals(requestId)) throw new BusinessException("QUOTA_REQUEST_MISMATCH", "reservation requestId does not match", HttpStatus.CONFLICT);
        Usage replay = jdbc.query("select id::text, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at from quota.token_usage_logs where request_id = ?", rs -> rs.next() ? usage(rs) : null, requestId);
        if (replay != null) return replay;
        if (!"reserved".equals(reservation.status())) throw new BusinessException("QUOTA_RESERVATION_NOT_SETTLEABLE", "reservation is not settleable", HttpStatus.CONFLICT);
        long total = promptTokens + completionTokens;
        long delta = total - reservation.reservedTokens();
        if (delta < 0) jdbc.update("update quota.token_accounts set used_tokens = greatest(used_tokens - ?, 0), updated_at = now() where id = ?::uuid", -delta, reservation.accountId());
        if (delta > 0 && jdbc.update("update quota.token_accounts set used_tokens = used_tokens + ?, updated_at = now() where id = ?::uuid and used_tokens + ? <= quota_tokens", delta, reservation.accountId(), delta) != 1) {
            throw new BusinessException("QUOTA_INSUFFICIENT", "usage exceeds remaining quota", HttpStatus.PAYMENT_REQUIRED);
        }
        jdbc.update("update quota.token_reservations set actual_tokens = ?, status = 'settled', updated_at = now() where id = ?::uuid", total, reservation.id());
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into quota.token_usage_logs(id, user_id, subscription_id, token_account_id, request_id, model, prompt_tokens, completion_tokens, total_tokens)
                select ?::uuid, account.user_id, account.subscription_id, account.id, ?, ?, ?, ?, ?
                from quota.token_accounts account where account.id = ?::uuid
                """, id, requestId, model, promptTokens, completionTokens, total, reservation.accountId());
        return jdbc.query("select id::text, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at from quota.token_usage_logs where id = ?::uuid", rs -> { rs.next(); return usage(rs); }, id);
    }

    @Transactional
    public Reservation cancel(String userId, String reservationId) {
        Reservation reservation = jdbc.query("""
                select id::text, token_account_id::text, request_id, reserved_tokens, status, created_at
                from quota.token_reservations where id = ?::uuid for update
                """, rs -> rs.next() ? reservation(rs) : null, reservationId);
        if (reservation == null) throw new BusinessException("QUOTA_RESERVATION_NOT_FOUND", "reservation not found", HttpStatus.NOT_FOUND);
        requireOwner(userId, reservation.id());
        if ("reserved".equals(reservation.status())) {
            jdbc.update("update quota.token_accounts set used_tokens = greatest(used_tokens - ?, 0), updated_at = now() where id = ?::uuid", reservation.reservedTokens(), reservation.accountId());
            jdbc.update("update quota.token_reservations set status = 'cancelled', updated_at = now() where id = ?::uuid", reservation.id());
            return new Reservation(reservation.id(), reservation.accountId(), reservation.requestId(), reservation.reservedTokens(), "cancelled", reservation.createdAt());
        }
        return reservation;
    }

    /** Releases exactly the rows that changed state, so multiple job replicas cannot double-release quota. */
    @Transactional
    public int expireReservations() {
        return jdbc.update("""
                with expired as (
                  update quota.token_reservations
                  set status = 'expired', updated_at = now()
                  where status = 'reserved' and expires_at <= now()
                  returning token_account_id, reserved_tokens
                ), released as (
                  select token_account_id, sum(reserved_tokens) as tokens from expired group by token_account_id
                )
                update quota.token_accounts account set used_tokens = greatest(account.used_tokens - released.tokens, 0), updated_at = now()
                from released where account.id = released.token_account_id
                """);
    }

    private Reservation reservation(java.sql.ResultSet result) throws java.sql.SQLException {
        return new Reservation(result.getString(1), result.getString(2), result.getString(3), result.getLong(4), result.getString(5), instant(result, 6));
    }
    private void requireOwner(String userId, String reservationId) {
        String owner = jdbc.queryForObject("select user_id::text from quota.token_reservations where id = ?::uuid", String.class, reservationId);
        if (!userId.equals(owner)) throw new BusinessException("QUOTA_FORBIDDEN", "reservation belongs to another user", HttpStatus.FORBIDDEN);
    }
    private Usage usage(java.sql.ResultSet result) throws java.sql.SQLException {
        return new Usage(result.getString(1), result.getString(2), result.getString(3), result.getLong(4), result.getLong(5), result.getLong(6), result.getString(7), instant(result, 8));
    }
    private static Instant instant(java.sql.ResultSet result, int index) throws java.sql.SQLException {
        var timestamp = result.getTimestamp(index);
        return timestamp == null ? null : timestamp.toInstant();
    }
    private static Instant instant(java.sql.ResultSet result, String name) throws java.sql.SQLException {
        var timestamp = result.getTimestamp(name);
        return timestamp == null ? null : timestamp.toInstant();
    }
    private record Account(String id, long quotaTokens, long usedTokens) { }
    private record Fence(String status, String accountId) { }
    public record Balance(String planCode, long quotaTokens, long usedTokens, long remainingTokens, Instant periodStart, Instant periodEnd) { }
    public record Reservation(String id, String accountId, String requestId, long reservedTokens, String status, Instant createdAt) { }
    public record Usage(String id, String requestId, String model, long promptTokens, long completionTokens, long totalTokens, String status, Instant createdAt) { }
    public record UsageTrendPoint(LocalDate day, long totalTokens) { }
    public record ProvisionRequest(String userId, String subscriptionId, String planCode, String planName, String billingPeriod, long planAmountMinor, String currency, long quotaTokens, int maxRpm, long maxContextTokens, String modelLevel, Instant periodStart, Instant periodEnd) { }
    public record Provision(String accountId, String status, long quotaTokens, Instant periodStart, Instant periodEnd) { }
    public record RefundPreparation(String refundId, String tokenAccountId, String status, long usedTokens, String reason) { }
}
