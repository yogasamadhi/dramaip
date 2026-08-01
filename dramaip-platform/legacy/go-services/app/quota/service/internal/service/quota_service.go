package service

import (
	"context"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type QuotaService struct {
	quotav1.UnimplementedQuotaServiceServer
	uc *biz.QuotaUsecase
}

func NewQuotaService(uc *biz.QuotaUsecase) *QuotaService { return &QuotaService{uc: uc} }

func (s *QuotaService) GetTokenBalance(ctx context.Context, req *quotav1.GetTokenBalanceRequest) (*quotav1.TokenBalance, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	balance, err := s.uc.GetTokenBalance(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	return tokenBalanceReply(balance), nil
}

func (s *QuotaService) CreatePeriodAccount(ctx context.Context, req *quotav1.CreatePeriodAccountRequest) (*quotav1.TokenAccount, error) {
	account, err := s.uc.CreatePeriodAccount(ctx, data.CreatePeriodAccountInput{
		UserID: req.UserId, SubscriptionID: req.SubscriptionId, PlanCode: req.PlanCode, PlanName: req.PlanName,
		BillingPeriod: req.BillingPeriod, PlanPrice: req.PlanPrice, Currency: req.Currency,
		QuotaTokens: req.QuotaTokens, MaxRPM: req.MaxRpm, MaxContextTokens: req.MaxContextTokens,
		ModelLevel: req.ModelLevel, PlanSnapshotSource: req.PlanSnapshotSource, PlanSnapshotAt: req.PlanSnapshotAt,
		PeriodStart: req.PeriodStart, PeriodEnd: req.PeriodEnd,
	})
	if err != nil {
		return nil, err
	}
	return &quotav1.TokenAccount{
		Id: account.ID, UserId: account.UserID, SubscriptionId: account.SubscriptionID,
		QuotaTokens: account.QuotaTokens, UsedTokens: account.UsedTokens, PlanCode: account.PlanCode,
		Status: account.Status, PeriodStart: account.PeriodStart, PeriodEnd: account.PeriodEnd,
	}, nil
}

func (s *QuotaService) GetPeriodAccount(ctx context.Context, req *quotav1.GetPeriodAccountRequest) (*quotav1.PeriodAccountReply, error) {
	if err := platform.RequireInternalPeer(ctx, "billing-job"); err != nil {
		return nil, err
	}
	account, found, err := s.uc.GetPeriodAccount(ctx, req.SubscriptionId, req.PeriodStart)
	if err != nil {
		return nil, err
	}
	if !found {
		return &quotav1.PeriodAccountReply{Found: false}, nil
	}
	return &quotav1.PeriodAccountReply{Found: true, Account: &quotav1.TokenAccount{
		Id: account.ID, UserId: account.UserID, SubscriptionId: account.SubscriptionID,
		QuotaTokens: account.QuotaTokens, UsedTokens: account.UsedTokens, PlanCode: account.PlanCode,
		Status: account.Status, PeriodStart: account.PeriodStart, PeriodEnd: account.PeriodEnd,
	}}, nil
}

func (s *QuotaService) ReserveTokens(ctx context.Context, req *quotav1.ReserveTokensRequest) (*quotav1.TokenReservation, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	res, err := s.uc.ReserveTokens(ctx, req.UserId, req.RequestId, req.ReservedTokens)
	if err != nil {
		outcome := "error"
		if status.Code(err) == codes.ResourceExhausted {
			outcome = "rejected"
		}
		platform.RecordQuotaReservation(outcome)
		return nil, err
	}
	platform.RecordQuotaReservation("succeeded")
	return reservationReply(res), nil
}

func (s *QuotaService) SettleTokens(ctx context.Context, req *quotav1.SettleTokensRequest) (*quotav1.TokenUsage, error) {
	usage, err := s.uc.SettleTokens(ctx, data.SettleTokensInput{
		ReservationID: req.ReservationId, RequestID: req.RequestId, Model: req.Model,
		PromptTokens: req.PromptTokens, CompletionTokens: req.CompletionTokens, UsageKnown: req.UsageKnown,
	})
	if err != nil {
		if usage.ID == "" {
			return nil, err
		}
		return tokenUsageReply(usage), err
	}
	return tokenUsageReply(usage), nil
}

func (s *QuotaService) CancelReservation(ctx context.Context, req *quotav1.CancelReservationRequest) (*quotav1.TokenReservation, error) {
	res, err := s.uc.CancelReservation(ctx, req.ReservationId)
	if err != nil {
		return nil, err
	}
	return reservationReply(res), nil
}

func (s *QuotaService) AdjustPeriodQuota(ctx context.Context, req *quotav1.AdjustPeriodQuotaRequest) (*quotav1.QuotaAdjustment, error) {
	adjustment, err := s.uc.AdjustPeriodQuota(ctx, req.AdjustmentId, req.UserId, req.SubscriptionId, req.DeltaTokens, req.Reason)
	if err != nil {
		return nil, err
	}
	return &quotav1.QuotaAdjustment{
		AdjustmentId: adjustment.AdjustmentID, TokenAccountId: adjustment.TokenAccountID,
		DeltaTokens: adjustment.DeltaTokens, QuotaBefore: adjustment.QuotaBefore,
		QuotaAfter: adjustment.QuotaAfter, Status: adjustment.Status,
	}, nil
}

func (s *QuotaService) PrepareRefund(ctx context.Context, req *quotav1.PrepareRefundRequest) (*quotav1.RefundPreparation, error) {
	prep, err := s.uc.PrepareRefund(ctx, req.RefundId, req.UserId, req.SubscriptionId, req.Reason)
	if err != nil {
		return nil, err
	}
	return &quotav1.RefundPreparation{
		RefundId: prep.RefundID, TokenAccountId: prep.TokenAccountID, Status: prep.Status,
		UsedTokens: prep.UsedTokens, Reason: prep.Reason,
	}, nil
}

func (s *QuotaService) ListTokenUsage(ctx context.Context, req *quotav1.ListTokenUsageRequest) (*quotav1.ListTokenUsageReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListTokenUsage(ctx, req.UserId, req.Limit)
	if err != nil {
		return nil, err
	}
	usage := make([]*quotav1.TokenUsage, 0, len(rows))
	for _, row := range rows {
		usage = append(usage, tokenUsageReply(row))
	}
	return &quotav1.ListTokenUsageReply{Usage: usage}, nil
}

func (s *QuotaService) GetUsageTrend(ctx context.Context, req *quotav1.GetUsageTrendRequest) (*quotav1.GetUsageTrendReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.GetUsageTrend(ctx, req.UserId, req.Days)
	if err != nil {
		return nil, err
	}
	points := make([]*quotav1.UsageTrendPoint, 0, len(rows))
	for _, row := range rows {
		points = append(points, &quotav1.UsageTrendPoint{Date: row.Date, TotalTokens: row.TotalTokens})
	}
	return &quotav1.GetUsageTrendReply{Points: points}, nil
}

func tokenBalanceReply(balance data.TokenBalance) *quotav1.TokenBalance {
	return &quotav1.TokenBalance{
		Plan: balance.Plan, QuotaTokens: balance.QuotaTokens, UsedTokens: balance.UsedTokens,
		RemainingTokens: balance.RemainingTokens, PeriodStart: balance.PeriodStart, PeriodEnd: balance.PeriodEnd,
	}
}

func reservationReply(res data.TokenReservation) *quotav1.TokenReservation {
	return &quotav1.TokenReservation{
		Id: res.ID, TokenAccountId: res.TokenAccountID, ReservedTokens: res.ReservedTokens,
		Status: res.Status, SubscriptionId: res.SubscriptionID, CurrentUsed: res.CurrentUsed, CurrentQuota: res.CurrentQuota,
		ExpiresAt: res.ExpiresAt,
	}
}

func tokenUsageReply(usage data.TokenUsage) *quotav1.TokenUsage {
	return &quotav1.TokenUsage{
		Id: usage.ID, RequestId: usage.RequestID, Model: usage.Model,
		PromptTokens: usage.PromptTokens, CompletionTokens: usage.CompletionTokens,
		TotalTokens: usage.TotalTokens, Status: usage.Status, CreatedAt: usage.CreatedAt,
	}
}
