// Package activation owns the billing-local completion of the payment saga.
// It intentionally has no quota dependency: quota is provisioned first over
// gRPC, then this transaction makes the subscription usable and persists the
// corresponding outbox event together.
package activation

import (
	"context"
	"fmt"
	"time"

	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// ActivateSubscription atomically moves a provisioned subscription to active
// and appends its SubscriptionActivated event. Repeated calls are safe: once
// active, the original event is left untouched.
func ActivateSubscription(ctx context.Context, db *gorm.DB, subscriptionID string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var sub struct {
			ID          string
			UserID      string
			PlanCode    string
			Status      string
			PeriodStart time.Time
			PeriodEnd   time.Time
		}
		if err := tx.Raw(`
			SELECT id::text AS id, user_id::text AS user_id, plan_code, status,
			       current_period_start AS period_start, current_period_end AS period_end
			FROM billing.subscriptions
			WHERE id = ?::uuid
			FOR UPDATE
		`, subscriptionID).Scan(&sub).Error; err != nil {
			return err
		}
		if sub.ID == "" {
			return status.Error(codes.NotFound, "subscription not found")
		}
		if sub.Status == "active" {
			return nil
		}
		if sub.Status != "quota_pending" && sub.Status != "activation_failed" {
			return status.Errorf(codes.FailedPrecondition, "subscription status %s cannot be activated", sub.Status)
		}
		now := time.Now().UTC()
		eventID := platform.NewUUID()
		payload, err := events.MarshalEnvelope(events.NewSubscriptionActivated(eventID, platform.TraceID(ctx), now, &billingeventsv1.SubscriptionActivated{
			SubscriptionId: sub.ID,
			UserId:         sub.UserID,
			PlanCode:       sub.PlanCode,
			PeriodStart:    sub.PeriodStart.UTC().Format(time.RFC3339),
			PeriodEnd:      sub.PeriodEnd.UTC().Format(time.RFC3339),
		}))
		if err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.subscriptions
			SET status = 'active', activation_error = NULL, quota_provisioned_at = now(), updated_at = now()
			WHERE id = ?::uuid
		`, sub.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE billing.subscription_periods
			SET status = 'active', activated_at = COALESCE(activated_at, now()), updated_at = now()
			WHERE subscription_id = ?::uuid AND period_start = ?::timestamptz
		`, sub.ID, sub.PeriodStart).Error; err != nil {
			return fmt.Errorf("mark subscription period active: %w", err)
		}
		if err := tx.Exec(`
			INSERT INTO billing.outbox_events (
				id, aggregate_type, aggregate_id, event_type, version, trace_id, occurred_at, payload
			) VALUES (?::uuid, 'billing.subscription', ?::uuid, 'subscription.activated.v1', 1, ?, ?, ?::jsonb)
			ON CONFLICT (aggregate_type, aggregate_id, event_type)
				WHERE event_type = 'subscription.activated.v1'
				DO NOTHING
		`, eventID, sub.ID, platform.TraceID(ctx), now, string(payload)).Error; err != nil {
			return fmt.Errorf("append subscription activation outbox: %w", err)
		}
		return nil
	})
}
