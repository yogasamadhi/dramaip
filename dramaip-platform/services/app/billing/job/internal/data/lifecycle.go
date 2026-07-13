package data

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/activation"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

// ProcessSubscriptionLifecycle keeps only billing-owned intent in PostgreSQL;
// each quota RPC happens after that local transaction commits. A retry uses the
// subscription-period or change/refund natural key and is therefore safe after
// a worker crash.
func (d *Data) ProcessSubscriptionLifecycle(ctx context.Context, batch int) error {
	if batch <= 0 {
		batch = 1
	}
	if err := d.finishDueCancellations(ctx, batch); err != nil {
		return err
	}
	if err := d.retryPlanChanges(ctx, batch); err != nil {
		return err
	}
	if err := d.retryRefunds(ctx, batch); err != nil {
		return err
	}
	return d.renewDueSimulatedSubscriptions(ctx, batch)
}

func (d *Data) finishDueCancellations(ctx context.Context, batch int) error {
	var rows []struct{ ID string }
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id
		FROM billing.subscriptions
		WHERE status = 'active' AND cancel_at_period_end = true AND current_period_end <= now()
		ORDER BY current_period_end ASC LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			result := tx.Exec(`
				UPDATE billing.subscriptions
				SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
				WHERE id = ?::uuid AND status = 'active' AND cancel_at_period_end = true AND current_period_end <= now()
			`, row.ID)
			if result.Error != nil || result.RowsAffected == 0 {
				return result.Error
			}
			if err := tx.Exec(`
				UPDATE billing.subscription_periods
				SET status = 'canceled', ended_at = COALESCE(ended_at, now()), updated_at = now()
				WHERE subscription_id = ?::uuid AND period_end <= now() AND status = 'active'
			`, row.ID).Error; err != nil {
				return err
			}
			return tx.Exec(`
				UPDATE billing.subscription_changes
				SET status = 'applied', applied_at = COALESCE(applied_at, now()), updated_at = now()
				WHERE subscription_id = ?::uuid AND kind = 'cancel' AND status = 'scheduled'
			`, row.ID).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

type lifecycleSnapshot struct {
	Code              string `json:"code"`
	Name              string `json:"name"`
	BillingPeriod     string `json:"billing_period"`
	Price             string `json:"price"`
	Currency          string `json:"currency"`
	MonthlyTokenQuota int64  `json:"monthly_token_quota"`
	MaxRPM            int64  `json:"max_rpm"`
	MaxContextTokens  int64  `json:"max_context_tokens"`
	ModelLevel        string `json:"model_level"`
	Source            string `json:"source"`
	At                string `json:"at"`
}

type lifecyclePlanChange struct {
	PlanID string            `json:"plan_id"`
	Target lifecycleSnapshot `json:"target"`
	Delta  int64             `json:"delta"`
}

func (d *Data) retryPlanChanges(ctx context.Context, batch int) error {
	var rows []struct {
		ID             string
		SubscriptionID string
		UserID         string
		Details        []byte
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, subscription_id::text AS subscription_id, user_id::text AS user_id, details
		FROM billing.subscription_changes
		WHERE kind = 'upgrade' AND status = 'quota_pending'
		ORDER BY updated_at ASC LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var detail lifecyclePlanChange
		if err := json.Unmarshal(row.Details, &detail); err != nil {
			return d.markPlanChangeRetry(ctx, row.ID, fmt.Sprintf("decode change: %v", err))
		}
		if detail.Delta <= 0 {
			return d.markPlanChangeRetry(ctx, row.ID, "upgrade change has no positive quota delta")
		}
		if _, err := d.Quota.AdjustPeriodQuota(ctx, &quotav1.AdjustPeriodQuotaRequest{
			AdjustmentId: row.ID, UserId: row.UserID, SubscriptionId: row.SubscriptionID,
			DeltaTokens: detail.Delta, Reason: "subscription upgrade",
		}); err != nil {
			if markErr := d.markPlanChangeRetry(ctx, row.ID, err.Error()); markErr != nil {
				return markErr
			}
			continue
		}
		if err := d.finalizePlanChange(ctx, row.ID, detail); err != nil {
			return err
		}
	}
	return nil
}

func (d *Data) markPlanChangeRetry(ctx context.Context, changeID, reason string) error {
	return d.DB.WithContext(ctx).Exec(`
		UPDATE billing.subscription_changes
		SET status = 'quota_pending', failure_reason = ?, updated_at = now()
		WHERE id = ?::uuid AND status = 'quota_pending'
	`, reason, changeID).Error
}

func (d *Data) finalizePlanChange(ctx context.Context, changeID string, detail lifecyclePlanChange) error {
	return d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var subscriptionID string
		if err := tx.Raw(`
			SELECT subscription_id::text FROM billing.subscription_changes
			WHERE id = ?::uuid AND status = 'quota_pending' FOR UPDATE
		`, changeID).Scan(&subscriptionID).Error; err != nil {
			return err
		}
		if subscriptionID == "" {
			return nil
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET plan_id = ?::uuid, plan_code = ?, plan_name = ?, billing_period = ?, plan_price = ?::numeric,
			    currency = ?, monthly_token_quota = ?, max_rpm = ?, max_context_tokens = ?, model_level = ?,
			    plan_snapshot_source = ?, plan_snapshot_at = ?::timestamptz, lifecycle_error = NULL, updated_at = now()
			WHERE id = ?::uuid
		`, detail.PlanID, detail.Target.Code, detail.Target.Name, detail.Target.BillingPeriod, detail.Target.Price,
			detail.Target.Currency, detail.Target.MonthlyTokenQuota, detail.Target.MaxRPM, detail.Target.MaxContextTokens,
			detail.Target.ModelLevel, detail.Target.Source, detail.Target.At, subscriptionID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			UPDATE billing.subscription_changes
			SET status = 'applied', applied_at = now(), failure_reason = NULL, updated_at = now()
			WHERE id = ?::uuid AND status = 'quota_pending'
		`, changeID).Error
	})
}

func (d *Data) retryRefunds(ctx context.Context, batch int) error {
	var rows []struct {
		ID             string
		SubscriptionID string
		UserID         string
		Provider       string
		Reason         string
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, subscription_id::text AS subscription_id, user_id::text AS user_id, provider, reason
		FROM billing.refunds WHERE status = 'quota_pending' ORDER BY updated_at ASC LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		prep, err := d.Quota.PrepareRefund(ctx, &quotav1.PrepareRefundRequest{
			RefundId: row.ID, UserId: row.UserID, SubscriptionId: row.SubscriptionID, Reason: row.Reason,
		})
		if err != nil {
			if markErr := d.DB.WithContext(ctx).Exec(`UPDATE billing.refunds SET failure_reason = ?, updated_at = now() WHERE id = ?::uuid AND status = 'quota_pending'`, err.Error(), row.ID).Error; markErr != nil {
				return markErr
			}
			continue
		}
		if err := d.finalizeRefund(ctx, row.ID, row.Provider, prep); err != nil {
			return err
		}
	}
	return nil
}

func (d *Data) finalizeRefund(ctx context.Context, refundID, provider string, prep *quotav1.RefundPreparation) error {
	return d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row struct {
			SubscriptionID string
			PeriodID       string
		}
		if err := tx.Raw(`
			SELECT subscription_id::text AS subscription_id, COALESCE(subscription_period_id::text, '') AS period_id
			FROM billing.refunds WHERE id = ?::uuid AND status = 'quota_pending' FOR UPDATE
		`, refundID).Scan(&row).Error; err != nil {
			return err
		}
		if row.SubscriptionID == "" {
			return nil
		}
		if prep.Status != "held" || provider != "simulated" {
			return tx.Exec(`
				UPDATE billing.refunds
				SET status = 'manual_review', used_tokens = ?, quota_hold_status = ?, failure_reason = ?, updated_at = now()
				WHERE id = ?::uuid
			`, prep.UsedTokens, prep.Status, prep.Reason, refundID).Error
		}
		if err := tx.Exec(`
			UPDATE billing.refunds
			SET status = 'refunded', used_tokens = ?, quota_hold_status = 'held', failure_reason = NULL,
			    resolved_at = now(), updated_at = now()
			WHERE id = ?::uuid
		`, prep.UsedTokens, refundID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE billing.subscriptions SET status = 'refunded', canceled_at = now(), cancel_at_period_end = false, updated_at = now() WHERE id = ?::uuid`, row.SubscriptionID).Error; err != nil {
			return err
		}
		return tx.Exec(`UPDATE billing.subscription_periods SET status = 'refunded', ended_at = now(), updated_at = now() WHERE id = ?::uuid`, row.PeriodID).Error
	})
}

type renewalWork struct {
	SubscriptionID string
	UserID         string
	PlanID         string
	Snapshot       lifecycleSnapshot
	PeriodStart    time.Time
	PeriodEnd      time.Time
}

func (d *Data) renewDueSimulatedSubscriptions(ctx context.Context, batch int) error {
	var rows []struct{ ID string }
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id FROM billing.subscriptions
		WHERE status = 'active' AND provider = 'simulated' AND cancel_at_period_end = false AND current_period_end <= now()
		ORDER BY current_period_end ASC LIMIT ?
	`, batch).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		work, err := d.beginRenewal(ctx, row.ID)
		if err != nil {
			return err
		}
		if work.SubscriptionID == "" {
			continue
		}
		if _, err := d.Quota.CreatePeriodAccount(ctx, &quotav1.CreatePeriodAccountRequest{
			UserId: work.UserID, SubscriptionId: work.SubscriptionID, QuotaTokens: work.Snapshot.MonthlyTokenQuota,
			PeriodStart: work.PeriodStart.Format(time.RFC3339), PeriodEnd: work.PeriodEnd.Format(time.RFC3339),
			PlanCode: work.Snapshot.Code, PlanName: work.Snapshot.Name, BillingPeriod: work.Snapshot.BillingPeriod,
			PlanPrice: work.Snapshot.Price, Currency: work.Snapshot.Currency, MaxRpm: work.Snapshot.MaxRPM,
			MaxContextTokens: work.Snapshot.MaxContextTokens, ModelLevel: work.Snapshot.ModelLevel,
			PlanSnapshotSource: work.Snapshot.Source, PlanSnapshotAt: work.Snapshot.At,
		}); err != nil {
			_ = d.DB.WithContext(ctx).Exec(`UPDATE billing.subscriptions SET status = 'activation_failed', lifecycle_error = ?, updated_at = now() WHERE id = ?::uuid AND status = 'quota_pending'`, err.Error(), work.SubscriptionID).Error
			continue
		}
		if err := activation.ActivateSubscription(ctx, d.DB, work.SubscriptionID); err != nil {
			return err
		}
	}
	return nil
}

func (d *Data) beginRenewal(ctx context.Context, subscriptionID string) (renewalWork, error) {
	var work renewalWork
	err := d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var sub struct {
			ID                    string
			UserID                string
			PlanID                string
			CurrentPeriodEnd      time.Time
			PlanCode              string
			PlanName              string
			BillingPeriod         string
			PlanPrice             string
			Currency              string
			MonthlyTokenQuota     int64
			MaxRPM                int64
			MaxContextTokens      int64
			ModelLevel            string
			PlanSnapshotSource    string
			PlanSnapshotAt        string
			ScheduledPlanSnapshot []byte
		}
		if err := tx.Raw(`
			SELECT id::text AS id, user_id::text AS user_id, plan_id::text AS plan_id, current_period_end,
			       plan_code, plan_name, billing_period, plan_price::text AS plan_price, currency,
			       monthly_token_quota, max_rpm, max_context_tokens, model_level,
			       plan_snapshot_source, plan_snapshot_at::text AS plan_snapshot_at, scheduled_plan_snapshot
			FROM billing.subscriptions
			WHERE id = ?::uuid AND status = 'active' AND provider = 'simulated'
			  AND cancel_at_period_end = false AND current_period_end <= now()
			FOR UPDATE
		`, subscriptionID).Scan(&sub).Error; err != nil {
			return err
		}
		if sub.ID == "" {
			return nil
		}
		snapshot := lifecycleSnapshot{Code: sub.PlanCode, Name: sub.PlanName, BillingPeriod: sub.BillingPeriod,
			Price: sub.PlanPrice, Currency: sub.Currency, MonthlyTokenQuota: sub.MonthlyTokenQuota,
			MaxRPM: sub.MaxRPM, MaxContextTokens: sub.MaxContextTokens, ModelLevel: sub.ModelLevel,
			Source: sub.PlanSnapshotSource, At: sub.PlanSnapshotAt}
		planID := sub.PlanID
		source := "renewal"
		if len(sub.ScheduledPlanSnapshot) > 0 && string(sub.ScheduledPlanSnapshot) != "null" {
			var planned lifecycleSnapshot
			if err := json.Unmarshal(sub.ScheduledPlanSnapshot, &planned); err != nil {
				return fmt.Errorf("decode scheduled plan: %w", err)
			}
			if planned.Code != "" {
				snapshot = planned
				source = "scheduled_downgrade"
				var scheduledPlanID string
				if err := tx.Raw(`SELECT scheduled_plan_id::text FROM billing.subscriptions WHERE id = ?::uuid`, sub.ID).Scan(&scheduledPlanID).Error; err != nil {
					return err
				}
				if scheduledPlanID != "" {
					planID = scheduledPlanID
				}
			}
		}
		start := sub.CurrentPeriodEnd.UTC()
		end := lifecyclePeriodEnd(start, snapshot.BillingPeriod)
		if err := tx.Exec(`
			UPDATE billing.subscription_periods
			SET status = 'ended', ended_at = COALESCE(ended_at, now()), updated_at = now()
			WHERE subscription_id = ?::uuid AND period_end = ?
		`, sub.ID, start).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET plan_id = ?::uuid, plan_code = ?, plan_name = ?, billing_period = ?, plan_price = ?::numeric,
			    currency = ?, monthly_token_quota = ?, max_rpm = ?, max_context_tokens = ?, model_level = ?,
			    plan_snapshot_source = ?, plan_snapshot_at = ?::timestamptz,
			    current_period_start = ?, current_period_end = ?, status = 'quota_pending',
			    scheduled_plan_id = NULL, scheduled_plan_snapshot = NULL, scheduled_change_at = NULL,
			    lifecycle_error = NULL, updated_at = now()
			WHERE id = ?::uuid
		`, planID, snapshot.Code, snapshot.Name, snapshot.BillingPeriod, snapshot.Price, snapshot.Currency,
			snapshot.MonthlyTokenQuota, snapshot.MaxRPM, snapshot.MaxContextTokens, snapshot.ModelLevel,
			snapshot.Source, snapshot.At, start, end, sub.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO billing.subscription_periods (
				id, subscription_id, user_id, status, period_start, period_end,
				plan_id, plan_code, plan_name, billing_period, plan_price, currency, monthly_token_quota,
				max_rpm, max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at, source
			) VALUES (?::uuid, ?::uuid, ?::uuid, 'quota_pending', ?, ?,
			          ?::uuid, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?)
			ON CONFLICT (subscription_id, period_start) DO NOTHING
		`, platform.NewUUID(), sub.ID, sub.UserID, start, end, planID, snapshot.Code, snapshot.Name,
			snapshot.BillingPeriod, snapshot.Price, snapshot.Currency, snapshot.MonthlyTokenQuota,
			snapshot.MaxRPM, snapshot.MaxContextTokens, snapshot.ModelLevel, snapshot.Source, snapshot.At, source).Error; err != nil {
			return err
		}
		if source == "scheduled_downgrade" {
			if err := tx.Exec(`
				UPDATE billing.subscription_changes
				SET status = 'applied', applied_at = now(), updated_at = now()
				WHERE subscription_id = ?::uuid AND kind = 'downgrade' AND status = 'scheduled' AND effective_at <= now()
			`, sub.ID).Error; err != nil {
				return err
			}
		}
		work = renewalWork{SubscriptionID: sub.ID, UserID: sub.UserID, PlanID: planID, Snapshot: snapshot, PeriodStart: start, PeriodEnd: end}
		return nil
	})
	return work, err
}

func lifecyclePeriodEnd(start time.Time, billingPeriod string) time.Time {
	switch strings.ToLower(billingPeriod) {
	case "year", "yearly", "annual":
		return start.AddDate(1, 0, 0)
	default:
		return start.AddDate(0, 1, 0)
	}
}
