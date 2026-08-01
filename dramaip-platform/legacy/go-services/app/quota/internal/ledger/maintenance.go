package ledger

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

// ReclaimExpiredReservations returns only leases for which the provider was
// never known to have completed work. settlement_pending deliberately stays
// charged until FinalizePendingSettlements records its conservative outcome.
func ReclaimExpiredReservations(ctx context.Context, tx *gorm.DB) error {
	var rows []struct {
		ID             string
		TokenAccountID string
		ReservedTokens int64
	}
	if err := tx.WithContext(ctx).Raw(`
		SELECT id::text AS id, token_account_id::text AS token_account_id, reserved_tokens
		FROM quota.token_reservations
		WHERE status = 'reserved' AND expires_at < now()
		ORDER BY expires_at ASC
		FOR UPDATE SKIP LOCKED
	`).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := tx.WithContext(ctx).Exec(`
			UPDATE quota.token_accounts
			SET used_tokens = GREATEST(used_tokens - ?, 0), updated_at = now()
			WHERE id = ?::uuid
		`, row.ReservedTokens, row.TokenAccountID).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Exec(`
			UPDATE quota.token_reservations
			SET status = 'expired', updated_at = now()
			WHERE id = ?::uuid AND status = 'reserved'
		`, row.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

// FinalizePendingSettlements makes an unknown provider usage auditable without
// ever releasing its reservation. A later precise settlement can still win
// before the deadline; after it, the reservation itself is the conservative
// charged amount and a ledger row records why it was used.
func FinalizePendingSettlements(ctx context.Context, tx *gorm.DB) error {
	var rows []struct {
		ID             string
		UserID         string
		RequestID      string
		TokenAccountID string
		SubscriptionID string
		ReservedTokens int64
	}
	if err := tx.WithContext(ctx).Raw(`
		SELECT r.id::text AS id, r.user_id::text AS user_id, r.request_id,
		       r.token_account_id::text AS token_account_id,
		       a.subscription_id::text AS subscription_id, r.reserved_tokens
		FROM quota.token_reservations r
		JOIN quota.token_accounts a ON a.id = r.token_account_id
		WHERE r.status = 'settlement_pending'
		  AND r.settlement_deadline IS NOT NULL
		  AND r.settlement_deadline < now()
		ORDER BY r.settlement_deadline ASC
		FOR UPDATE OF r SKIP LOCKED
	`).Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := tx.WithContext(ctx).Exec(`
			UPDATE quota.token_reservations
			SET actual_tokens = reserved_tokens,
			    status = 'settled_estimate',
			    settlement_error = 'provider usage unavailable before settlement deadline',
			    updated_at = now()
			WHERE id = ?::uuid AND status = 'settlement_pending'
		`, row.ID).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Exec(`
			INSERT INTO quota.token_usage_logs (
				id, user_id, subscription_id, token_account_id, request_id, model,
				prompt_tokens, completion_tokens, total_tokens, status, error
			)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, 'usage-unknown', 0, ?, ?, 'settled_estimate',
			        'provider usage unavailable before settlement deadline')
			ON CONFLICT (request_id) DO NOTHING
		`, platform.NewUUID(), row.UserID, row.SubscriptionID, row.TokenAccountID, row.RequestID,
			row.ReservedTokens, row.ReservedTokens).Error; err != nil {
			return err
		}
	}
	return nil
}
