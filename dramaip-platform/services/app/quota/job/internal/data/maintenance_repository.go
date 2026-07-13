package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/quota/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct {
	DB *gorm.DB
}

func NewData(_ *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "quota")
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

func (d *Data) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, d.DB) },
	}
}

func (d *Data) Maintain(ctx context.Context) error {
	return d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var reservations []struct {
			ID             string
			TokenAccountID string
			ReservedTokens int64
		}
		if err := tx.Raw(`
			SELECT id::text AS id, token_account_id::text AS token_account_id, reserved_tokens
			FROM quota.token_reservations
			WHERE status = 'reserved' AND expires_at < now()
			FOR UPDATE
		`).Scan(&reservations).Error; err != nil {
			return err
		}
		for _, reservation := range reservations {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens - ?, updated_at = now() WHERE id = ?::uuid`, reservation.ReservedTokens, reservation.TokenAccountID).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE quota.token_reservations SET status = 'expired', updated_at = now() WHERE id = ?::uuid`, reservation.ID).Error; err != nil {
				return err
			}
		}
		return tx.Exec(`
			INSERT INTO quota.token_accounts (
				id, user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
				period_start, period_end, quota_tokens, max_rpm, max_context_tokens, model_level,
				plan_snapshot_source, plan_snapshot_at, used_tokens, status
			)
			SELECT gen_random_uuid(), user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
				period_end, period_end + interval '1 month', quota_tokens, max_rpm, max_context_tokens, model_level,
				'period_renewal', now(), 0, 'active'
			FROM quota.token_accounts current
			WHERE current.status = 'active'
			  AND current.period_end <= now()
			  AND NOT EXISTS (
			    SELECT 1 FROM quota.token_accounts next
			    WHERE next.subscription_id = current.subscription_id
			      AND next.period_start = current.period_end
			  )
		`).Error
	})
}
