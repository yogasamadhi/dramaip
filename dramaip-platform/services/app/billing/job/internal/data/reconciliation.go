package data

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/internal/activation"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// ReconciliationRun is the durable report header. The job never changes an
// order, payment, or subscription while detecting a mismatch.
type ReconciliationRun struct {
	ID            string `json:"id"`
	Trigger       string `json:"trigger"`
	RequestedBy   string `json:"requested_by,omitempty"`
	Status        string `json:"status"`
	ScannedOrders int    `json:"scanned_orders"`
	DetectedItems int    `json:"detected_items"`
	FailureReason string `json:"failure_reason,omitempty"`
	StartedAt     string `json:"started_at"`
	FinishedAt    string `json:"finished_at,omitempty"`
}

type ReconciliationItem struct {
	ID                string          `json:"id"`
	CaseKey           string          `json:"case_key"`
	OrderID           string          `json:"order_id,omitempty"`
	SubscriptionID    string          `json:"subscription_id,omitempty"`
	Provider          string          `json:"provider,omitempty"`
	MismatchType      string          `json:"mismatch_type"`
	Severity          string          `json:"severity"`
	Status            string          `json:"status"`
	RecommendedAction string          `json:"recommended_action"`
	Details           json.RawMessage `json:"details"`
	Occurrences       int             `json:"occurrences"`
	FirstDetectedAt   string          `json:"first_detected_at"`
	LastDetectedAt    string          `json:"last_detected_at"`
	ResolvedAt        string          `json:"resolved_at,omitempty"`
	ResolvedBy        string          `json:"resolved_by,omitempty"`
	ResolutionNote    string          `json:"resolution_note,omitempty"`
}

type ReconciliationActionInput struct {
	Action         string `json:"action"`
	Actor          string `json:"actor"`
	Reason         string `json:"reason"`
	IdempotencyKey string `json:"idempotency_key"`
}

type ReconciliationAction struct {
	ID             string          `json:"id"`
	ItemID         string          `json:"item_id"`
	Action         string          `json:"action"`
	IdempotencyKey string          `json:"idempotency_key"`
	Actor          string          `json:"actor"`
	Reason         string          `json:"reason"`
	Status         string          `json:"status"`
	Outcome        json.RawMessage `json:"outcome"`
	CreatedAt      string          `json:"created_at"`
	CompletedAt    string          `json:"completed_at,omitempty"`
}

type reconciliationTarget struct {
	OrderID                 string
	SortAt                  string
	UserID                  string
	Provider                string
	ProviderOrderID         string
	OrderAmount             string
	Currency                string
	SubscriptionID          string
	SubscriptionStatus      string
	PeriodStart             string
	PeriodEnd               string
	PlanCode                string
	QuotaTokens             int64
	PaymentCount            int
	PaidPaymentCount        int
	PaymentFieldsMismatch   bool
	ProviderEvidencePresent bool
}

// Reconcile compares the billing ledger against its current entitlement. It
// is intentionally local-ledger-first: real provider settlement files and
// live financial actions require separately configured merchant credentials.
func (d *Data) Reconcile(ctx context.Context, trigger, requestedBy string, batch int) (ReconciliationRun, error) {
	return d.reconcile(ctx, trigger, requestedBy, "", batch)
}

func (d *Data) ReconcileIdempotent(ctx context.Context, trigger, requestedBy, idempotencyKey string, batch int) (ReconciliationRun, error) {
	return d.reconcile(ctx, trigger, requestedBy, idempotencyKey, batch)
}

func (d *Data) reconcile(ctx context.Context, trigger, requestedBy, idempotencyKey string, batch int) (ReconciliationRun, error) {
	if batch <= 0 {
		batch = 1
	}
	run, started, err := d.beginReconciliationRun(ctx, trigger, requestedBy, idempotencyKey)
	if err != nil || !started {
		return run, err
	}

	targets, err := d.loadReconciliationTargets(ctx, batch)
	if err != nil {
		return d.failReconciliationRun(ctx, run, err)
	}

	detected := 0
	for _, target := range targets {
		if target.PaymentCount != 1 || target.PaidPaymentCount != 1 {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "payment_count_mismatch", "critical", "investigate_payment_ledger", map[string]any{
				"payment_count": target.PaymentCount, "paid_payment_count": target.PaidPaymentCount,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}
		if target.PaymentFieldsMismatch {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "payment_fields_mismatch", "critical", "investigate_payment_ledger", map[string]any{
				"expected_provider": target.Provider, "expected_amount": target.OrderAmount, "expected_currency": target.Currency,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}
		if target.SubscriptionID == "" {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "missing_subscription", "critical", "manual_confirm_or_refund", map[string]any{
				"order_status": "paid",
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
			continue
		}
		if target.SubscriptionStatus != "active" && target.SubscriptionStatus != "quota_pending" && target.SubscriptionStatus != "activation_failed" {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "unexpected_subscription_state", "warning", "manual_review", map[string]any{
				"subscription_status": target.SubscriptionStatus,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}
		if target.Provider != "simulated" && !target.ProviderEvidencePresent {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "provider_evidence_missing", "critical", "verify_provider_query", map[string]any{
				"provider_order_id": target.ProviderOrderID,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}

		account, err := d.Quota.GetPeriodAccount(ctx, &quotav1.GetPeriodAccountRequest{
			SubscriptionId: target.SubscriptionID, PeriodStart: target.PeriodStart,
		})
		if err != nil {
			detected++
			if recordErr := d.recordReconciliationItem(ctx, run.ID, target, "quota_lookup_failed", "warning", "retry_reconciliation", map[string]any{
				"error": boundedReason(err),
			}); recordErr != nil {
				return d.failReconciliationRun(ctx, run, recordErr)
			}
			continue
		}
		if !account.Found || account.Account == nil {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "missing_quota_account", "critical", "retry_quota_provision", map[string]any{
				"period_start": target.PeriodStart, "period_end": target.PeriodEnd, "expected_quota_tokens": target.QuotaTokens,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
			continue
		}
		if account.Account.UserId != target.UserID || account.Account.PlanCode != target.PlanCode || account.Account.QuotaTokens != target.QuotaTokens {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "quota_snapshot_mismatch", "critical", "freeze_entitlement", map[string]any{
				"expected_user_id": target.UserID, "actual_user_id": account.Account.UserId,
				"expected_plan_code": target.PlanCode, "actual_plan_code": account.Account.PlanCode,
				"expected_quota_tokens": target.QuotaTokens, "actual_quota_tokens": account.Account.QuotaTokens,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}
		if target.SubscriptionStatus == "active" && account.Account.Status != "active" {
			detected++
			if err := d.recordReconciliationItem(ctx, run.ID, target, "quota_account_inactive", "warning", "manual_review", map[string]any{
				"account_status": account.Account.Status,
			}); err != nil {
				return d.failReconciliationRun(ctx, run, err)
			}
		}
	}
	return d.completeReconciliationRun(ctx, run, len(targets), detected)
}

func (d *Data) beginReconciliationRun(ctx context.Context, trigger, requestedBy, idempotencyKey string) (ReconciliationRun, bool, error) {
	trigger = strings.TrimSpace(trigger)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if trigger == "" {
		trigger = "scheduled"
	}
	if idempotencyKey != "" {
		var existing ReconciliationRun
		if err := d.DB.WithContext(ctx).Raw(`
			SELECT id::text AS id, trigger, requested_by, status, scanned_orders, detected_items,
			       COALESCE(failure_reason, '') AS failure_reason, started_at::text AS started_at,
			       COALESCE(finished_at::text, '') AS finished_at
			FROM billing.reconciliation_runs WHERE idempotency_key = ? LIMIT 1
		`, idempotencyKey).Scan(&existing).Error; err != nil {
			return ReconciliationRun{}, false, err
		}
		if existing.ID != "" {
			return existing, false, nil
		}
	}
	run := ReconciliationRun{ID: platform.NewUUID(), Trigger: trigger, RequestedBy: strings.TrimSpace(requestedBy), Status: "running"}
	var created struct{ StartedAt string }
	result := d.DB.WithContext(ctx).Raw(`
		INSERT INTO billing.reconciliation_runs (id, trigger, requested_by, status, idempotency_key)
		VALUES (?::uuid, ?, ?, 'running', NULLIF(?, ''))
		ON CONFLICT DO NOTHING
		RETURNING started_at::text AS started_at
	`, run.ID, run.Trigger, run.RequestedBy, idempotencyKey).Scan(&created)
	if result.Error != nil {
		return ReconciliationRun{}, false, result.Error
	}
	if created.StartedAt == "" {
		if idempotencyKey != "" {
			var existing ReconciliationRun
			if err := d.DB.WithContext(ctx).Raw(`
				SELECT id::text AS id, trigger, requested_by, status, scanned_orders, detected_items,
				       COALESCE(failure_reason, '') AS failure_reason, started_at::text AS started_at,
				       COALESCE(finished_at::text, '') AS finished_at
				FROM billing.reconciliation_runs WHERE idempotency_key = ? LIMIT 1
			`, idempotencyKey).Scan(&existing).Error; err != nil {
				return ReconciliationRun{}, false, err
			}
			if existing.ID != "" {
				return existing, false, nil
			}
		}
		return ReconciliationRun{Status: "skipped"}, false, nil
	}
	run.StartedAt = created.StartedAt
	return run, true, nil
}

func (d *Data) completeReconciliationRun(ctx context.Context, run ReconciliationRun, scanned, detected int) (ReconciliationRun, error) {
	run.Status, run.ScannedOrders, run.DetectedItems = "completed", scanned, detected
	var completed struct{ FinishedAt string }
	if err := d.DB.WithContext(ctx).Raw(`
		UPDATE billing.reconciliation_runs
		SET status = 'completed', scanned_orders = ?, detected_items = ?, finished_at = now()
		WHERE id = ?::uuid
		RETURNING finished_at::text AS finished_at
	`, scanned, detected, run.ID).Scan(&completed).Error; err != nil {
		return ReconciliationRun{}, err
	}
	run.FinishedAt = completed.FinishedAt
	return run, nil
}

func (d *Data) failReconciliationRun(ctx context.Context, run ReconciliationRun, cause error) (ReconciliationRun, error) {
	run.Status, run.FailureReason = "failed", boundedReason(cause)
	_ = d.DB.WithContext(ctx).Exec(`
		UPDATE billing.reconciliation_runs
		SET status = 'failed', failure_reason = ?, finished_at = now()
		WHERE id = ?::uuid AND status = 'running'
	`, run.FailureReason, run.ID).Error
	return run, cause
}

func (d *Data) loadReconciliationTargets(ctx context.Context, batch int) ([]reconciliationTarget, error) {
	var cursor struct {
		PaidAt  string
		OrderID string
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT COALESCE(last_paid_at::text, '') AS paid_at, COALESCE(last_order_id::text, '') AS order_id
		FROM billing.reconciliation_cursors WHERE name = 'paid_orders'
	`).Scan(&cursor).Error; err != nil {
		return nil, err
	}
	rows, err := d.queryReconciliationTargets(ctx, batch, cursor.PaidAt, cursor.OrderID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 && cursor.OrderID != "" {
		if err := d.DB.WithContext(ctx).Exec(`DELETE FROM billing.reconciliation_cursors WHERE name = 'paid_orders'`).Error; err != nil {
			return nil, err
		}
		rows, err = d.queryReconciliationTargets(ctx, batch, "", "")
		if err != nil {
			return nil, err
		}
	}
	if len(rows) == 0 {
		return rows, nil
	}
	last := rows[len(rows)-1]
	if err := d.DB.WithContext(ctx).Exec(`
		INSERT INTO billing.reconciliation_cursors (name, last_paid_at, last_order_id)
		VALUES ('paid_orders', ?::timestamptz, ?::uuid)
		ON CONFLICT (name) DO UPDATE
		SET last_paid_at = EXCLUDED.last_paid_at, last_order_id = EXCLUDED.last_order_id, updated_at = now()
	`, last.SortAt, last.OrderID).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (d *Data) queryReconciliationTargets(ctx context.Context, batch int, paidAt, orderID string) ([]reconciliationTarget, error) {
	var rows []reconciliationTarget
	err := d.DB.WithContext(ctx).Raw(`
		SELECT o.id::text AS order_id, COALESCE(o.paid_at, o.created_at)::text AS sort_at,
		       o.user_id::text AS user_id, o.provider,
		       COALESCE(o.provider_order_id, '') AS provider_order_id, o.amount::text AS order_amount, o.currency,
		       COALESCE(o.subscription_id::text, '') AS subscription_id,
		       COALESCE(sub.status, '') AS subscription_status,
		       COALESCE(sub.current_period_start::text, '') AS period_start,
		       COALESCE(sub.current_period_end::text, '') AS period_end,
		       COALESCE(sub.plan_code, '') AS plan_code,
		       COALESCE(sub.monthly_token_quota, 0) AS quota_tokens,
		       (SELECT count(*) FROM billing.payments p WHERE p.order_id = o.id)::int AS payment_count,
		       (SELECT count(*) FROM billing.payments p WHERE p.order_id = o.id AND p.status = 'paid')::int AS paid_payment_count,
		       COALESCE((SELECT bool_or(p.provider <> o.provider OR p.amount <> o.amount OR p.currency <> o.currency)
		                 FROM billing.payments p WHERE p.order_id = o.id AND p.status = 'paid'), false) AS payment_fields_mismatch,
		       CASE WHEN o.provider = 'simulated' THEN true ELSE EXISTS (
		         SELECT 1 FROM billing.webhook_events event
		         WHERE event.provider = o.provider AND event.provider_order_id = o.provider_order_id
		           AND event.verification_status IN ('processed', 'query_confirmed')
		       ) END AS provider_evidence_present
		FROM billing.orders o
		LEFT JOIN billing.subscriptions sub ON sub.id = o.subscription_id
		WHERE o.status = 'paid'
		  AND (? = '' OR (COALESCE(o.paid_at, o.created_at), o.id::text) > (NULLIF(?, '')::timestamptz, ?))
		ORDER BY COALESCE(o.paid_at, o.created_at) ASC, o.id::text ASC
		LIMIT ?
	`, orderID, paidAt, orderID, batch).Scan(&rows).Error
	return rows, err
}

func (d *Data) recordReconciliationItem(ctx context.Context, runID string, target reconciliationTarget, mismatchType, severity, recommendation string, details map[string]any) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	caseKey := strings.Join([]string{mismatchType, target.OrderID, target.SubscriptionID}, ":")
	return d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var item struct{ ID string }
		if err := tx.Raw(`
			INSERT INTO billing.reconciliation_items (
				id, case_key, first_run_id, last_run_id, order_id, subscription_id, provider,
				mismatch_type, severity, status, recommended_action, details
			) VALUES (
				?::uuid, ?, ?::uuid, ?::uuid, NULLIF(?, '')::uuid, NULLIF(?, '')::uuid, ?,
				?, ?, 'open', ?, ?::jsonb
			)
			ON CONFLICT (case_key) DO UPDATE
			SET last_run_id = EXCLUDED.last_run_id,
				provider = EXCLUDED.provider,
				severity = EXCLUDED.severity,
				recommended_action = EXCLUDED.recommended_action,
				details = EXCLUDED.details,
				occurrences = billing.reconciliation_items.occurrences + 1,
				last_detected_at = now(),
				status = CASE WHEN billing.reconciliation_items.status = 'resolved' THEN 'open' ELSE billing.reconciliation_items.status END,
				resolved_at = CASE WHEN billing.reconciliation_items.status = 'resolved' THEN NULL ELSE billing.reconciliation_items.resolved_at END,
				resolved_by = CASE WHEN billing.reconciliation_items.status = 'resolved' THEN NULL ELSE billing.reconciliation_items.resolved_by END,
				resolution_note = CASE WHEN billing.reconciliation_items.status = 'resolved' THEN NULL ELSE billing.reconciliation_items.resolution_note END,
				updated_at = now()
			RETURNING id::text AS id
		`, platform.NewUUID(), caseKey, runID, runID, target.OrderID, target.SubscriptionID, target.Provider,
			mismatchType, severity, recommendation, string(payload)).Scan(&item).Error; err != nil {
			return err
		}
		if item.ID == "" {
			return status.Error(codes.Internal, "reconciliation case was not persisted")
		}
		return tx.Exec(`
			INSERT INTO billing.reconciliation_observations (
				id, run_id, item_id, case_key, mismatch_type, severity, recommended_action, details
			) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?::jsonb)
			ON CONFLICT (run_id, item_id) DO NOTHING
		`, platform.NewUUID(), runID, item.ID, caseKey, mismatchType, severity, recommendation, string(payload)).Error
	})
}

func (d *Data) LatestReconciliationRun(ctx context.Context) (ReconciliationRun, error) {
	var run ReconciliationRun
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, trigger, requested_by, status, scanned_orders, detected_items,
		       COALESCE(failure_reason, '') AS failure_reason, started_at::text AS started_at,
		       COALESCE(finished_at::text, '') AS finished_at
		FROM billing.reconciliation_runs ORDER BY started_at DESC LIMIT 1
	`).Scan(&run).Error
	if err != nil {
		return ReconciliationRun{}, err
	}
	if run.ID == "" {
		return ReconciliationRun{}, status.Error(codes.NotFound, "reconciliation run not found")
	}
	return run, nil
}

func (d *Data) ListReconciliationItems(ctx context.Context, state string, limit int) ([]ReconciliationItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	state = strings.TrimSpace(state)
	var rows []ReconciliationItem
	err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, case_key, COALESCE(order_id::text, '') AS order_id,
		       COALESCE(subscription_id::text, '') AS subscription_id, provider, mismatch_type, severity, status,
		       recommended_action, details, occurrences, first_detected_at::text AS first_detected_at,
		       last_detected_at::text AS last_detected_at, COALESCE(resolved_at::text, '') AS resolved_at,
		       COALESCE(resolved_by, '') AS resolved_by, COALESCE(resolution_note, '') AS resolution_note
		FROM billing.reconciliation_items
		WHERE (? = '' OR status = ?)
		ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_detected_at DESC
		LIMIT ?
	`, state, state, limit).Scan(&rows).Error
	return rows, err
}

// ApplyReconciliationAction appends a durable actor audit record before doing
// anything. Financial and entitlement freeze/refund actions deliberately stay
// in manual_review: this job has no authority to fabricate a provider refund
// or silently alter a ledger. The one safe repair is restoring a missing
// quota period for an already-paid subscription through its idempotent API.
func (d *Data) ApplyReconciliationAction(ctx context.Context, itemID string, input ReconciliationActionInput) (ReconciliationAction, error) {
	input.Action = strings.TrimSpace(input.Action)
	input.Actor = strings.TrimSpace(input.Actor)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Actor == "" || input.Reason == "" || input.IdempotencyKey == "" {
		return ReconciliationAction{}, status.Error(codes.InvalidArgument, "actor, reason, and idempotency key are required")
	}
	if !allowedReconciliationAction(input.Action) {
		return ReconciliationAction{}, status.Error(codes.InvalidArgument, "unsupported reconciliation action")
	}

	action, item, created, err := d.beginReconciliationAction(ctx, itemID, input)
	if err != nil || !created {
		return action, err
	}

	if input.Action == "retry_quota_provision" {
		if err := d.repairMissingQuota(ctx, item); err != nil {
			return d.finishReconciliationAction(ctx, action, "failed", "open", nil, err)
		}
		return d.finishReconciliationAction(ctx, action, "completed", "resolved", map[string]any{
			"effect": "created_or_reused_quota_period", "automatic_financial_action": false,
		}, nil)
	}
	if input.Action == "manual_confirm" {
		return d.finishReconciliationAction(ctx, action, "completed", "resolved", map[string]any{
			"effect": "operator_acknowledgement_only", "automatic_financial_action": false,
		}, nil)
	}
	return d.finishReconciliationAction(ctx, action, "manual_review", "manual_review", map[string]any{
		"effect": "queued_for_manual_financial_or_entitlement_workflow", "automatic_financial_action": false,
	}, nil)
}

func (d *Data) beginReconciliationAction(ctx context.Context, itemID string, input ReconciliationActionInput) (ReconciliationAction, ReconciliationItem, bool, error) {
	var action ReconciliationAction
	var item ReconciliationItem
	err := d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`
			SELECT id::text AS id, case_key, COALESCE(order_id::text, '') AS order_id,
			       COALESCE(subscription_id::text, '') AS subscription_id, provider, mismatch_type, severity, status,
			       recommended_action, details, occurrences, first_detected_at::text AS first_detected_at,
			       last_detected_at::text AS last_detected_at
			FROM billing.reconciliation_items WHERE id = ?::uuid FOR UPDATE
		`, itemID).Scan(&item).Error; err != nil {
			return err
		}
		if item.ID == "" {
			return status.Error(codes.NotFound, "reconciliation item not found")
		}
		if err := tx.Raw(`
			SELECT id::text AS id, item_id::text AS item_id, action, idempotency_key, actor, reason, status,
			       outcome, created_at::text AS created_at, COALESCE(completed_at::text, '') AS completed_at
			FROM billing.reconciliation_actions WHERE idempotency_key = ? FOR UPDATE
		`, input.IdempotencyKey).Scan(&action).Error; err != nil {
			return err
		}
		if action.ID != "" {
			if action.ItemID != itemID || action.Action != input.Action {
				return status.Error(codes.AlreadyExists, "idempotency key is already used by another reconciliation action")
			}
			return nil
		}
		action = ReconciliationAction{ID: platform.NewUUID(), ItemID: itemID, Action: input.Action, IdempotencyKey: input.IdempotencyKey, Actor: input.Actor, Reason: input.Reason, Status: "running"}
		var created struct{ CreatedAt string }
		if err := tx.Raw(`
			INSERT INTO billing.reconciliation_actions (id, item_id, action, idempotency_key, actor, reason, status)
			VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, 'running')
			RETURNING created_at::text AS created_at
		`, action.ID, action.ItemID, action.Action, action.IdempotencyKey, action.Actor, action.Reason).Scan(&created).Error; err != nil {
			return err
		}
		action.CreatedAt = created.CreatedAt
		return nil
	})
	if err != nil {
		return ReconciliationAction{}, ReconciliationItem{}, false, err
	}
	return action, item, action.Status == "running", nil
}

func (d *Data) finishReconciliationAction(ctx context.Context, action ReconciliationAction, actionState, itemState string, outcome map[string]any, cause error) (ReconciliationAction, error) {
	if outcome == nil {
		outcome = map[string]any{"error": boundedReason(cause)}
	}
	payload, err := json.Marshal(outcome)
	if err != nil {
		return ReconciliationAction{}, err
	}
	err = d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			UPDATE billing.reconciliation_actions
			SET status = ?, outcome = ?::jsonb, completed_at = now()
			WHERE id = ?::uuid AND status = 'running'
		`, actionState, string(payload), action.ID).Error; err != nil {
			return err
		}
		if itemState == "resolved" {
			return tx.Exec(`
				UPDATE billing.reconciliation_items
				SET status = 'resolved', resolved_at = now(), resolved_by = ?, resolution_note = ?, updated_at = now()
				WHERE id = ?::uuid
			`, action.Actor, action.Reason, action.ItemID).Error
		}
		return tx.Exec(`UPDATE billing.reconciliation_items SET status = ?, updated_at = now() WHERE id = ?::uuid`, itemState, action.ItemID).Error
	})
	if err != nil {
		return ReconciliationAction{}, err
	}
	action.Status, action.Outcome, action.CompletedAt = actionState, payload, time.Now().UTC().Format(time.RFC3339Nano)
	return action, cause
}

func (d *Data) repairMissingQuota(ctx context.Context, item ReconciliationItem) error {
	if item.MismatchType != "missing_quota_account" || item.SubscriptionID == "" {
		return status.Error(codes.FailedPrecondition, "quota repair is only allowed for a missing quota account")
	}
	var sub struct {
		ID                 string
		UserID             string
		Status             string
		PlanCode           string
		PlanName           string
		BillingPeriod      string
		PlanPrice          string
		Currency           string
		QuotaTokens        int64
		MaxRPM             int64
		MaxContextTokens   int64
		ModelLevel         string
		PlanSnapshotSource string
		PlanSnapshotAt     string
		PeriodStart        string
		PeriodEnd          string
	}
	if err := d.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, user_id::text AS user_id, status, plan_code, plan_name, billing_period,
		       plan_price::text AS plan_price, currency, monthly_token_quota AS quota_tokens, max_rpm,
		       max_context_tokens, model_level, plan_snapshot_source, plan_snapshot_at::text AS plan_snapshot_at,
		       current_period_start::text AS period_start, current_period_end::text AS period_end
		FROM billing.subscriptions WHERE id = ?::uuid
	`, item.SubscriptionID).Scan(&sub).Error; err != nil {
		return err
	}
	if sub.ID == "" {
		return status.Error(codes.NotFound, "subscription for reconciliation item not found")
	}
	if _, err := d.Quota.CreatePeriodAccount(ctx, &quotav1.CreatePeriodAccountRequest{
		UserId: sub.UserID, SubscriptionId: sub.ID, QuotaTokens: sub.QuotaTokens,
		PeriodStart: sub.PeriodStart, PeriodEnd: sub.PeriodEnd, PlanCode: sub.PlanCode, PlanName: sub.PlanName,
		BillingPeriod: sub.BillingPeriod, PlanPrice: sub.PlanPrice, Currency: sub.Currency, MaxRpm: sub.MaxRPM,
		MaxContextTokens: sub.MaxContextTokens, ModelLevel: sub.ModelLevel,
		PlanSnapshotSource: sub.PlanSnapshotSource, PlanSnapshotAt: sub.PlanSnapshotAt,
	}); err != nil {
		return err
	}
	if sub.Status == "quota_pending" || sub.Status == "activation_failed" {
		return activation.ActivateSubscription(ctx, d.DB, sub.ID)
	}
	return nil
}

func allowedReconciliationAction(action string) bool {
	switch action {
	case "retry_quota_provision", "request_refund", "freeze_entitlement", "manual_confirm":
		return true
	default:
		return false
	}
}

func boundedReason(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) > 500 {
		return value[:500]
	}
	return value
}
