package main

import (
	"context"
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type service struct{ db *gorm.DB }

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	svc := &service{db: db}
	health := platform.HealthServer(platform.Env("QUOTA_HTTP_ADDR", ":8104"), "quota-service", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("quota health server stopped: %v", err)
		}
	}()
	if err := platform.ServeGRPC(platform.Env("QUOTA_GRPC_ADDR", ":9104"), func(server *grpc.Server) {
		drpc.RegisterQuotaServiceServer(server, svc)
	}); err != nil {
		log.Fatalf("quota gRPC failed: %v", err)
	}
}

func (s *service) GetTokenBalance(ctx context.Context, req *drpc.GetTokenBalanceRequest) (*drpc.TokenBalance, error) {
	var row drpc.TokenBalance
	err := s.db.WithContext(ctx).Raw(`
		SELECT
			plan.code AS plan,
			account.quota_tokens,
			account.used_tokens,
			account.quota_tokens - account.used_tokens AS remaining_tokens,
			account.period_start::text AS period_start,
			account.period_end::text AS period_end
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
		JOIN quota.token_accounts account ON account.subscription_id = sub.id
		WHERE sub.user_id = ?::uuid AND sub.status = 'active' AND account.status = 'active'
		ORDER BY account.period_start DESC
		LIMIT 1
	`, req.UserID).Scan(&row).Error
	if err != nil || row.Plan == "" {
		return nil, status.Error(codes.NotFound, "token balance not found")
	}
	return &row, nil
}

func (s *service) ReserveTokens(ctx context.Context, req *drpc.ReserveTokensRequest) (*drpc.TokenReservation, error) {
	if req.ReservedTokens <= 0 {
		req.ReservedTokens = 1
	}
	var out drpc.TokenReservation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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
		`, req.UserID).Scan(&account).Error; err != nil {
			return err
		}
		if account.ID == "" {
			return status.Error(codes.NotFound, "token account not found")
		}
		if account.QuotaTokens-account.UsedTokens < req.ReservedTokens {
			return status.Error(codes.ResourceExhausted, "insufficient quota")
		}
		reservationID := platform.NewUUID()
		if err := tx.Exec(`
			INSERT INTO quota.token_reservations (id, user_id, token_account_id, request_id, reserved_tokens, status)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'reserved')
		`, reservationID, req.UserID, account.ID, req.RequestID, req.ReservedTokens).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			UPDATE quota.token_accounts SET used_tokens = used_tokens + ?, updated_at = now()
			WHERE id = ?::uuid
		`, req.ReservedTokens, account.ID).Error; err != nil {
			return err
		}
		out = drpc.TokenReservation{
			ID: reservationID, TokenAccountID: account.ID, SubscriptionID: account.SubscriptionID,
			ReservedTokens: req.ReservedTokens, Status: "reserved", CurrentUsed: account.UsedTokens + req.ReservedTokens, CurrentQuota: account.QuotaTokens,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *service) SettleTokens(ctx context.Context, req *drpc.SettleTokensRequest) (*drpc.TokenUsage, error) {
	total := req.PromptTokens + req.CompletionTokens
	if total <= 0 {
		total = 1
	}
	usageID := platform.NewUUID()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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
		`, req.ReservationID).Scan(&res).Error; err != nil {
			return err
		}
		if res.ID == "" || res.Status != "reserved" {
			return status.Error(codes.NotFound, "reservation not found")
		}
		delta := total - res.ReservedTokens
		if delta != 0 {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens + ?, updated_at = now() WHERE id = ?::uuid`, delta, res.TokenAccountID).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(`
			UPDATE quota.token_reservations SET actual_tokens = ?, status = 'settled', updated_at = now()
			WHERE id = ?::uuid
		`, total, res.ID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO quota.token_usage_logs (id, user_id, subscription_id, token_account_id, request_id, model, prompt_tokens, completion_tokens, total_tokens)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, ?)
		`, usageID, res.UserID, res.SubscriptionID, res.TokenAccountID, req.RequestID, req.Model, req.PromptTokens, req.CompletionTokens, total).Error
	})
	if err != nil {
		return nil, err
	}
	return &drpc.TokenUsage{ID: usageID, TotalTokens: total}, nil
}

func (s *service) CancelReservation(ctx context.Context, req *drpc.CancelReservationRequest) (*drpc.TokenReservation, error) {
	var out drpc.TokenReservation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var res struct {
			ID             string
			TokenAccountID string
			ReservedTokens int64
			Status         string
		}
		if err := tx.Raw(`
			SELECT id::text AS id, token_account_id::text AS token_account_id, reserved_tokens, status
			FROM quota.token_reservations
			WHERE id = ?::uuid
			FOR UPDATE
		`, req.ReservationID).Scan(&res).Error; err != nil {
			return err
		}
		if res.ID == "" {
			return status.Error(codes.NotFound, "reservation not found")
		}
		if res.Status == "reserved" {
			if err := tx.Exec(`UPDATE quota.token_accounts SET used_tokens = used_tokens - ?, updated_at = now() WHERE id = ?::uuid`, res.ReservedTokens, res.TokenAccountID).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE quota.token_reservations SET status = 'cancelled', updated_at = now() WHERE id = ?::uuid`, res.ID).Error; err != nil {
				return err
			}
		}
		out = drpc.TokenReservation{ID: res.ID, TokenAccountID: res.TokenAccountID, ReservedTokens: res.ReservedTokens, Status: "cancelled"}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}
