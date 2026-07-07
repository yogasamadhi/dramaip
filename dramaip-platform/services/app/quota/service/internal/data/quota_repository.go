package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type Data struct{ DB *gorm.DB }

type TokenBalance struct {
	Plan            string
	QuotaTokens     int64
	UsedTokens      int64
	RemainingTokens int64
	PeriodStart     string
	PeriodEnd       string
}

type TokenAccount struct {
	ID             string
	UserID         string
	SubscriptionID string
	QuotaTokens    int64
	UsedTokens     int64
}

type CreatePeriodAccountInput struct {
	UserID         string
	SubscriptionID string
	PlanCode       string
	QuotaTokens    int64
	PeriodStart    string
	PeriodEnd      string
}

type TokenReservation struct {
	ID             string
	TokenAccountID string
	ReservedTokens int64
	Status         string
	SubscriptionID string
	CurrentUsed    int64
	CurrentQuota   int64
	ExpiresAt      string
}

type TokenUsage struct {
	ID               string
	RequestID        string
	Model            string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	Status           string
	CreatedAt        string
}

type UsageTrendPoint struct {
	Date        string
	TotalTokens int64
}

func NewData(_ *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenPostgres()
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}

type QuotaRepo struct{ data *Data }

func NewQuotaRepo(data *Data) *QuotaRepo { return &QuotaRepo{data: data} }

func (r *QuotaRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) },
	}
}

func (r *QuotaRepo) CreatePeriodAccount(ctx context.Context, input CreatePeriodAccountInput) (TokenAccount, error) {
	accountID := platform.NewUUID()
	err := r.data.DB.WithContext(ctx).Exec(`
		INSERT INTO quota.token_accounts (id, user_id, subscription_id, plan_code, period_start, period_end, quota_tokens, used_tokens, status)
		VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?::timestamptz, ?::timestamptz, ?, 0, 'active')
		ON CONFLICT (subscription_id, period_start) DO UPDATE SET
			plan_code = EXCLUDED.plan_code,
			quota_tokens = EXCLUDED.quota_tokens,
			status = 'active',
			updated_at = now()
	`, accountID, input.UserID, input.SubscriptionID, input.PlanCode, input.PeriodStart, input.PeriodEnd, input.QuotaTokens).Error
	if err != nil {
		return TokenAccount{}, err
	}
	var out TokenAccount
	err = r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, user_id::text AS user_id, subscription_id::text AS subscription_id, quota_tokens, used_tokens
		FROM quota.token_accounts
		WHERE subscription_id = ?::uuid AND period_start = ?::timestamptz
		LIMIT 1
	`, input.SubscriptionID, input.PeriodStart).Scan(&out).Error
	if err != nil || out.ID == "" {
		return TokenAccount{}, status.Error(codes.NotFound, "token account not found")
	}
	return out, nil
}

func (r *QuotaRepo) GetTokenBalance(ctx context.Context, userID string) (TokenBalance, error) {
	var row TokenBalance
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT COALESCE(plan_code, '') AS plan, quota_tokens, used_tokens,
		       quota_tokens - used_tokens AS remaining_tokens,
		       period_start::text AS period_start, period_end::text AS period_end
		FROM quota.token_accounts
		WHERE user_id = ?::uuid AND status = 'active'
		ORDER BY period_start DESC
		LIMIT 1
	`, userID).Scan(&row).Error
	if err != nil || row.QuotaTokens == 0 {
		return TokenBalance{}, status.Error(codes.NotFound, "token balance not found")
	}
	return row, nil
}

func (r *QuotaRepo) ReserveTokens(ctx context.Context, userID string, requestID string, reservedTokens int64) (TokenReservation, error) {
	var out TokenReservation
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing TokenReservation
		if err := tx.Raw(`
			SELECT r.id::text AS id, r.token_account_id::text AS token_account_id, r.reserved_tokens, r.status,
			       a.subscription_id::text AS subscription_id, a.used_tokens AS current_used, a.quota_tokens AS current_quota
			FROM quota.token_reservations r
			JOIN quota.token_accounts a ON a.id = r.token_account_id
			WHERE r.request_id = ? AND r.user_id = ?::uuid
			LIMIT 1
			FOR UPDATE OF r
		`, requestID, userID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			return status.Error(codes.AlreadyExists, "request id already has a reservation")
		}
		var account struct {
			ID             string
			SubscriptionID string
			QuotaTokens    int64
			UsedTokens     int64
		}
		if err := tx.Raw(`
			SELECT id::text AS id, subscription_id::text AS subscription_id, quota_tokens, used_tokens
			FROM quota.token_accounts
			WHERE user_id = ?::uuid AND status = 'active' AND period_start <= now() AND period_end > now()
			ORDER BY period_start DESC
			LIMIT 1
			FOR UPDATE
		`, userID).Scan(&account).Error; err != nil {
			return err
		}
		if account.ID == "" {
			return status.Error(codes.NotFound, "token account not found")
		}
		if account.QuotaTokens-account.UsedTokens < reservedTokens {
			return status.Error(codes.ResourceExhausted, "insufficient quota")
		}
		reservationID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO quota.token_reservations (id, user_id, token_account_id, request_id, reserved_tokens, status, expires_at)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'reserved', now() + interval '10 minutes')
		`, reservationID, userID, account.ID, requestID, reservedTokens).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens + ?, updated_at = now() WHERE id = ?::uuid`, reservedTokens, account.ID).Error; err != nil {
			return err
		}
		out = TokenReservation{ID: reservationID, TokenAccountID: account.ID, SubscriptionID: account.SubscriptionID, ReservedTokens: reservedTokens, Status: "reserved", CurrentUsed: account.UsedTokens + reservedTokens, CurrentQuota: account.QuotaTokens}
		return nil
	})
	return out, err
}

func (r *QuotaRepo) SettleTokens(ctx context.Context, reservationID string, requestID string, model string, promptTokens int64, completionTokens int64) (TokenUsage, error) {
	total := promptTokens + completionTokens
	if total <= 0 {
		total = 1
	}
	var out TokenUsage
	overQuota := false
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing TokenUsage
		if err := tx.Raw(`
			SELECT id::text AS id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at::text AS created_at
			FROM quota.token_usage_logs WHERE request_id = ? LIMIT 1
		`, requestID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			out = existing
			return nil
		}
		var res struct {
			ID             string
			UserID         string
			TokenAccountID string
			SubscriptionID string
			ReservedTokens int64
			Status         string
		}
		if err := tx.Raw(`
			SELECT r.id::text AS id, r.user_id::text AS user_id, r.token_account_id::text AS token_account_id,
			       a.subscription_id::text AS subscription_id, r.reserved_tokens, r.status
			FROM quota.token_reservations r
			JOIN quota.token_accounts a ON a.id = r.token_account_id
			WHERE r.id = ?::uuid
			FOR UPDATE
		`, reservationID).Scan(&res).Error; err != nil {
			return err
		}
		if res.ID == "" {
			return status.Error(codes.NotFound, "reservation not found")
		}
		if res.Status != "reserved" {
			return status.Errorf(codes.FailedPrecondition, "reservation status %s cannot be settled", res.Status)
		}
		usageStatus := "settled"
		if delta := total - res.ReservedTokens; delta < 0 {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens + ?, updated_at = now() WHERE id = ?::uuid`, delta, res.TokenAccountID).Error; err != nil {
				return err
			}
		} else if delta > 0 {
			result := tx.Exec(`
				UPDATE quota.token_accounts
				SET used_tokens = used_tokens + ?, updated_at = now()
				WHERE id = ?::uuid AND used_tokens + ? <= quota_tokens
			`, delta, res.TokenAccountID, delta)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				overQuota = true
				usageStatus = "over_quota_settled"
			}
		}
		if err := tx.Exec(`UPDATE quota.token_reservations SET actual_tokens = ?, status = ?, updated_at = now() WHERE id = ?::uuid`, total, usageStatus, res.ID).Error; err != nil {
			return err
		}
		usageID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO quota.token_usage_logs (id, user_id, subscription_id, token_account_id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?)
		`, usageID, res.UserID, res.SubscriptionID, res.TokenAccountID, requestID, model, promptTokens, completionTokens, total, usageStatus).Error; err != nil {
			return err
		}
		out = TokenUsage{ID: usageID, RequestID: requestID, Model: model, PromptTokens: promptTokens, CompletionTokens: completionTokens, TotalTokens: total, Status: usageStatus}
		return nil
	})
	if err != nil {
		return out, err
	}
	if overQuota {
		return out, status.Error(codes.ResourceExhausted, "usage exceeds remaining quota")
	}
	return out, nil
}

func (r *QuotaRepo) CancelReservation(ctx context.Context, reservationID string) (TokenReservation, error) {
	var out TokenReservation
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var res struct {
			ID             string
			TokenAccountID string
			ReservedTokens int64
			Status         string
		}
		if err := tx.Raw(`SELECT id::text AS id, token_account_id::text AS token_account_id, reserved_tokens, status FROM quota.token_reservations WHERE id = ?::uuid FOR UPDATE`, reservationID).Scan(&res).Error; err != nil {
			return err
		}
		if res.ID == "" {
			return status.Error(codes.NotFound, "reservation not found")
		}
		statusValue := res.Status
		if res.Status == "reserved" {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens - ?, updated_at = now() WHERE id = ?::uuid`, res.ReservedTokens, res.TokenAccountID).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE quota.token_reservations SET status = 'cancelled', updated_at = now() WHERE id = ?::uuid`, res.ID).Error; err != nil {
				return err
			}
			statusValue = "cancelled"
		}
		out = TokenReservation{ID: res.ID, TokenAccountID: res.TokenAccountID, ReservedTokens: res.ReservedTokens, Status: statusValue}
		return nil
	})
	return out, err
}

func (r *QuotaRepo) ListTokenUsage(ctx context.Context, userID string, limit int32) ([]TokenUsage, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows []TokenUsage
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT id::text AS id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at::text AS created_at
		FROM quota.token_usage_logs
		WHERE user_id = ?::uuid
		ORDER BY created_at DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	return rows, err
}

func (r *QuotaRepo) GetUsageTrend(ctx context.Context, userID string, days int32) ([]UsageTrendPoint, error) {
	if days <= 0 || days > 90 {
		days = 14
	}
	var rows []UsageTrendPoint
	err := r.data.DB.WithContext(ctx).Raw(`
		SELECT created_at::date::text AS date, COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
		FROM quota.token_usage_logs
		WHERE user_id = ?::uuid AND created_at >= now() - (?::int * interval '1 day')
		GROUP BY created_at::date
		ORDER BY created_at::date ASC
	`, userID, days).Scan(&rows).Error
	return rows, err
}

func (r *QuotaRepo) ReclaimExpiredReservations(ctx context.Context) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []struct {
			ID             string
			TokenAccountID string
			ReservedTokens int64
		}
		if err := tx.Raw(`
			SELECT id::text AS id, token_account_id::text AS token_account_id, reserved_tokens
			FROM quota.token_reservations
			WHERE status = 'reserved' AND expires_at < now()
			FOR UPDATE
		`).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens - ?, updated_at = now() WHERE id = ?::uuid`, row.ReservedTokens, row.TokenAccountID).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE quota.token_reservations SET status = 'expired', updated_at = now() WHERE id = ?::uuid`, row.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
