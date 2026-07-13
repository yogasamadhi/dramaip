package biz

import (
	"context"
	"strings"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type BFFUsecase struct {
	data *data.Data
}

func NewBFFUsecase(data *data.Data) *BFFUsecase {
	return &BFFUsecase{data: data}
}

func (u *BFFUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *BFFUsecase) Login(ctx context.Context, email string, password string, deviceID string) (*authv1.AuthReply, error) {
	return u.data.Auth.Login(ctx, &authv1.LoginRequest{Email: email, Password: password, DeviceId: deviceID})
}

func (u *BFFUsecase) Register(ctx context.Context, email string, password string, displayName string, deviceID string) (*authv1.AuthReply, error) {
	session, err := u.data.Auth.Register(ctx, &authv1.RegisterRequest{Email: email, Password: password, DisplayName: displayName, DeviceId: deviceID})
	if err != nil {
		return nil, err
	}
	_, err = u.data.User.EnsureProfile(ctx, &userv1.EnsureProfileRequest{
		UserId: session.UserId, Email: session.Email, DisplayName: displayName, Status: "active",
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (u *BFFUsecase) Refresh(ctx context.Context, refreshToken string) (*authv1.AuthReply, error) {
	if refreshToken == "" {
		return nil, status.Error(codes.InvalidArgument, "missing_refresh_token")
	}
	return u.data.Auth.Refresh(ctx, &authv1.RefreshRequest{RefreshToken: refreshToken})
}

func (u *BFFUsecase) Logout(ctx context.Context, refreshToken string, accessToken string, deviceID string) (*authv1.LogoutReply, error) {
	return u.data.Auth.Logout(ctx, &authv1.LogoutRequest{RefreshToken: refreshToken, AccessToken: accessToken, DeviceId: deviceID})
}

func (u *BFFUsecase) Plans(ctx context.Context) (*billingv1.ListPlansReply, error) {
	return u.data.Billing.ListPlans(ctx, &billingv1.ListPlansRequest{})
}

func (u *BFFUsecase) Dashboard(ctx context.Context, userID string) (*userv1.UserProfile, *billingv1.Subscription, *quotav1.TokenBalance, error) {
	profile, err := u.data.User.GetProfile(ctx, &userv1.GetProfileRequest{UserId: userID})
	if err != nil {
		return nil, nil, nil, err
	}
	sub, err := u.data.Billing.GetSubscription(ctx, &billingv1.GetSubscriptionRequest{UserId: userID})
	if err != nil {
		return nil, nil, nil, err
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: userID})
	if err != nil {
		return nil, nil, nil, err
	}
	return profile, sub, balance, nil
}

func (u *BFFUsecase) TokenBalance(ctx context.Context, userID string) (*quotav1.TokenBalance, error) {
	return u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: userID})
}

func (u *BFFUsecase) Profile(ctx context.Context, userID string) (*userv1.UserProfile, error) {
	return u.data.User.GetProfile(ctx, &userv1.GetProfileRequest{UserId: userID})
}

func (u *BFFUsecase) UpdateProfile(ctx context.Context, userID string, phone string, displayName string, avatarURL string, locale string, timezone string) (*userv1.UserProfile, error) {
	return u.data.User.UpdateProfile(ctx, &userv1.UpdateProfileRequest{
		UserId: userID, Phone: phone, DisplayName: displayName, AvatarUrl: avatarURL, Locale: locale, Timezone: timezone,
	})
}

func (u *BFFUsecase) Subscription(ctx context.Context, userID string) (*billingv1.Subscription, error) {
	return u.data.Billing.GetSubscription(ctx, &billingv1.GetSubscriptionRequest{UserId: userID})
}

func (u *BFFUsecase) Orders(ctx context.Context, userID string) (*billingv1.ListOrdersReply, error) {
	return u.data.Billing.ListOrders(ctx, &billingv1.ListOrdersRequest{UserId: userID})
}

func (u *BFFUsecase) Order(ctx context.Context, userID string, orderID string) (*billingv1.Order, error) {
	return u.data.Billing.GetOrder(ctx, &billingv1.GetOrderRequest{UserId: userID, OrderId: orderID})
}

func (u *BFFUsecase) TokenUsage(ctx context.Context, userID string, limit int32) (*quotav1.ListTokenUsageReply, error) {
	return u.data.Quota.ListTokenUsage(ctx, &quotav1.ListTokenUsageRequest{UserId: userID, Limit: limit})
}

func (u *BFFUsecase) UsageTrend(ctx context.Context, userID string, days int32) (*quotav1.GetUsageTrendReply, error) {
	return u.data.Quota.GetUsageTrend(ctx, &quotav1.GetUsageTrendRequest{UserId: userID, Days: days})
}

func (u *BFFUsecase) Notifications(ctx context.Context, userID string, limit int) ([]data.NotificationRow, error) {
	return u.data.ListNotifications(ctx, userID, limit)
}

func (u *BFFUsecase) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (data.NotificationRow, error) {
	if notificationID == "" {
		return data.NotificationRow{}, status.Error(codes.InvalidArgument, "missing_notification_id")
	}
	return u.data.MarkNotificationRead(ctx, userID, notificationID)
}

func (u *BFFUsecase) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) {
	_ = u.data.CreateNotification(ctx, userID, typ, title, body, sourceEventID)
}

func (u *BFFUsecase) AccountReport(ctx context.Context, userID string) (map[string]any, error) {
	sub, _ := u.Subscription(ctx, userID)
	balance, _ := u.TokenBalance(ctx, userID)
	orders, _ := u.Orders(ctx, userID)
	usage, _ := u.TokenUsage(ctx, userID, 100)
	trend, _ := u.UsageTrend(ctx, userID, 30)
	notifications, _ := u.Notifications(ctx, userID, 100)
	var paidOrders, pendingOrders int
	for _, order := range orders.GetOrders() {
		switch order.Status {
		case "paid":
			paidOrders++
		case "pending":
			pendingOrders++
		}
	}
	var totalTokens int64
	for _, item := range usage.GetUsage() {
		totalTokens += item.TotalTokens
	}
	var unread int
	for _, item := range notifications {
		if item.ReadAt == "" {
			unread++
		}
	}
	report := map[string]any{
		"generated_at":         time.Now().UTC().Format(time.RFC3339),
		"subscription":         sub,
		"token_balance":        balance,
		"order_summary":        map[string]any{"paid": paidOrders, "pending": pendingOrders, "total": len(orders.GetOrders())},
		"usage_summary":        map[string]any{"total_tokens": totalTokens, "requests": len(usage.GetUsage())},
		"usage_trend":          trend.GetPoints(),
		"notification_summary": map[string]any{"unread": unread, "total": len(notifications)},
	}
	return report, nil
}

func (u *BFFUsecase) Checkout(ctx context.Context, userID string, planID string, provider string) (*billingv1.CreateCheckoutReply, error) {
	if planID == "" {
		return nil, status.Error(codes.InvalidArgument, "missing_plan_id")
	}
	return u.data.Billing.CreateCheckout(ctx, &billingv1.CreateCheckoutRequest{UserId: userID, PlanId: planID, Provider: provider})
}

func (u *BFFUsecase) SandboxConfirmPayment(ctx context.Context, userID string, checkoutID string) (*billingv1.ConfirmSandboxPaymentReply, error) {
	result, err := u.SimulatedConfirmPayment(ctx, userID, checkoutID)
	if err != nil {
		return nil, err
	}
	return &billingv1.ConfirmSandboxPaymentReply{
		OrderId: result.OrderId, Status: result.Status, Subscription: result.Subscription, TokenBalance: result.TokenBalance,
	}, nil
}

func (u *BFFUsecase) SimulatedConfirmPayment(ctx context.Context, userID string, checkoutID string) (*billingv1.ConfirmSimulatedPaymentReply, error) {
	if checkoutID == "" {
		return nil, status.Error(codes.InvalidArgument, "missing_checkout_id")
	}
	// payment.succeeded.v1 is written to the billing outbox in the same
	// transaction. notification-job is the sole path that turns it into a
	// payment notification, so a BFF retry cannot double-write the user inbox.
	return u.data.Billing.ConfirmSimulatedPayment(ctx, &billingv1.ConfirmSimulatedPaymentRequest{UserId: userID, CheckoutId: checkoutID})
}

func (u *BFFUsecase) CancelSubscription(ctx context.Context, userID string, subscriptionID string, immediate bool) (*billingv1.Subscription, error) {
	reply, err := u.data.Billing.CancelSubscription(ctx, &billingv1.CancelSubscriptionRequest{UserId: userID, SubscriptionId: subscriptionID, Immediate: immediate})
	if err == nil {
		u.CreateNotification(ctx, userID, "subscription_canceled", "订阅取消已受理", "你的订阅取消请求已记录。", "subscription-cancel:"+reply.Id)
	}
	return reply, err
}

func (u *BFFUsecase) Chat(ctx context.Context, userID string, requestID string, idempotencyKey string, provider string, model string, messages []*aiv1.ChatMessage, maxTokens int64) (*aiv1.ChatReply, error) {
	return u.data.AI.Chat(ctx, &aiv1.ChatRequest{
		UserId: userID, RequestId: requestID, IdempotencyKey: idempotencyKey, Provider: provider,
		Model: model, Messages: messages, MaxTokens: maxTokens,
	})
}

func (u *BFFUsecase) Authenticate(ctx context.Context, authorization string) (*authv1.AuthReply, error) {
	if !strings.HasPrefix(authorization, "Bearer ") {
		return nil, status.Error(codes.Unauthenticated, "missing_bearer_token")
	}
	token := strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	if token == "" {
		return nil, status.Error(codes.Unauthenticated, "missing_bearer_token")
	}
	return u.data.Auth.ValidateAccessToken(ctx, &authv1.ValidateAccessTokenRequest{AccessToken: token})
}
