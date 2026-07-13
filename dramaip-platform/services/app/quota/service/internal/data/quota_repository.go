package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/quota/internal/ledger"
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

// QuotaAdjustment is the durable effect of a billing subscription upgrade.
// adjustment_id is supplied by billing and makes a retry safe across services.
type QuotaAdjustment struct {
	AdjustmentID   string
	TokenAccountID string
	DeltaTokens    int64
	QuotaBefore    int64
	QuotaAfter     int64
	Status         string
}

// RefundPreparation describes the explicit quota rule used before a refund:
// only an unused account without in-flight reservations can be held
// automatically. Everything else remains visible for manual review.
type RefundPreparation struct {
	RefundID       string
	TokenAccountID string
	Status         string
	UsedTokens     int64
	Reason         string
}

type CreatePeriodAccountInput struct {
	UserID             string
	SubscriptionID     string
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

type SettleTokensInput struct {
	ReservationID    string
	RequestID        string
	Model            string
	PromptTokens     int64
	CompletionTokens int64
	UsageKnown       bool
}

type UsageTrendPoint struct {
	Date        string
	TotalTokens int64
}

func NewData(_ *conf.Bootstrap) (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "quota")
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
		INSERT INTO quota.token_accounts (
			id, user_id, subscription_id, plan_code, plan_name, billing_period, plan_price, currency,
			period_start, period_end, quota_tokens, max_rpm, max_context_tokens, model_level,
			plan_snapshot_source, plan_snapshot_at, used_tokens, status
		)
		VALUES (
			?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::numeric, ?,
			?::timestamptz, ?::timestamptz, ?, ?, ?, ?, ?, ?::timestamptz, 0, 'active'
		)
		ON CONFLICT (subscription_id, period_start) DO UPDATE SET
			status = 'active',
			updated_at = now()
	`, accountID, input.UserID, input.SubscriptionID, input.PlanCode, input.PlanName, input.BillingPeriod, input.PlanPrice, input.Currency,
		input.PeriodStart, input.PeriodEnd, input.QuotaTokens, input.MaxRPM, input.MaxContextTokens, input.ModelLevel,
		input.PlanSnapshotSource, input.PlanSnapshotAt).Error
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

func (r *QuotaRepo) AdjustPeriodQuota(ctx context.Context, adjustmentID, userID, subscriptionID string, deltaTokens int64, reason string) (QuotaAdjustment, error) {
	var out QuotaAdjustment
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing struct {
			AdjustmentID   string
			TokenAccountID string
			DeltaTokens    int64
			QuotaBefore    int64
			QuotaAfter     int64
		}
		if err := tx.Raw(`
			SELECT adjustment_id, COALESCE(token_account_id::text, '') AS token_account_id,
			       delta_tokens, COALESCE(quota_before, 0) AS quota_before, COALESCE(quota_after, 0) AS quota_after
			FROM quota.quota_adjustments
			WHERE adjustment_id = ?
			FOR UPDATE
		`, adjustmentID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.AdjustmentID != "" {
			out = QuotaAdjustment{AdjustmentID: existing.AdjustmentID, TokenAccountID: existing.TokenAccountID, DeltaTokens: existing.DeltaTokens, QuotaBefore: existing.QuotaBefore, QuotaAfter: existing.QuotaAfter, Status: "applied"}
			return nil
		}
		var account struct {
			ID          string
			QuotaTokens int64
		}
		if err := tx.Raw(`
			SELECT id::text AS id, quota_tokens
			FROM quota.token_accounts
			WHERE user_id = ?::uuid AND subscription_id = ?::uuid
			  AND status = 'active' AND period_start <= now() AND period_end > now()
			ORDER BY period_start DESC
			LIMIT 1
			FOR UPDATE
		`, userID, subscriptionID).Scan(&account).Error; err != nil {
			return err
		}
		if account.ID == "" {
			return status.Error(codes.NotFound, "active token account not found")
		}
		after := account.QuotaTokens + deltaTokens
		if after < account.QuotaTokens {
			return status.Error(codes.FailedPrecondition, "quota adjustment cannot reduce current entitlement")
		}
		if err := tx.Exec(`
			UPDATE quota.token_accounts
			SET quota_tokens = ?, updated_at = now()
			WHERE id = ?::uuid
		`, after, account.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO quota.quota_adjustments (
				id, adjustment_id, user_id, subscription_id, token_account_id, kind, reason,
				delta_tokens, quota_before, quota_after
			) VALUES (?::uuid, ?, ?::uuid, ?::uuid, ?::uuid, 'upgrade', ?, ?, ?, ?)
		`, platform.NewUUID(), adjustmentID, userID, subscriptionID, account.ID, reason, deltaTokens, account.QuotaTokens, after).Error; err != nil {
			return err
		}
		out = QuotaAdjustment{AdjustmentID: adjustmentID, TokenAccountID: account.ID, DeltaTokens: deltaTokens, QuotaBefore: account.QuotaTokens, QuotaAfter: after, Status: "applied"}
		return nil
	})
	return out, err
}

func (r *QuotaRepo) PrepareRefund(ctx context.Context, refundID, userID, subscriptionID, reason string) (RefundPreparation, error) {
	var out RefundPreparation
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing struct {
			RefundID       string
			TokenAccountID string
			Status         string
			UsedTokens     int64
			Reason         string
		}
		if err := tx.Raw(`
			SELECT refund_id, COALESCE(token_account_id::text, '') AS token_account_id,
			       status, used_tokens, reason
			FROM quota.refund_holds
			WHERE refund_id = ?
			FOR UPDATE
		`, refundID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.RefundID != "" {
			out = RefundPreparation{RefundID: existing.RefundID, TokenAccountID: existing.TokenAccountID, Status: existing.Status, UsedTokens: existing.UsedTokens, Reason: existing.Reason}
			return nil
		}
		var account struct {
			ID          string
			UsedTokens  int64
			QuotaTokens int64
		}
		if err := tx.Raw(`
			SELECT id::text AS id, used_tokens, quota_tokens
			FROM quota.token_accounts
			WHERE user_id = ?::uuid AND subscription_id = ?::uuid
			  AND status = 'active' AND period_start <= now() AND period_end > now()
			ORDER BY period_start DESC
			LIMIT 1
			FOR UPDATE
		`, userID, subscriptionID).Scan(&account).Error; err != nil {
			return err
		}
		if account.ID == "" {
			out = RefundPreparation{RefundID: refundID, Status: "manual_review", Reason: "no active token account"}
			return insertRefundHold(tx, userID, subscriptionID, out)
		}
		var inFlight int64
		if err := tx.Raw(`
			SELECT count(*)
			FROM quota.token_reservations
			WHERE token_account_id = ?::uuid AND status IN ('reserved', 'settlement_pending')
		`, account.ID).Scan(&inFlight).Error; err != nil {
			return err
		}
		out = RefundPreparation{RefundID: refundID, TokenAccountID: account.ID, UsedTokens: account.UsedTokens}
		if account.UsedTokens > 0 || inFlight > 0 {
			out.Status = "manual_review"
			out.Reason = "quota has settled or in-flight usage"
			return insertRefundHold(tx, userID, subscriptionID, out)
		}
		if err := tx.Exec(`UPDATE quota.token_accounts SET status = 'refund_hold', updated_at = now() WHERE id = ?::uuid`, account.ID).Error; err != nil {
			return err
		}
		out.Status = "held"
		out.Reason = reason
		if err := insertRefundHold(tx, userID, subscriptionID, out); err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO quota.quota_adjustments (
				id, adjustment_id, user_id, subscription_id, token_account_id, kind, reason,
				delta_tokens, quota_before, quota_after
			) VALUES (?::uuid, ?, ?::uuid, ?::uuid, ?::uuid, 'refund_hold', ?, 0, ?, ?)
			ON CONFLICT (adjustment_id) DO NOTHING
		`, platform.NewUUID(), "refund-hold:"+refundID, userID, subscriptionID, account.ID, reason, account.QuotaTokens, account.QuotaTokens).Error
	})
	return out, err
}

func insertRefundHold(tx *gorm.DB, userID, subscriptionID string, prep RefundPreparation) error {
	return tx.Exec(`
		INSERT INTO quota.refund_holds (refund_id, user_id, subscription_id, token_account_id, status, used_tokens, reason)
		VALUES (?, ?::uuid, ?::uuid, NULLIF(?, '')::uuid, ?, ?, ?)
	`, prep.RefundID, userID, subscriptionID, prep.TokenAccountID, prep.Status, prep.UsedTokens, prep.Reason).Error
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
		existing, err := loadReservationByRequest(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if existing.ID != "" {
			if existing.UserID != userID {
				return status.Error(codes.AlreadyExists, "request id already belongs to another user")
			}
			out = existing.TokenReservation
			return nil
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
		existing, err = loadReservationByRequest(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if existing.ID != "" {
			if existing.UserID != userID {
				return status.Error(codes.AlreadyExists, "request id already belongs to another user")
			}
			out = existing.TokenReservation
			return nil
		}
		var charged struct {
			UsedTokens  int64
			QuotaTokens int64
		}
		if err := tx.Raw(`
			UPDATE quota.token_accounts
			SET used_tokens = used_tokens + ?, updated_at = now()
			WHERE id = ?::uuid AND used_tokens + ? <= quota_tokens
			RETURNING used_tokens, quota_tokens
		`, reservedTokens, account.ID, reservedTokens).Scan(&charged).Error; err != nil {
			return err
		}
		if charged.QuotaTokens == 0 {
			return status.Error(codes.ResourceExhausted, "insufficient quota")
		}
		reservationID := platform.NewUUID()
		var inserted struct{ ExpiresAt string }
		if err := tx.Raw(`
			INSERT INTO quota.token_reservations (id, user_id, token_account_id, request_id, reserved_tokens, status, expires_at)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'reserved', now() + interval '10 minutes')
			RETURNING expires_at::text AS expires_at
		`, reservationID, userID, account.ID, requestID, reservedTokens).Scan(&inserted).Error; err != nil {
			return err
		}
		out = TokenReservation{ID: reservationID, TokenAccountID: account.ID, SubscriptionID: account.SubscriptionID, ReservedTokens: reservedTokens, Status: "reserved", CurrentUsed: charged.UsedTokens, CurrentQuota: charged.QuotaTokens, ExpiresAt: inserted.ExpiresAt}
		return nil
	})
	return out, err
}

func (r *QuotaRepo) SettleTokens(ctx context.Context, input SettleTokensInput) (TokenUsage, error) {
	if input.UsageKnown && (input.PromptTokens < 0 || input.CompletionTokens < 0) {
		return TokenUsage{}, status.Error(codes.InvalidArgument, "usage tokens cannot be negative")
	}
	var out TokenUsage
	overQuota := false
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var res struct {
			ID             string
			UserID         string
			RequestID      string
			TokenAccountID string
			SubscriptionID string
			ReservedTokens int64
			Status         string
		}
		if err := tx.Raw(`
			SELECT r.id::text AS id, r.user_id::text AS user_id, r.token_account_id::text AS token_account_id,
			       r.request_id, a.subscription_id::text AS subscription_id, r.reserved_tokens, r.status
			FROM quota.token_reservations r
			JOIN quota.token_accounts a ON a.id = r.token_account_id
			WHERE r.id = ?::uuid
			FOR UPDATE
		`, input.ReservationID).Scan(&res).Error; err != nil {
			return err
		}
		if res.ID == "" {
			return status.Error(codes.NotFound, "reservation not found")
		}
		if res.RequestID != input.RequestID {
			return status.Error(codes.FailedPrecondition, "reservation request id does not match")
		}
		var existing TokenUsage
		if err := tx.Raw(`
			SELECT id::text AS id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status, created_at::text AS created_at
			FROM quota.token_usage_logs WHERE request_id = ? LIMIT 1
		`, input.RequestID).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			out = existing
			return nil
		}
		if res.Status != "reserved" && res.Status != "settlement_pending" {
			return status.Errorf(codes.FailedPrecondition, "reservation status %s cannot be settled", res.Status)
		}
		if !input.UsageKnown {
			if err := tx.Exec(`
				UPDATE quota.token_reservations
				SET status = 'settlement_pending',
				    settlement_deadline = now() + interval '30 minutes',
				    settlement_attempts = settlement_attempts + 1,
				    settlement_error = 'provider usage unavailable',
				    updated_at = now()
				WHERE id = ?::uuid
			`, res.ID).Error; err != nil {
				return err
			}
			out = TokenUsage{RequestID: input.RequestID, Model: input.Model, TotalTokens: res.ReservedTokens, Status: "settlement_pending"}
			return nil
		}
		total := input.PromptTokens + input.CompletionTokens
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
		if err := tx.Exec(`
			UPDATE quota.token_reservations
			SET actual_tokens = ?, status = ?, settlement_deadline = NULL, settlement_error = NULL, updated_at = now()
			WHERE id = ?::uuid
		`, total, usageStatus, res.ID).Error; err != nil {
			return err
		}
		usageID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO quota.token_usage_logs (id, user_id, subscription_id, token_account_id, request_id, model, prompt_tokens, completion_tokens, total_tokens, status)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?)
		`, usageID, res.UserID, res.SubscriptionID, res.TokenAccountID, input.RequestID, input.Model, input.PromptTokens, input.CompletionTokens, total, usageStatus).Error; err != nil {
			return err
		}
		out = TokenUsage{ID: usageID, RequestID: input.RequestID, Model: input.Model, PromptTokens: input.PromptTokens, CompletionTokens: input.CompletionTokens, TotalTokens: total, Status: usageStatus}
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
		if res.Status == "settlement_pending" {
			return status.Error(codes.FailedPrecondition, "settlement-pending reservation cannot be cancelled")
		}
		statusValue := res.Status
		if res.Status == "reserved" {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = GREATEST(used_tokens - ?, 0), updated_at = now() WHERE id = ?::uuid`, res.ReservedTokens, res.TokenAccountID).Error; err != nil {
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
		return ledger.ReclaimExpiredReservations(ctx, tx)
	})
}

func (r *QuotaRepo) FinalizePendingSettlements(ctx context.Context) error {
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return ledger.FinalizePendingSettlements(ctx, tx)
	})
}

type reservationRecord struct {
	UserID string
	TokenReservation
}

func loadReservationByRequest(ctx context.Context, tx *gorm.DB, requestID string) (reservationRecord, error) {
	var row reservationRecord
	err := tx.WithContext(ctx).Raw(`
		SELECT r.id::text AS id, r.user_id::text AS user_id, r.token_account_id::text AS token_account_id,
		       r.reserved_tokens, r.status, a.subscription_id::text AS subscription_id,
		       a.used_tokens AS current_used, a.quota_tokens AS current_quota,
		       COALESCE(r.expires_at::text, '') AS expires_at
		FROM quota.token_reservations r
		JOIN quota.token_accounts a ON a.id = r.token_account_id
		WHERE r.request_id = ?
		LIMIT 1
		FOR UPDATE OF r
	`, requestID).Scan(&row).Error
	return row, err
}
