package biz

import (
	"context"
	"errors"
	"testing"

	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
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

func TestSubscriptionLifecycleRetriesOnlyIdempotentQuotaEffects(t *testing.T) {
	baseSub := data.SubscriptionRow{ID: "subscription-1", UserID: "user-1", PlanCode: "basic", Status: "active"}
	t.Run("upgrade applies one ledger adjustment before billing finalization", func(t *testing.T) {
		repo := &fakeBillingRepo{
			planChange: data.PlanChangeResult{Subscription: baseSub, ChangeID: "change-1", Kind: "upgrade", Status: "quota_pending", DeltaTokens: 1_500_000},
			finalPlan:  data.SubscriptionRow{ID: baseSub.ID, UserID: baseSub.UserID, PlanCode: "pro", Status: "active"},
		}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{})
		sub, err := uc.ChangeSubscriptionPlan(context.Background(), "user-1", "subscription-1", "pro", "upgrade-key")
		if err != nil {
			t.Fatalf("ChangeSubscriptionPlan: %v", err)
		}
		if repo.adjusted != 1 || repo.finalized != 1 || sub.PlanCode != "pro" {
			t.Fatalf("upgrade calls adjusted=%d finalized=%d sub=%#v", repo.adjusted, repo.finalized, sub)
		}
	})
	t.Run("quota failure leaves the same change compensable", func(t *testing.T) {
		repo := &fakeBillingRepo{
			planChange: data.PlanChangeResult{Subscription: baseSub, ChangeID: "change-1", Kind: "upgrade", Status: "quota_pending", DeltaTokens: 1},
			adjustErr:  status.Error(codes.Unavailable, "quota unavailable"),
		}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{})
		if _, err := uc.ChangeSubscriptionPlan(context.Background(), "user-1", "subscription-1", "pro", "upgrade-key"); status.Code(err) != codes.Unavailable {
			t.Fatalf("ChangeSubscriptionPlan error = %v, want Unavailable", err)
		}
		if repo.adjusted != 1 || repo.finalized != 0 || len(repo.planRetries) != 1 {
			t.Fatalf("failed upgrade calls adjusted=%d finalized=%d retries=%v", repo.adjusted, repo.finalized, repo.planRetries)
		}
	})
	t.Run("scheduled downgrade does not rewrite the current quota account", func(t *testing.T) {
		repo := &fakeBillingRepo{planChange: data.PlanChangeResult{Subscription: baseSub, ChangeID: "change-2", Kind: "downgrade", Status: "scheduled"}}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{})
		if _, err := uc.ChangeSubscriptionPlan(context.Background(), "user-1", "subscription-1", "free", "downgrade-key"); err != nil {
			t.Fatalf("ChangeSubscriptionPlan: %v", err)
		}
		if repo.adjusted != 0 || repo.finalized != 0 {
			t.Fatalf("downgrade unexpectedly adjusted=%d finalized=%d", repo.adjusted, repo.finalized)
		}
	})
	t.Run("unused simulated quota can be held and refunded exactly once", func(t *testing.T) {
		repo := &fakeBillingRepo{
			refund:      data.RefundRow{ID: "refund-1", SubscriptionID: "subscription-1", Status: "quota_pending", Reason: "user_requested"},
			refundPrep:  &quotav1.RefundPreparation{RefundId: "refund-1", Status: "held"},
			finalRefund: data.RefundRow{ID: "refund-1", Status: "refunded", QuotaHoldStatus: "held"},
		}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{})
		refund, err := uc.RequestRefund(context.Background(), "user-1", "subscription-1", "user_requested", "refund-key")
		if err != nil {
			t.Fatalf("RequestRefund: %v", err)
		}
		if repo.refundPrepared != 1 || repo.refundFinalized != 1 || refund.Status != "refunded" {
			t.Fatalf("refund calls prepared=%d finalized=%d refund=%#v", repo.refundPrepared, repo.refundFinalized, refund)
		}
	})
	t.Run("manual review never invents a provider refund", func(t *testing.T) {
		repo := &fakeBillingRepo{refund: data.RefundRow{ID: "refund-2", SubscriptionID: "subscription-1", Status: "manual_review", UsedTokens: 12}}
		uc := NewBillingUsecase(repo, &conf.Bootstrap{})
		refund, err := uc.RequestRefund(context.Background(), "user-1", "subscription-1", "user_requested", "refund-key")
		if err != nil {
			t.Fatalf("RequestRefund: %v", err)
		}
		if repo.refundPrepared != 0 || repo.refundFinalized != 0 || refund.Status != "manual_review" {
			t.Fatalf("manual refund calls prepared=%d finalized=%d refund=%#v", repo.refundPrepared, repo.refundFinalized, refund)
		}
	})
}

type fakeBillingRepo struct {
	BillingRepository
	result          data.SimulatedPaymentResult
	balance         data.TokenBalanceRow
	createErr       error
	activateErr     error
	activated       int
	failed          []string
	planChange      data.PlanChangeResult
	adjustErr       error
	adjusted        int
	finalPlan       data.SubscriptionRow
	finalized       int
	planRetries     []string
	refund          data.RefundRow
	refundPrep      *quotav1.RefundPreparation
	refundErr       error
	finalRefund     data.RefundRow
	refundPrepared  int
	refundFinalized int
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

func (r *fakeBillingRepo) ChangeSubscriptionPlan(context.Context, string, string, string, string) (data.PlanChangeResult, error) {
	return r.planChange, nil
}

func (r *fakeBillingRepo) ApplyQuotaAdjustment(context.Context, data.PlanChangeResult) error {
	r.adjusted++
	return r.adjustErr
}

func (r *fakeBillingRepo) FinalizePlanChange(context.Context, string) (data.SubscriptionRow, error) {
	r.finalized++
	return r.finalPlan, nil
}

func (r *fakeBillingRepo) MarkPlanChangeRetry(_ context.Context, changeID string, _ string) error {
	r.planRetries = append(r.planRetries, changeID)
	return nil
}

func (r *fakeBillingRepo) RequestRefund(context.Context, string, string, string, string) (data.RefundRow, error) {
	return r.refund, nil
}

func (r *fakeBillingRepo) PrepareRefundQuota(context.Context, data.RefundRow, string) (*quotav1.RefundPreparation, error) {
	r.refundPrepared++
	return r.refundPrep, r.refundErr
}

func (r *fakeBillingRepo) FinalizeRefund(context.Context, string, *quotav1.RefundPreparation) (data.RefundRow, error) {
	r.refundFinalized++
	return r.finalRefund, nil
}

func (r *fakeBillingRepo) MarkRefundRetry(context.Context, string, string) error { return nil }
