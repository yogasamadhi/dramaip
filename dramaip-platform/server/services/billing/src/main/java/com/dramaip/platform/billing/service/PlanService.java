package com.dramaip.platform.billing.service;

import com.dramaip.platform.billing.client.QuotaProvisionClient;
import com.dramaip.platform.billing.client.QuotaRefundClient;
import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;

@Service
public class PlanService {
    private final JdbcTemplate jdbc;
    private final QuotaProvisionClient quota;
    private final QuotaRefundClient refunds;
    private final String internalToken;
    public PlanService(JdbcTemplate jdbc, QuotaProvisionClient quota, QuotaRefundClient refunds, @Value("${dramaip.internal.token:}") String internalToken) { this.jdbc = jdbc; this.quota = quota; this.refunds = refunds; this.internalToken = internalToken; }

    public List<Plan> listPlans() {
        return jdbc.query("""
                select id::text, code, name, billing_period, cast(round(price * 100) as bigint), currency, monthly_token_quota,
                       max_rpm, max_context_tokens, model_level, purchase_mode, entitlements::text
                from billing.plans where is_active = true order by price, code
                """, (rs, row) -> new Plan(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6),
                rs.getLong(7), rs.getInt(8), rs.getLong(9), rs.getString(10), rs.getString(11), rs.getString(12)));
    }

    @Transactional
    public Order createOrder(String userId, CreateOrder request) {
        Plan plan = jdbc.query("""
                select id::text, code, name, billing_period, cast(round(price * 100) as bigint), currency, monthly_token_quota,
                       max_rpm, max_context_tokens, model_level, purchase_mode, entitlements::text
                from billing.plans where code = ? and is_active = true
                """, rs -> rs.next() ? new Plan(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), rs.getLong(7), rs.getInt(8), rs.getLong(9), rs.getString(10), rs.getString(11), rs.getString(12)) : null, request.planCode());
        if (plan == null) throw new BusinessException("BILLING_PLAN_NOT_FOUND", "plan not found", HttpStatus.NOT_FOUND);
        if (!"self_service".equals(plan.purchaseMode())) throw new BusinessException("BILLING_SALES_CONTACT_REQUIRED", "plan requires sales contact", HttpStatus.CONFLICT);
        if (!"simulated".equals(request.provider())) {
            throw new BusinessException("BILLING_PROVIDER_NOT_CONFIGURED", "only the simulated provider is enabled in this deployment", HttpStatus.SERVICE_UNAVAILABLE);
        }
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into billing.orders(id, user_id, plan_id, amount, currency, status, provider, provider_order_id)
                values (?::uuid, ?::uuid, ?::uuid, ?::numeric / 100, ?, 'pending', ?, ?)
                """, id, userId, plan.id(), plan.amountMinor(), plan.currency(), request.provider(), id);
        jdbc.update("""
                insert into billing.outbox_events(id, aggregate_type, aggregate_id, event_type, payload)
                values (?::uuid, 'order', ?::uuid, 'billing.checkout.created', jsonb_build_object('orderId', ?, 'userId', ?, 'amountMinor', ?))
                """, UUID.randomUUID().toString(), id, id, userId, plan.amountMinor());
        return order(id, userId);
    }

    public List<Order> orders(String userId) {
        jdbc.update("""
                update billing.orders set status = 'expired', updated_at = now()
                where user_id = ?::uuid and status = 'pending' and payment_expires_at <= now()
                """, userId);
        return jdbc.query(orderSelect("where user_id = ?::uuid order by created_at desc limit 50"), (rs, row) -> order(rs), userId);
    }

    public Order order(String orderId, String userId) {
        Order order = jdbc.query(orderSelect("where id = ?::uuid and user_id = ?::uuid"), rs -> rs.next() ? order(rs) : null, orderId, userId);
        if (order == null) throw new BusinessException("BILLING_ORDER_NOT_FOUND", "order not found", HttpStatus.NOT_FOUND);
        return order;
    }

    public Subscription currentSubscription(String userId) {
        Subscription subscription = jdbc.query("""
                select id::text, plan_id::text, plan_code, plan_name, provider, status, current_period_start, current_period_end,
                       cancel_at_period_end, coalesce(renewal_plan_code, ''), coalesce(entitlements_snapshot::text, '{}')
                from billing.subscriptions where user_id = ?::uuid and status in ('active', 'quota_pending', 'activation_failed')
                order by created_at desc limit 1
                """, rs -> rs.next() ? subscription(rs) : null, userId);
        if (subscription == null) throw new BusinessException("BILLING_SUBSCRIPTION_NOT_FOUND", "subscription not found", HttpStatus.NOT_FOUND);
        return subscription;
    }

    /** Payment activation remains quota-gated; this endpoint is intentionally limited to the configured non-production provider. */
    @Transactional
    public Payment confirmSimulatedPayment(String userId, String orderId) {
        Order order = jdbc.query(orderSelect("where id = ?::uuid and user_id = ?::uuid for update"), rs -> rs.next() ? order(rs) : null, orderId, userId);
        if (order == null) throw new BusinessException("BILLING_ORDER_NOT_FOUND", "order not found", HttpStatus.NOT_FOUND);
        if (!"simulated".equals(order.provider())) throw new BusinessException("BILLING_PAYMENT_FORBIDDEN", "order is not simulated", HttpStatus.CONFLICT);
        Payment replay = jdbc.query("select id::text, order_id::text, provider, status, cast(round(amount * 100) as bigint), currency, created_at from billing.payments where order_id = ?::uuid and status = 'paid' order by created_at desc limit 1", rs -> rs.next() ? payment(rs) : null, orderId);
        if (replay != null) return replay;
        if (!"pending".equals(order.status())) throw new BusinessException("BILLING_ORDER_NOT_PAYABLE", "order status is " + order.status(), HttpStatus.CONFLICT);
        String subscriptionId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        Instant end = now.plus(30, ChronoUnit.DAYS);
        jdbc.update("""
                insert into billing.subscriptions(id, user_id, plan_id, provider, provider_subscription_id, status, current_period_start, current_period_end)
                values (?::uuid, ?::uuid, ?::uuid, 'simulated', ?, 'quota_pending', ?::timestamptz, ?::timestamptz)
                """, subscriptionId, userId, order.planId(), "simulated_" + subscriptionId, now, end);
        jdbc.update("update billing.orders set status = 'paid', paid_at = now(), updated_at = now(), subscription_id = ?::uuid where id = ?::uuid", subscriptionId, orderId);
        String paymentId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into billing.payments(id, user_id, order_id, provider, provider_payment_id, amount, currency, status, raw_payload)
                values (?::uuid, ?::uuid, ?::uuid, 'simulated', ?, ?::numeric / 100, ?, 'paid', jsonb_build_object('provider', 'simulated'))
                """, paymentId, userId, orderId, "simulated_" + paymentId, order.amountMinor(), order.currency());
        // Keep the period snapshot in lockstep with the subscription. Renewal, refunds and
        // reconciliation use this immutable snapshot rather than rereading a mutable plan row.
        jdbc.update("""
                insert into billing.subscription_periods(
                  id, subscription_id, user_id, order_id, status, period_start, period_end,
                  plan_id, plan_code, plan_name, billing_period, plan_price, currency,
                  monthly_token_quota, max_rpm, max_context_tokens, model_level,
                  plan_snapshot_source, plan_snapshot_at, source
                )
                select ?::uuid, ?::uuid, ?::uuid, ?::uuid, 'quota_pending', ?::timestamptz, ?::timestamptz,
                       plan.id, plan.code, plan.name, plan.billing_period, plan.price, plan.currency,
                       plan.monthly_token_quota, plan.max_rpm, plan.max_context_tokens, plan.model_level,
                       'checkout', now(), 'java_billing'
                from billing.plans plan where plan.id = ?::uuid
                on conflict (subscription_id, period_start) do nothing
                """, UUID.randomUUID().toString(), subscriptionId, userId, orderId, now, end, order.planId());
        jdbc.update("""
                insert into billing.outbox_events(id, aggregate_type, aggregate_id, event_type, payload)
                values (?::uuid, 'billing.payment', ?::uuid, 'payment.succeeded.v1', jsonb_build_object('paymentId', ?, 'orderId', ?, 'subscriptionId', ?))
                """, UUID.randomUUID().toString(), paymentId, paymentId, orderId, subscriptionId);
        Plan plan = jdbc.query("select id::text, code, name, billing_period, cast(round(price * 100) as bigint), currency, monthly_token_quota, max_rpm, max_context_tokens, model_level, purchase_mode, entitlements::text from billing.plans where id = ?::uuid", rs -> rs.next() ? new Plan(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), rs.getLong(7), rs.getInt(8), rs.getLong(9), rs.getString(10), rs.getString(11), rs.getString(12)) : null, order.planId());
        if (plan == null) throw new BusinessException("BILLING_PLAN_NOT_FOUND", "order plan not found", HttpStatus.CONFLICT);
        try {
            quota.tryProvision(internalToken, new QuotaProvisionClient.ProvisionRequest(userId, subscriptionId, plan.code(), plan.name(), plan.billingPeriod(), plan.amountMinor(), plan.currency(), plan.monthlyTokenQuota(), plan.maxRpm(), plan.maxContextTokens(), plan.modelLevel(), now, end));
            quota.confirm(internalToken, subscriptionId, new QuotaProvisionClient.PeriodRequest(now));
            jdbc.update("update billing.subscriptions set status = 'active', quota_provisioned_at = now(), updated_at = now() where id = ?::uuid", subscriptionId);
            jdbc.update("update billing.subscription_periods set status = 'active', activated_at = now(), updated_at = now() where subscription_id = ?::uuid and period_start = ?::timestamptz", subscriptionId, now);
        } catch (RuntimeException exception) {
            try { quota.cancel(internalToken, subscriptionId, new QuotaProvisionClient.PeriodRequest(now)); } catch (RuntimeException ignored) { /* TCC fence preserves forward recovery */ }
            throw new BusinessException("BILLING_QUOTA_PROVISION_FAILED", "payment is pending quota provisioning", HttpStatus.SERVICE_UNAVAILABLE);
        }
        return jdbc.query("select id::text, order_id::text, provider, status, cast(round(amount * 100) as bigint), currency, created_at from billing.payments where id = ?::uuid", rs -> { rs.next(); return payment(rs); }, paymentId);
    }

    @Transactional
    public Subscription cancelSubscription(String userId, boolean immediate) {
        Subscription subscription = currentSubscriptionForUpdate(userId);
        if (immediate) {
            jdbc.update("update billing.subscriptions set status = 'canceled', canceled_at = now(), cancel_at_period_end = false, updated_at = now() where id = ?::uuid", subscription.id());
        } else {
            jdbc.update("update billing.subscriptions set cancel_at_period_end = true, updated_at = now() where id = ?::uuid", subscription.id());
        }
        return subscription(subscription.id(), userId);
    }

    @Transactional
    public Subscription resumeSubscription(String userId) {
        Subscription subscription = currentSubscriptionForUpdate(userId);
        if (!"active".equals(subscription.status())) throw new BusinessException("BILLING_SUBSCRIPTION_NOT_RESUMABLE", "subscription is not active", HttpStatus.CONFLICT);
        jdbc.update("update billing.subscriptions set cancel_at_period_end = false, canceled_at = null, updated_at = now() where id = ?::uuid", subscription.id());
        return subscription(subscription.id(), userId);
    }

    /** Changes are scheduled at renewal. Upgrade/refund quota movement is deliberately handled by the TCC worker, never in this local SQL transaction. */
    @Transactional
    public Subscription schedulePlanChange(String userId, String planCode, String idempotencyKey) {
        Subscription subscription = currentSubscriptionForUpdate(userId);
        Plan target = jdbc.query("select id::text, code, name, billing_period, cast(round(price * 100) as bigint), currency, monthly_token_quota, max_rpm, max_context_tokens, model_level, purchase_mode, entitlements::text from billing.plans where code = ? and is_active = true", rs -> rs.next() ? new Plan(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), rs.getLong(7), rs.getInt(8), rs.getLong(9), rs.getString(10), rs.getString(11), rs.getString(12)) : null, planCode);
        if (target == null || !"self_service".equals(target.purchaseMode())) throw new BusinessException("BILLING_PLAN_NOT_AVAILABLE", "plan is not self-service", HttpStatus.CONFLICT);
        String key = idempotencyKey == null || idempotencyKey.isBlank() ? UUID.randomUUID().toString() : idempotencyKey;
        jdbc.update("""
                insert into billing.subscription_changes(id, subscription_id, user_id, kind, status, idempotency_key, effective_at, details)
                values (?::uuid, ?::uuid, ?::uuid, 'plan_change', 'scheduled', ?, ?::timestamptz, jsonb_build_object('planCode', ?))
                on conflict (subscription_id, idempotency_key) do nothing
                """, UUID.randomUUID().toString(), subscription.id(), userId, key, subscription.currentPeriodEnd(), target.code());
        jdbc.update("update billing.subscriptions set scheduled_plan_id = ?::uuid, scheduled_change_at = ?::timestamptz, renewal_plan_code = ?, updated_at = now() where id = ?::uuid", target.id(), subscription.currentPeriodEnd(), target.code(), subscription.id());
        return subscription(subscription.id(), userId);
    }

    @Transactional
    public Refund requestRefund(String userId, String reason, String idempotencyKey) {
        Subscription subscription = currentSubscriptionForUpdate(userId);
        String key = idempotencyKey == null || idempotencyKey.isBlank() ? UUID.randomUUID().toString() : idempotencyKey;
        Refund row = jdbc.query("select id::text, subscription_id::text, provider, status, reason, created_at from billing.refunds where subscription_id = ?::uuid and idempotency_key = ? for update", rs -> rs.next() ? refund(rs) : null, subscription.id(), key);
        if (row == null) {
            String id = UUID.randomUUID().toString();
            String initialStatus = "simulated".equals(subscription.provider()) ? "quota_pending" : "manual_review";
            jdbc.update("insert into billing.refunds(id, subscription_id, user_id, provider, status, idempotency_key, reason) values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?)", id, subscription.id(), userId, subscription.provider(), initialStatus, key, reason);
            row = jdbc.query("select id::text, subscription_id::text, provider, status, reason, created_at from billing.refunds where id = ?::uuid", rs -> { rs.next(); return refund(rs); }, id);
        }
        if (!"quota_pending".equals(row.status())) return row;
        try {
            QuotaRefundClient.RefundPreparation hold = refunds.prepare(internalToken, new QuotaRefundClient.PrepareRequest(row.id(), userId, subscription.id(), row.reason())).data();
            if (hold == null) throw new IllegalStateException("quota returned no refund hold");
            if ("held".equals(hold.status()) && "simulated".equals(row.provider())) {
                jdbc.update("update billing.refunds set status = 'refunded', used_tokens = ?, quota_hold_status = 'held', failure_reason = null, resolved_at = now(), updated_at = now() where id = ?::uuid", hold.usedTokens(), row.id());
                jdbc.update("update billing.subscriptions set status = 'refunded', canceled_at = now(), cancel_at_period_end = false, updated_at = now() where id = ?::uuid", subscription.id());
            } else {
                jdbc.update("update billing.refunds set status = 'manual_review', used_tokens = ?, quota_hold_status = ?, failure_reason = ?, updated_at = now() where id = ?::uuid", hold.usedTokens(), hold.status(), hold.reason(), row.id());
            }
        } catch (RuntimeException exception) {
            // Preserve the durable pending row; the exact id is reused when the caller retries.
            jdbc.update("update billing.refunds set failure_reason = ?, updated_at = now() where id = ?::uuid", "quota hold pending: " + exception.getClass().getSimpleName(), row.id());
        }
        return jdbc.query("select id::text, subscription_id::text, provider, status, reason, created_at from billing.refunds where id = ?::uuid", rs -> { rs.next(); return refund(rs); }, row.id());
    }

    public List<Reconciliation> reconciliation(String userId, int limit) {
        return jdbc.query("""
                select order_row.id::text, order_row.provider, order_row.status, payment.status, cast(round(order_row.amount * 100) as bigint), order_row.currency, order_row.created_at
                from billing.orders order_row left join billing.payments payment on payment.order_id = order_row.id
                where order_row.user_id = ?::uuid order by order_row.created_at desc limit ?
                """, (rs, row) -> new Reconciliation(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), instant(rs, 7)), userId, Math.max(1, Math.min(limit, 200)));
    }

    public AdminReconciliation adminReconciliation(String status, int limit) {
        String requestedStatus = status == null ? "" : status.trim();
        int bounded = limit <= 0 || limit > 100 ? 50 : limit;
        AdminReconciliationRun latest = jdbc.query("""
                select id::text, trigger, requested_by, status, scanned_orders, detected_items,
                       started_at::text, coalesce(finished_at::text, ''), coalesce(failure_reason, '')
                from billing.reconciliation_runs order by started_at desc limit 1
                """, rs -> rs.next() ? new AdminReconciliationRun(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getLong(5), rs.getLong(6), rs.getString(7), rs.getString(8), rs.getString(9)) : null);
        List<AdminReconciliationItem> items = jdbc.query("""
                select id::text, coalesce(order_id::text, ''), coalesce(subscription_id::text, ''), mismatch_type, severity,
                       recommended_action, status, occurrences, first_detected_at::text, last_detected_at::text,
                       coalesce(resolved_at::text, ''), coalesce(resolved_by, ''), coalesce(resolution_note, '')
                from billing.reconciliation_items
                where (? = '' or status = ?)
                order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, last_detected_at desc
                limit ?
                """, (rs, row) -> new AdminReconciliationItem(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getString(6), rs.getString(7), rs.getLong(8), rs.getString(9), rs.getString(10), rs.getString(11),
                rs.getString(12), rs.getString(13)), requestedStatus, requestedStatus, bounded);
        return new AdminReconciliation(latest, items);
    }

    private Subscription currentSubscriptionForUpdate(String userId) {
        Subscription subscription = jdbc.query("""
                select id::text, plan_id::text, plan_code, plan_name, provider, status, current_period_start, current_period_end,
                       cancel_at_period_end, coalesce(renewal_plan_code, ''), coalesce(entitlements_snapshot::text, '{}')
                from billing.subscriptions where user_id = ?::uuid and status in ('active', 'quota_pending', 'activation_failed')
                order by created_at desc limit 1 for update
                """, rs -> rs.next() ? subscription(rs) : null, userId);
        if (subscription == null) throw new BusinessException("BILLING_SUBSCRIPTION_NOT_FOUND", "subscription not found", HttpStatus.NOT_FOUND);
        return subscription;
    }
    private Subscription subscription(String id, String userId) {
        return jdbc.query("select id::text, plan_id::text, plan_code, plan_name, provider, status, current_period_start, current_period_end, cancel_at_period_end, coalesce(renewal_plan_code, ''), coalesce(entitlements_snapshot::text, '{}') from billing.subscriptions where id = ?::uuid and user_id = ?::uuid", rs -> { if (!rs.next()) throw new BusinessException("BILLING_SUBSCRIPTION_NOT_FOUND", "subscription not found", HttpStatus.NOT_FOUND); return subscription(rs); }, id, userId);
    }
    private static Subscription subscription(java.sql.ResultSet rs) throws java.sql.SQLException { return new Subscription(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), instant(rs, 7), instant(rs, 8), rs.getBoolean(9), rs.getString(10), rs.getString(11)); }
    private static String orderSelect(String where) { return "select id::text, plan_id::text, plan_code, status, provider, cast(round(amount * 100) as bigint), currency, created_at, paid_at, coalesce(payment_url, ''), payment_expires_at, coalesce(subscription_id::text, '') from billing.orders " + where; }
    private static Order order(java.sql.ResultSet rs) throws java.sql.SQLException { return new Order(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getLong(6), rs.getString(7), instant(rs, 8), instant(rs, 9), rs.getString(10), instant(rs, 11), rs.getString(12)); }
    private static Payment payment(java.sql.ResultSet rs) throws java.sql.SQLException { return new Payment(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), instant(rs, 7)); }
    private static Refund refund(java.sql.ResultSet rs) throws java.sql.SQLException { return new Refund(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), instant(rs, 6)); }
    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException {
        var timestamp = rs.getTimestamp(index);
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record Plan(String id, String code, String name, String billingPeriod, long amountMinor, String currency, long monthlyTokenQuota, int maxRpm, long maxContextTokens, String modelLevel, String purchaseMode, String entitlements) { }
    public record CreateOrder(String planCode, String provider) { }
    public record Order(String id, String planId, String planCode, String status, String provider, long amountMinor, String currency, Instant createdAt, Instant paidAt, String paymentUrl, Instant paymentExpiresAt, String subscriptionId) { }
    public record Subscription(String id, String planId, String planCode, String planName, String provider, String status, Instant currentPeriodStart, Instant currentPeriodEnd, boolean cancelAtPeriodEnd, String renewalPlanCode, String entitlements) { }
    public record Payment(String id, String orderId, String provider, String status, long amountMinor, String currency, Instant createdAt) { }
    public record Refund(String id, String subscriptionId, String provider, String status, String reason, Instant createdAt) { }
    public record Reconciliation(String orderId, String provider, String orderStatus, String paymentStatus, long amountMinor, String currency, Instant createdAt) { }
    public record AdminReconciliation(@JsonProperty("latest_run") AdminReconciliationRun latestRun, List<AdminReconciliationItem> items) { }
    public record AdminReconciliationRun(String id, String trigger, @JsonProperty("requested_by") String requestedBy, String status,
                                         @JsonProperty("scanned_items") long scannedItems, @JsonProperty("detected_items") long detectedItems,
                                         @JsonProperty("started_at") String startedAt, @JsonProperty("completed_at") String completedAt,
                                         String failure) { }
    public record AdminReconciliationItem(String id, @JsonProperty("order_id") String orderId,
                                          @JsonProperty("subscription_id") String subscriptionId, @JsonProperty("mismatch_type") String mismatchType,
                                          String severity, String recommendation, String status, long occurrences,
                                          @JsonProperty("first_detected_at") String firstDetectedAt, @JsonProperty("last_detected_at") String lastDetectedAt,
                                          @JsonProperty("resolved_at") String resolvedAt, @JsonProperty("resolved_by") String resolvedBy,
                                          @JsonProperty("resolution_note") String resolutionNote) { }
}
