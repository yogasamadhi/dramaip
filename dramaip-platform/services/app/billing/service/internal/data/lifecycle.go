package data

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// PlanChangeResult keeps the cross-service portion of a lifecycle change
// explicit. Billing records intent first; quota is changed only after that
// transaction commits; a final billing transaction then makes the change live.
type PlanChangeResult struct {
	Subscription SubscriptionRow
	ChangeID     string
	Kind         string
	Status       string
	DeltaTokens  int64
}

type RefundRow struct {
	ID              string
	SubscriptionID  string
	Status          string
	Reason          string
	UsedTokens      int64
	QuotaHoldStatus string
	FailureReason   string
	CreatedAt       string
	ResolvedAt      string
}

type planChangeDetails struct {
	PlanID string       `json:"plan_id"`
	Target PlanSnapshot `json:"target"`
	Delta  int64        `json:"delta"`
}

func (r *BillingRepo) ChangeSubscriptionPlan(ctx context.Context, userID, subscriptionID, planCode, idempotencyKey string) (PlanChangeResult, error) {
	var out PlanChangeResult
	if subscriptionID == "" {
		return out, status.Error(codes.InvalidArgument, "subscription id is required")
	}
	if planCode == "" {
		return out, status.Error(codes.InvalidArgument, "plan id is required")
	}
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSubscription(ctx, tx, userID, subscriptionID); err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, subscriptionID)
		if err != nil {
			return err
		}
		if sub.Status != "active" {
			return status.Errorf(codes.FailedPrecondition, "subscription status %s cannot change plan", sub.Status)
		}
		if sub.CancelAtPeriodEnd {
			return status.Error(codes.FailedPrecondition, "resume subscription before changing plan")
		}
		if sub.Provider != "simulated" {
			return status.Error(codes.FailedPrecondition, "plan changes await payment provider integration")
		}
		var plan struct {
			ID                string
			Code              string
			Name              string
			BillingPeriod     string
			Price             string
			Currency          string
			MonthlyTokenQuota int64
			MaxRPM            int64
			MaxContextTokens  int64
			ModelLevel        string
			PurchaseMode      string
			Entitlements      PlanEntitlements
		}
		if err := tx.Raw(`
			SELECT id::text AS id, code, name, billing_period, price::text AS price, currency,
			       monthly_token_quota, max_rpm, max_context_tokens, model_level,
			       purchase_mode, entitlements
			FROM billing.plans WHERE code = ? AND is_active = true LIMIT 1
		`, planCode).Scan(&plan).Error; err != nil {
			return err
		}
		if plan.ID == "" {
			return status.Error(codes.NotFound, "plan not found")
		}
		if plan.PurchaseMode != "self_service" {
			return status.Errorf(codes.FailedPrecondition, "plan %s requires sales contact and cannot be selected in self-service", plan.Code)
		}
		if plan.Code == sub.PlanCode {
			out = PlanChangeResult{Subscription: sub, Kind: "unchanged", Status: "applied"}
			return nil
		}
		if sub.ScheduledPlanCode != "" {
			if sub.ScheduledPlanCode == plan.Code {
				var existing struct {
					ID      string
					Details []byte
				}
				if err := tx.Raw(`
					SELECT id::text AS id, details FROM billing.subscription_changes
					WHERE subscription_id = ?::uuid AND kind = 'downgrade' AND status = 'scheduled'
					ORDER BY created_at DESC LIMIT 1
				`, sub.ID).Scan(&existing).Error; err != nil {
					return err
				}
				var recorded planChangeDetails
				if existing.ID != "" {
					if err := json.Unmarshal(existing.Details, &recorded); err != nil {
						return fmt.Errorf("decode scheduled subscription change: %w", err)
					}
				}
				out = PlanChangeResult{Subscription: sub, ChangeID: existing.ID, Kind: "downgrade", Status: "scheduled", DeltaTokens: recorded.Delta}
				return nil
			}
			return status.Error(codes.FailedPrecondition, "another plan change is already scheduled")
		}
		now := time.Now().UTC()
		target := PlanSnapshot{Code: plan.Code, Name: plan.Name, BillingPeriod: plan.BillingPeriod, Price: plan.Price,
			Currency: plan.Currency, MonthlyTokenQuota: plan.MonthlyTokenQuota, MaxRPM: plan.MaxRPM,
			MaxContextTokens: plan.MaxContextTokens, ModelLevel: plan.ModelLevel, PurchaseMode: plan.PurchaseMode,
			Entitlements: plan.Entitlements, Source: "plan_change", At: now.Format(time.RFC3339Nano)}
		delta := target.MonthlyTokenQuota - sub.MonthlyTokenQuota
		kind := "upgrade"
		state := "quota_pending"
		effectiveAt := now
		if delta <= 0 {
			kind = "downgrade"
			state = "scheduled"
			parsed, err := parseTimestamp(sub.CurrentPeriodEnd)
			if err != nil {
				return fmt.Errorf("parse subscription period end: %w", err)
			}
			effectiveAt = parsed.UTC()
		}
		if idempotencyKey == "" {
			idempotencyKey = "plan:" + plan.Code + ":" + sub.CurrentPeriodStart
		}
		details, err := json.Marshal(planChangeDetails{PlanID: plan.ID, Target: target, Delta: delta})
		if err != nil {
			return err
		}
		changeID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO billing.subscription_changes (
				id, subscription_id, user_id, kind, status, idempotency_key, effective_at, details
			) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?::jsonb)
			ON CONFLICT (subscription_id, idempotency_key) DO NOTHING
		`, changeID, sub.ID, userID, kind, state, idempotencyKey, effectiveAt, string(details)).Error; err != nil {
			return err
		}
		var existing struct {
			ID     string
			Kind   string
			Status string
			Detail []byte
		}
		if err := tx.Raw(`
			SELECT id::text AS id, kind, status, details AS detail
			FROM billing.subscription_changes
			WHERE subscription_id = ?::uuid AND idempotency_key = ?
		`, sub.ID, idempotencyKey).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID == "" {
			return status.Error(codes.Internal, "subscription change was not recorded")
		}
		var recorded planChangeDetails
		if err := json.Unmarshal(existing.Detail, &recorded); err != nil {
			return fmt.Errorf("decode subscription change: %w", err)
		}
		if existing.Kind == "downgrade" && existing.Status == "scheduled" {
			if err := tx.Exec(`
				UPDATE billing.subscriptions
				SET scheduled_plan_id = ?::uuid, scheduled_plan_snapshot = ?::jsonb,
				    scheduled_change_at = ?, lifecycle_error = NULL, updated_at = now()
				WHERE id = ?::uuid
			`, recorded.PlanID, string(mustJSON(recorded.Target)), effectiveAt, sub.ID).Error; err != nil {
				return err
			}
			sub.ScheduledPlanCode = recorded.Target.Code
			sub.ScheduledChangeAt = effectiveAt.Format(time.RFC3339)
		}
		out = PlanChangeResult{Subscription: sub, ChangeID: existing.ID, Kind: existing.Kind, Status: existing.Status, DeltaTokens: recorded.Delta}
		return nil
	})
	return out, err
}

func (r *BillingRepo) ApplyQuotaAdjustment(ctx context.Context, change PlanChangeResult) error {
	if change.Kind != "upgrade" || change.Status == "applied" || change.DeltaTokens <= 0 {
		return nil
	}
	_, err := r.data.Quota.AdjustPeriodQuota(ctx, &quotav1.AdjustPeriodQuotaRequest{
		AdjustmentId: change.ChangeID, UserId: change.Subscription.UserID, SubscriptionId: change.Subscription.ID,
		DeltaTokens: change.DeltaTokens, Reason: "subscription upgrade",
	})
	return err
}

func (r *BillingRepo) FinalizePlanChange(ctx context.Context, changeID string) (SubscriptionRow, error) {
	var out SubscriptionRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row struct {
			SubscriptionID string
			Status         string
			Details        []byte
		}
		if err := tx.Raw(`
			SELECT subscription_id::text AS subscription_id, status, details
			FROM billing.subscription_changes WHERE id = ?::uuid FOR UPDATE
		`, changeID).Scan(&row).Error; err != nil {
			return err
		}
		if row.SubscriptionID == "" {
			return status.Error(codes.NotFound, "subscription change not found")
		}
		if row.Status == "applied" {
			sub, err := loadSubscriptionByID(ctx, tx, row.SubscriptionID)
			out = sub
			return err
		}
		if row.Status != "quota_pending" {
			return status.Errorf(codes.FailedPrecondition, "subscription change status %s cannot be finalized", row.Status)
		}
		var detail planChangeDetails
		if err := json.Unmarshal(row.Details, &detail); err != nil {
			return err
		}
		if err := updateSubscriptionSnapshot(tx, row.SubscriptionID, detail.PlanID, detail.Target); err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.subscription_changes
			SET status = 'applied', applied_at = now(), failure_reason = NULL, updated_at = now()
			WHERE id = ?::uuid
		`, changeID).Error; err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, row.SubscriptionID)
		out = sub
		return err
	})
	return out, err
}

func (r *BillingRepo) MarkPlanChangeRetry(ctx context.Context, changeID string, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscription_changes
		SET status = 'quota_pending', failure_reason = ?, updated_at = now()
		WHERE id = ?::uuid AND status = 'quota_pending'
	`, reason, changeID).Error
}

func (r *BillingRepo) ResumeSubscription(ctx context.Context, userID, subscriptionID, idempotencyKey string) (SubscriptionRow, error) {
	var out SubscriptionRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSubscription(ctx, tx, userID, subscriptionID); err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, subscriptionID)
		if err != nil {
			return err
		}
		if sub.Status != "active" {
			return status.Errorf(codes.FailedPrecondition, "subscription status %s cannot resume", sub.Status)
		}
		if !sub.CancelAtPeriodEnd {
			out = sub
			return nil
		}
		if idempotencyKey == "" {
			idempotencyKey = "resume:" + sub.CurrentPeriodStart
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET cancel_at_period_end = false, canceled_at = NULL, lifecycle_error = NULL, updated_at = now()
			WHERE id = ?::uuid
		`, sub.ID).Error; err != nil {
			return err
		}
		if err := insertLifecycleChange(tx, sub.ID, userID, "resume", "applied", idempotencyKey, time.Now().UTC(), nil); err != nil {
			return err
		}
		out, err = loadSubscriptionByID(ctx, tx, sub.ID)
		return err
	})
	return out, err
}

func (r *BillingRepo) RequestRefund(ctx context.Context, userID, subscriptionID, reason, idempotencyKey string) (RefundRow, error) {
	var out RefundRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSubscription(ctx, tx, userID, subscriptionID); err != nil {
			return err
		}
		sub, err := loadSubscriptionByID(ctx, tx, subscriptionID)
		if err != nil {
			return err
		}
		if sub.Status != "active" {
			return status.Errorf(codes.FailedPrecondition, "subscription status %s cannot refund", sub.Status)
		}
		var period struct{ ID string }
		if err := tx.Raw(`
			SELECT id::text AS id FROM billing.subscription_periods
			WHERE subscription_id = ?::uuid AND period_start = ?::timestamptz
			LIMIT 1 FOR UPDATE
		`, sub.ID, sub.CurrentPeriodStart).Scan(&period).Error; err != nil {
			return err
		}
		if period.ID == "" {
			return status.Error(codes.FailedPrecondition, "subscription period is missing")
		}
		if reason == "" {
			reason = "user_requested"
		}
		if idempotencyKey == "" {
			idempotencyKey = "refund:" + sub.CurrentPeriodStart
		}
		initialStatus := "quota_pending"
		if sub.Provider != "simulated" {
			initialStatus = "manual_review"
		}
		refundID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO billing.refunds (
				id, subscription_id, subscription_period_id, user_id, provider, status, idempotency_key, reason
			) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?)
			ON CONFLICT (subscription_id, idempotency_key) DO NOTHING
		`, refundID, sub.ID, period.ID, userID, sub.Provider, initialStatus, idempotencyKey, reason).Error; err != nil {
			return err
		}
		out, err = loadRefund(tx, sub.ID, idempotencyKey)
		return err
	})
	return out, err
}

func (r *BillingRepo) PrepareRefundQuota(ctx context.Context, refund RefundRow, userID string) (*quotav1.RefundPreparation, error) {
	return r.data.Quota.PrepareRefund(ctx, &quotav1.PrepareRefundRequest{
		RefundId: refund.ID, UserId: userID, SubscriptionId: refund.SubscriptionID, Reason: refund.Reason,
	})
}

func (r *BillingRepo) FinalizeRefund(ctx context.Context, refundID string, prep *quotav1.RefundPreparation) (RefundRow, error) {
	var out RefundRow
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row struct {
			SubscriptionID string
			PeriodID       string
			Provider       string
			Status         string
		}
		if err := tx.Raw(`
			SELECT subscription_id::text AS subscription_id, COALESCE(subscription_period_id::text, '') AS period_id,
			       provider, status FROM billing.refunds WHERE id = ?::uuid FOR UPDATE
		`, refundID).Scan(&row).Error; err != nil {
			return err
		}
		if row.SubscriptionID == "" {
			return status.Error(codes.NotFound, "refund not found")
		}
		if row.Status == "refunded" || row.Status == "manual_review" {
			var err error
			loaded, err := loadRefundByID(tx, refundID)
			out = loaded
			return err
		}
		if prep == nil {
			return status.Error(codes.InvalidArgument, "refund quota preparation is required")
		}
		if prep.Status != "held" || row.Provider != "simulated" {
			if err := tx.Exec(`
				UPDATE billing.refunds
				SET status = 'manual_review', used_tokens = ?, quota_hold_status = ?, failure_reason = ?, updated_at = now()
				WHERE id = ?::uuid
			`, prep.UsedTokens, prep.Status, prep.Reason, refundID).Error; err != nil {
				return err
			}
			loaded, err := loadRefundByID(tx, refundID)
			out = loaded
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.refunds
			SET status = 'refunded', used_tokens = ?, quota_hold_status = 'held', failure_reason = NULL,
			    resolved_at = now(), updated_at = now()
			WHERE id = ?::uuid
		`, prep.UsedTokens, refundID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET status = 'refunded', canceled_at = now(), cancel_at_period_end = false, updated_at = now()
			WHERE id = ?::uuid
		`, row.SubscriptionID).Error; err != nil {
			return err
		}
		if row.PeriodID != "" {
			if err := tx.Exec(`UPDATE billing.subscription_periods SET status = 'refunded', ended_at = now(), updated_at = now() WHERE id = ?::uuid`, row.PeriodID).Error; err != nil {
				return err
			}
		}
		var err error
		out, err = loadRefundByID(tx, refundID)
		return err
	})
	return out, err
}

func (r *BillingRepo) MarkRefundRetry(ctx context.Context, refundID, reason string) error {
	return r.data.DB.WithContext(ctx).Exec(`
		UPDATE billing.refunds
		SET status = 'quota_pending', failure_reason = ?, updated_at = now()
		WHERE id = ?::uuid AND status = 'quota_pending'
	`, reason, refundID).Error
}

func lockSubscription(ctx context.Context, tx *gorm.DB, userID, subscriptionID string) error {
	var id string
	if err := tx.WithContext(ctx).Raw(`
		SELECT id::text FROM billing.subscriptions
		WHERE id = ?::uuid AND user_id = ?::uuid
		FOR UPDATE
	`, subscriptionID, userID).Scan(&id).Error; err != nil {
		return err
	}
	if id == "" {
		return status.Error(codes.NotFound, "subscription not found")
	}
	return nil
}

func insertLifecycleChange(tx *gorm.DB, subscriptionID, userID, kind, state, key string, effectiveAt time.Time, details any) error {
	payload := mustJSON(details)
	return tx.Exec(`
		INSERT INTO billing.subscription_changes (
			id, subscription_id, user_id, kind, status, idempotency_key, effective_at, details, applied_at
		) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?::jsonb,
		          CASE WHEN ? = 'applied' THEN now() ELSE NULL END)
		ON CONFLICT (subscription_id, idempotency_key) DO NOTHING
	`, platform.NewUUID(), subscriptionID, userID, kind, state, key, effectiveAt, string(payload), state).Error
}

func updateSubscriptionSnapshot(tx *gorm.DB, subscriptionID, planID string, snapshot PlanSnapshot) error {
	return tx.Exec(`
		UPDATE billing.subscriptions
		SET plan_id = ?::uuid, plan_code = ?, plan_name = ?, billing_period = ?, plan_price = ?::numeric,
		    currency = ?, monthly_token_quota = ?, max_rpm = ?, max_context_tokens = ?, model_level = ?,
		    plan_snapshot_source = ?, plan_snapshot_at = ?::timestamptz,
		    purchase_mode = ?, entitlements_snapshot = ?::jsonb,
		    lifecycle_error = NULL, updated_at = now()
		WHERE id = ?::uuid
	`, planID, snapshot.Code, snapshot.Name, snapshot.BillingPeriod, snapshot.Price, snapshot.Currency,
		snapshot.MonthlyTokenQuota, snapshot.MaxRPM, snapshot.MaxContextTokens, snapshot.ModelLevel,
		snapshot.Source, snapshot.At, snapshot.PurchaseMode, snapshot.Entitlements.JSON(), subscriptionID).Error
}

func insertSubscriptionPeriod(tx *gorm.DB, subscriptionID, userID, orderID, planID string, snapshot PlanSnapshot, start, end time.Time, state, source string) error {
	return tx.Exec(`
		INSERT INTO billing.subscription_periods (
			id, subscription_id, user_id, order_id, status, period_start, period_end,
			plan_id, plan_code, plan_name, billing_period, plan_price, currency, monthly_token_quota,
			max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at, source, activated_at
		) VALUES (?::uuid, ?::uuid, ?::uuid, NULLIF(?, '')::uuid, ?, ?, ?,
		          ?::uuid, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?,
		          CASE WHEN ? = 'active' THEN now() ELSE NULL END)
		ON CONFLICT (subscription_id, period_start) DO NOTHING
	`, platform.NewUUID(), subscriptionID, userID, orderID, state, start, end,
		planID, snapshot.Code, snapshot.Name, snapshot.BillingPeriod, snapshot.Price, snapshot.Currency,
		snapshot.MonthlyTokenQuota, snapshot.MaxRPM, snapshot.MaxContextTokens, snapshot.ModelLevel,
		snapshot.Source, snapshot.At, source, state).Error
}

func loadRefund(tx *gorm.DB, subscriptionID, idempotencyKey string) (RefundRow, error) {
	var row RefundRow
	err := tx.Raw(`
		SELECT id::text AS id, subscription_id::text AS subscription_id, status, reason,
		       COALESCE(used_tokens, 0) AS used_tokens, COALESCE(quota_hold_status, '') AS quota_hold_status,
		       COALESCE(failure_reason, '') AS failure_reason, created_at::text AS created_at,
		       COALESCE(resolved_at::text, '') AS resolved_at
		FROM billing.refunds WHERE subscription_id = ?::uuid AND idempotency_key = ? LIMIT 1
	`, subscriptionID, idempotencyKey).Scan(&row).Error
	if err != nil || row.ID == "" {
		return RefundRow{}, status.Error(codes.NotFound, "refund not found")
	}
	return row, nil
}

func loadRefundByID(tx *gorm.DB, refundID string) (RefundRow, error) {
	var row RefundRow
	err := tx.Raw(`
		SELECT id::text AS id, subscription_id::text AS subscription_id, status, reason,
		       COALESCE(used_tokens, 0) AS used_tokens, COALESCE(quota_hold_status, '') AS quota_hold_status,
		       COALESCE(failure_reason, '') AS failure_reason, created_at::text AS created_at,
		       COALESCE(resolved_at::text, '') AS resolved_at
		FROM billing.refunds WHERE id = ?::uuid LIMIT 1
	`, refundID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return RefundRow{}, status.Error(codes.NotFound, "refund not found")
	}
	return row, nil
}

func mustJSON(value any) []byte {
	if value == nil {
		return []byte("{}")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return raw
}

func periodEnd(start time.Time, billingPeriod string) time.Time {
	switch strings.ToLower(billingPeriod) {
	case "year", "yearly", "annual":
		return start.AddDate(1, 0, 0)
	default:
		return start.AddDate(0, 1, 0)
	}
}

func parseTimestamp(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.999999-07", "2006-01-02 15:04:05-07"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported timestamp %q", value)
}
