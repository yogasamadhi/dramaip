package biz

import (
	"context"
	"strconv"

	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type BillingUsecase struct {
	repo             BillingRepository
	simulatedEnabled bool
}

type BillingRepository interface {
	Checks() map[string]func(context.Context) error
	ListPlans(context.Context) ([]data.PlanRow, error)
	GetSubscription(context.Context, string) (data.SubscriptionRow, error)
	CreateCheckout(context.Context, string, string, string) (data.CheckoutResult, error)
	ConfirmSimulatedPayment(context.Context, string, string) (data.SimulatedPaymentResult, error)
	CreatePeriodAccount(context.Context, string, string, data.PlanSnapshot, string, string) (data.TokenBalanceRow, error)
	ActivateSubscription(context.Context, string) error
	MarkSubscriptionActivationFailed(context.Context, string, string) error
	ListOrders(context.Context, string) ([]data.OrderRow, error)
	GetOrder(context.Context, string, string) (data.OrderRow, error)
	CancelSubscription(context.Context, string, string, bool) (data.SubscriptionRow, error)
}

func NewBillingUsecase(repo BillingRepository, cfg *conf.Bootstrap) *BillingUsecase {
	return &BillingUsecase{repo: repo, simulatedEnabled: cfg.Payment.SimulatedEnabled}
}

func (u *BillingUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *BillingUsecase) ListPlans(ctx context.Context) ([]data.PlanRow, error) {
	return u.repo.ListPlans(ctx)
}

func (u *BillingUsecase) GetSubscription(ctx context.Context, userID string) (data.SubscriptionRow, error) {
	return u.repo.GetSubscription(ctx, userID)
}

func (u *BillingUsecase) CreateCheckout(ctx context.Context, userID string, planID string, provider string) (data.CheckoutResult, error) {
	if provider == "" {
		provider = "simulated"
	}
	return u.repo.CreateCheckout(ctx, userID, planID, provider)
}

func (u *BillingUsecase) ConfirmSandboxPayment(ctx context.Context, userID string, checkoutID string) (data.SandboxPaymentResult, error) {
	return u.ConfirmSimulatedPayment(ctx, userID, checkoutID)
}

func (u *BillingUsecase) ConfirmSimulatedPayment(ctx context.Context, userID string, checkoutID string) (data.SimulatedPaymentResult, error) {
	if !u.simulatedEnabled {
		return data.SandboxPaymentResult{}, status.Error(codes.PermissionDenied, "simulated payment is disabled")
	}
	result, err := u.repo.ConfirmSimulatedPayment(ctx, userID, checkoutID)
	if err != nil {
		return data.SandboxPaymentResult{}, err
	}
	balance, err := u.repo.CreatePeriodAccount(ctx, userID, result.Subscription.ID, result.Subscription.PlanSnapshot(), result.PeriodStart, result.PeriodEnd)
	if err != nil {
		_ = u.repo.MarkSubscriptionActivationFailed(ctx, result.Subscription.ID, err.Error())
		return data.SandboxPaymentResult{}, err
	}
	if err := u.repo.ActivateSubscription(ctx, result.Subscription.ID); err != nil {
		_ = u.repo.MarkSubscriptionActivationFailed(ctx, result.Subscription.ID, err.Error())
		return data.SandboxPaymentResult{}, err
	}
	result.Subscription.Status = "active"
	if balance.Plan == "" {
		balance.Plan = result.Subscription.PlanCode
	}
	result.TokenBalance = balance
	return result, nil
}

func (u *BillingUsecase) ListOrders(ctx context.Context, userID string) ([]data.OrderRow, error) {
	return u.repo.ListOrders(ctx, userID)
}

func (u *BillingUsecase) GetOrder(ctx context.Context, userID string, orderID string) (data.OrderRow, error) {
	return u.repo.GetOrder(ctx, userID, orderID)
}

func (u *BillingUsecase) CancelSubscription(ctx context.Context, userID string, subscriptionID string, immediate bool) (data.SubscriptionRow, error) {
	if subscriptionID == "" {
		sub, err := u.repo.GetSubscription(ctx, userID)
		if err != nil {
			return data.SubscriptionRow{}, err
		}
		subscriptionID = sub.ID
	}
	return u.repo.CancelSubscription(ctx, userID, subscriptionID, immediate)
}

func PriceCNY(price float64) int64 {
	value, _ := strconv.ParseInt(strconv.FormatFloat(price, 'f', 0, 64), 10, 64)
	return value
}
