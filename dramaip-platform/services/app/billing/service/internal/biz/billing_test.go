package biz

import (
	"context"
	"errors"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestConfirmSimulatedPaymentTracksQuotaActivationFailures(t *testing.T) {
	baseResult := data.SimulatedPaymentResult{
		Subscription: data.SubscriptionRow{ID: "subscription-1", PlanCode: "basic", MonthlyTokenQuota: 500_000},
		PeriodStart:  "2026-07-01T00:00:00Z", PeriodEnd: "2026-08-01T00:00:00Z",
	}
	t.Run("quota unavailable marks activation failed without activating", func(t *testing.T) {
		repo := &fakeBillingRepo{result: baseResult, createErr: status.Error(codes.Unavailable, "quota unavailable")}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{Payment: conf.PaymentConfig{SimulatedEnabled: true}})
		if _, err := uc.ConfirmSimulatedPayment(context.Background(), "user-1", "order-1"); status.Code(err) != codes.Unavailable {
			t.Fatalf("ConfirmSimulatedPayment error = %v, want Unavailable", err)
		}
		if repo.activated != 0 || len(repo.failed) != 1 || repo.failed[0] != "subscription-1" {
			t.Fatalf("quota failure calls: activated=%d failed=%v", repo.activated, repo.failed)
		}
	})
	t.Run("activation failure remains compensable", func(t *testing.T) {
		repo := &fakeBillingRepo{result: baseResult, balance: data.TokenBalanceRow{Plan: "basic", QuotaTokens: 500_000}, activateErr: errors.New("billing database unavailable")}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{Payment: conf.PaymentConfig{SimulatedEnabled: true}})
		if _, err := uc.ConfirmSimulatedPayment(context.Background(), "user-1", "order-1"); err == nil {
			t.Fatal("ConfirmSimulatedPayment activation failure unexpectedly succeeded")
		}
		if repo.activated != 1 || len(repo.failed) != 1 || repo.failed[0] != "subscription-1" {
			t.Fatalf("activation failure calls: activated=%d failed=%v", repo.activated, repo.failed)
		}
	})
	t.Run("quota then activation makes the returned subscription usable", func(t *testing.T) {
		repo := &fakeBillingRepo{result: baseResult, balance: data.TokenBalanceRow{Plan: "basic", QuotaTokens: 500_000, RemainingTokens: 500_000}}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{Payment: conf.PaymentConfig{SimulatedEnabled: true}})
		result, err := uc.ConfirmSimulatedPayment(context.Background(), "user-1", "order-1")
		if err != nil {
			t.Fatalf("ConfirmSimulatedPayment: %v", err)
		}
		if repo.activated != 1 || len(repo.failed) != 0 || result.Subscription.Status != "active" || result.TokenBalance.RemainingTokens != 500_000 {
			t.Fatalf("success result=%#v activated=%d failed=%v", result, repo.activated, repo.failed)
		}
	})
}

type fakeBillingRepo struct {
	BillingRepository
	result      data.SimulatedPaymentResult
	balance     data.TokenBalanceRow
	createErr   error
	activateErr error
	activated   int
	failed      []string
}

func (r *fakeBillingRepo) ConfirmSimulatedPayment(context.Context, string, string) (data.SimulatedPaymentResult, error) {
	return r.result, nil
}

func (r *fakeBillingRepo) CreatePeriodAccount(context.Context, string, string, data.PlanSnapshot, string, string) (data.TokenBalanceRow, error) {
	return r.balance, r.createErr
}

func (r *fakeBillingRepo) ActivateSubscription(context.Context, string) error {
	r.activated++
	return r.activateErr
}

func (r *fakeBillingRepo) MarkSubscriptionActivationFailed(_ context.Context, subscriptionID string, _ string) error {
	r.failed = append(r.failed, subscriptionID)
	return nil
}
