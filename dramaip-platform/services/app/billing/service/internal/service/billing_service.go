package service

import (
	"context"
	"strconv"

	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type BillingService struct {
	billingv1.UnimplementedBillingServiceServer
	uc *biz.BillingUsecase
}

func NewBillingService(uc *biz.BillingUsecase) *BillingService {
	return &BillingService{uc: uc}
}

func (s *BillingService) ListPlans(ctx context.Context, _ *billingv1.ListPlansRequest) (*billingv1.ListPlansReply, error) {
	rows, err := s.uc.ListPlans(ctx)
	if err != nil {
		return nil, err
	}
	plans := make([]*billingv1.Plan, 0, len(rows))
	for _, row := range rows {
		plans = append(plans, &billingv1.Plan{
			Id: row.Code, Code: row.Code, Name: row.Name, MonthlyTokenQuota: row.MonthlyTokenQuota,
			Price: strconv.FormatFloat(row.Price, 'f', 2, 64), PriceCny: biz.PriceCNY(row.Price),
			Currency: row.Currency, ModelLevel: row.ModelLevel, MaxRpm: row.MaxRPM,
		})
	}
	return &billingv1.ListPlansReply{Plans: plans}, nil
}

func (s *BillingService) CreateCheckout(ctx context.Context, req *billingv1.CreateCheckoutRequest) (*billingv1.CreateCheckoutReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	result, err := s.uc.CreateCheckout(ctx, req.UserId, req.PlanId, req.Provider)
	if err != nil {
		platform.RecordBusinessEvent("payment_checkout", "failed")
		return nil, err
	}
	platform.RecordBusinessEvent("payment_checkout", "succeeded")
	return &billingv1.CreateCheckoutReply{
		OrderId: result.OrderID, PlanId: result.PlanID, Provider: result.Provider,
		Status: result.Status, PaymentUrl: result.PaymentURL,
	}, nil
}

func (s *BillingService) ConfirmSandboxPayment(ctx context.Context, req *billingv1.ConfirmSandboxPaymentRequest) (*billingv1.ConfirmSandboxPaymentReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	result, err := s.uc.ConfirmSandboxPayment(ctx, req.UserId, req.CheckoutId)
	if err != nil {
		platform.RecordBusinessEvent("payment_confirmation", "failed")
		return nil, err
	}
	platform.RecordBusinessEvent("payment_confirmation", "succeeded")
	return &billingv1.ConfirmSandboxPaymentReply{
		OrderId: result.OrderID, Status: result.Status,
		Subscription: subscriptionReply(result.Subscription),
		TokenBalance: tokenBalanceReply(result.TokenBalance),
	}, nil
}

func (s *BillingService) ConfirmSimulatedPayment(ctx context.Context, req *billingv1.ConfirmSimulatedPaymentRequest) (*billingv1.ConfirmSimulatedPaymentReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	result, err := s.uc.ConfirmSimulatedPayment(ctx, req.UserId, req.CheckoutId)
	if err != nil {
		platform.RecordBusinessEvent("payment_confirmation", "failed")
		return nil, err
	}
	platform.RecordBusinessEvent("payment_confirmation", "succeeded")
	return &billingv1.ConfirmSimulatedPaymentReply{
		OrderId: result.OrderID, Status: result.Status,
		Subscription: subscriptionReply(result.Subscription),
		TokenBalance: tokenBalanceReply(result.TokenBalance),
	}, nil
}

func (s *BillingService) GetSubscription(ctx context.Context, req *billingv1.GetSubscriptionRequest) (*billingv1.Subscription, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	sub, err := s.uc.GetSubscription(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	return subscriptionReply(sub), nil
}

func (s *BillingService) ListOrders(ctx context.Context, req *billingv1.ListOrdersRequest) (*billingv1.ListOrdersReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	rows, err := s.uc.ListOrders(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	orders := make([]*billingv1.Order, 0, len(rows))
	for _, row := range rows {
		orders = append(orders, orderReply(row))
	}
	return &billingv1.ListOrdersReply{Orders: orders}, nil
}

func (s *BillingService) GetOrder(ctx context.Context, req *billingv1.GetOrderRequest) (*billingv1.Order, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	row, err := s.uc.GetOrder(ctx, req.UserId, req.OrderId)
	if err != nil {
		return nil, err
	}
	return orderReply(row), nil
}

func (s *BillingService) CancelSubscription(ctx context.Context, req *billingv1.CancelSubscriptionRequest) (*billingv1.Subscription, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	sub, err := s.uc.CancelSubscription(ctx, req.UserId, req.SubscriptionId, req.Immediate)
	if err != nil {
		return nil, err
	}
	return subscriptionReply(sub), nil
}

func (s *BillingService) ResumeSubscription(ctx context.Context, req *billingv1.ResumeSubscriptionRequest) (*billingv1.Subscription, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	sub, err := s.uc.ResumeSubscription(ctx, req.UserId, req.SubscriptionId, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return subscriptionReply(sub), nil
}

func (s *BillingService) ChangeSubscriptionPlan(ctx context.Context, req *billingv1.ChangeSubscriptionPlanRequest) (*billingv1.Subscription, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	sub, err := s.uc.ChangeSubscriptionPlan(ctx, req.UserId, req.SubscriptionId, req.PlanId, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return subscriptionReply(sub), nil
}

func (s *BillingService) RequestRefund(ctx context.Context, req *billingv1.RequestRefundRequest) (*billingv1.Refund, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	refund, err := s.uc.RequestRefund(ctx, req.UserId, req.SubscriptionId, req.Reason, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return refundReply(refund), nil
}

func subscriptionReply(sub data.SubscriptionRow) *billingv1.Subscription {
	return &billingv1.Subscription{
		Id: sub.ID, UserId: sub.UserID, PlanId: sub.PlanID, PlanCode: sub.PlanCode, Status: sub.Status,
		CurrentPeriodStart: sub.CurrentPeriodStart, CurrentPeriodEnd: sub.CurrentPeriodEnd,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd, CanceledAt: sub.CanceledAt,
		ScheduledPlanCode: sub.ScheduledPlanCode, ScheduledChangeAt: sub.ScheduledChangeAt,
		LifecycleError: sub.LifecycleError,
	}
}

func refundReply(refund data.RefundRow) *billingv1.Refund {
	return &billingv1.Refund{
		Id: refund.ID, SubscriptionId: refund.SubscriptionID, Status: refund.Status, Reason: refund.Reason,
		UsedTokens: refund.UsedTokens, QuotaHoldStatus: refund.QuotaHoldStatus,
		FailureReason: refund.FailureReason, CreatedAt: refund.CreatedAt, ResolvedAt: refund.ResolvedAt,
	}
}

func orderReply(order data.OrderRow) *billingv1.Order {
	return &billingv1.Order{
		Id: order.ID, UserId: order.UserID, PlanId: order.PlanID, PlanCode: order.PlanCode,
		Provider: order.Provider, Status: order.Status, Amount: order.Amount, Currency: order.Currency,
		PaymentUrl: order.PaymentURL, CreatedAt: order.CreatedAt, PaidAt: order.PaidAt,
		SubscriptionId: order.SubscriptionID,
	}
}

func tokenBalanceReply(balance data.TokenBalanceRow) *billingv1.TokenBalance {
	return &billingv1.TokenBalance{
		Plan: balance.Plan, QuotaTokens: balance.QuotaTokens, UsedTokens: balance.UsedTokens,
		RemainingTokens: balance.RemainingTokens, PeriodStart: balance.PeriodStart, PeriodEnd: balance.PeriodEnd,
	}
}
