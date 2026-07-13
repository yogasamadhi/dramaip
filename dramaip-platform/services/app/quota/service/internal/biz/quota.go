package biz

import (
	"context"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type QuotaUsecase struct{ repo *data.QuotaRepo }

func NewQuotaUsecase(repo *data.QuotaRepo) *QuotaUsecase { return &QuotaUsecase{repo: repo} }

func (u *QuotaUsecase) Checks() map[string]func(context.Context) error { return u.repo.Checks() }

func (u *QuotaUsecase) GetTokenBalance(ctx context.Context, userID string) (data.TokenBalance, error) {
	return u.repo.GetTokenBalance(ctx, userID)
}

func (u *QuotaUsecase) CreatePeriodAccount(ctx context.Context, input data.CreatePeriodAccountInput) (data.TokenAccount, error) {
	if input.UserID == "" || input.SubscriptionID == "" {
		return data.TokenAccount{}, status.Error(codes.InvalidArgument, "missing user or subscription id")
	}
	if input.PlanSnapshotSource == "" {
		input = legacyCompatibleSnapshot(input)
	}
	if input.PlanCode == "" || input.PlanName == "" || input.BillingPeriod == "" || input.PlanPrice == "" || input.Currency == "" || input.ModelLevel == "" {
		return data.TokenAccount{}, status.Error(codes.InvalidArgument, "missing plan snapshot")
	}
	if input.QuotaTokens <= 0 {
		return data.TokenAccount{}, status.Error(codes.InvalidArgument, "quota tokens must be positive")
	}
	if input.MaxRPM <= 0 || input.MaxContextTokens <= 0 || input.PeriodStart == "" || input.PeriodEnd == "" || input.PlanSnapshotAt == "" {
		return data.TokenAccount{}, status.Error(codes.InvalidArgument, "missing quota period")
	}
	return u.repo.CreatePeriodAccount(ctx, input)
}

func legacyCompatibleSnapshot(input data.CreatePeriodAccountInput) data.CreatePeriodAccountInput {
	input.PlanName = "Legacy plan"
	input.BillingPeriod = "monthly"
	input.PlanPrice = "0"
	input.Currency = "CNY"
	input.MaxRPM = 1
	input.MaxContextTokens = 1
	input.ModelLevel = "legacy"
	input.PlanSnapshotSource = "legacy_compat"
	input.PlanSnapshotAt = time.Now().UTC().Format(time.RFC3339Nano)
	return input
}

func (u *QuotaUsecase) ReserveTokens(ctx context.Context, userID string, requestID string, reservedTokens int64) (data.TokenReservation, error) {
	if userID == "" || requestID == "" {
		return data.TokenReservation{}, status.Error(codes.InvalidArgument, "missing user or request id")
	}
	if reservedTokens <= 0 {
		reservedTokens = 1
	}
	return u.repo.ReserveTokens(ctx, userID, requestID, reservedTokens)
}

func (u *QuotaUsecase) SettleTokens(ctx context.Context, input data.SettleTokensInput) (data.TokenUsage, error) {
	if input.ReservationID == "" || input.RequestID == "" {
		return data.TokenUsage{}, status.Error(codes.InvalidArgument, "missing reservation or request id")
	}
	return u.repo.SettleTokens(ctx, input)
}

func (u *QuotaUsecase) CancelReservation(ctx context.Context, reservationID string) (data.TokenReservation, error) {
	return u.repo.CancelReservation(ctx, reservationID)
}

func (u *QuotaUsecase) ListTokenUsage(ctx context.Context, userID string, limit int32) ([]data.TokenUsage, error) {
	if userID == "" {
		return nil, status.Error(codes.InvalidArgument, "missing user id")
	}
	return u.repo.ListTokenUsage(ctx, userID, limit)
}

func (u *QuotaUsecase) GetUsageTrend(ctx context.Context, userID string, days int32) ([]data.UsageTrendPoint, error) {
	if userID == "" {
		return nil, status.Error(codes.InvalidArgument, "missing user id")
	}
	return u.repo.GetUsageTrend(ctx, userID, days)
}
