package biz

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type DomainClient interface {
	SetUserStatus(context.Context, *authv1.SetUserStatusRequest, ...grpc.CallOption) (*authv1.SetUserStatusReply, error)
	SetProfileStatus(context.Context, *userv1.SetProfileStatusRequest, ...grpc.CallOption) (*userv1.UserProfile, error)
	GetProfile(context.Context, *userv1.GetProfileRequest, ...grpc.CallOption) (*userv1.UserProfile, error)
	GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error)
	ListOrders(context.Context, *billingv1.ListOrdersRequest, ...grpc.CallOption) (*billingv1.ListOrdersReply, error)
	RequestRefund(context.Context, *billingv1.RequestRefundRequest, ...grpc.CallOption) (*billingv1.Refund, error)
	ResumeSubscription(context.Context, *billingv1.ResumeSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error)
	GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error)
	ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error)
	AdjustPeriodQuota(context.Context, *quotav1.AdjustPeriodQuotaRequest, ...grpc.CallOption) (*quotav1.QuotaAdjustment, error)
	ListNotifications(context.Context, *notificationv1.ListNotificationsRequest, ...grpc.CallOption) (*notificationv1.ListNotificationsResponse, error)
	CreateNotification(context.Context, *notificationv1.CreateNotificationRequest, ...grpc.CallOption) (*notificationv1.CreateNotificationResponse, error)
	ListCostAlerts(context.Context, *aiv1.ListCostAlertsRequest, ...grpc.CallOption) (*aiv1.ListCostAlertsReply, error)
}

// DomainClients keeps the interfaces small even though generated gRPC client
// types are large. The production gateway composes their methods below.
type DomainClients struct {
	Auth         authv1.AuthServiceClient
	User         userv1.UserServiceClient
	Billing      billingv1.BillingServiceClient
	Quota        quotav1.QuotaServiceClient
	Notification notificationv1.NotificationServiceClient
	AI           aiv1.AiGatewayServiceClient
}

func NewDomainClients(g *data.DomainGateway) *DomainClients {
	return &DomainClients{Auth: g.Auth, User: g.User, Billing: g.Billing, Quota: g.Quota, Notification: g.Notification, AI: g.AI}
}
func (c *DomainClients) SetUserStatus(ctx context.Context, r *authv1.SetUserStatusRequest, o ...grpc.CallOption) (*authv1.SetUserStatusReply, error) {
	return c.Auth.SetUserStatus(ctx, r, o...)
}
func (c *DomainClients) SetProfileStatus(ctx context.Context, r *userv1.SetProfileStatusRequest, o ...grpc.CallOption) (*userv1.UserProfile, error) {
	return c.User.SetProfileStatus(ctx, r, o...)
}
func (c *DomainClients) GetProfile(ctx context.Context, r *userv1.GetProfileRequest, o ...grpc.CallOption) (*userv1.UserProfile, error) {
	return c.User.GetProfile(ctx, r, o...)
}
func (c *DomainClients) GetSubscription(ctx context.Context, r *billingv1.GetSubscriptionRequest, o ...grpc.CallOption) (*billingv1.Subscription, error) {
	return c.Billing.GetSubscription(ctx, r, o...)
}
func (c *DomainClients) ListOrders(ctx context.Context, r *billingv1.ListOrdersRequest, o ...grpc.CallOption) (*billingv1.ListOrdersReply, error) {
	return c.Billing.ListOrders(ctx, r, o...)
}
func (c *DomainClients) RequestRefund(ctx context.Context, r *billingv1.RequestRefundRequest, o ...grpc.CallOption) (*billingv1.Refund, error) {
	return c.Billing.RequestRefund(ctx, r, o...)
}
func (c *DomainClients) ResumeSubscription(ctx context.Context, r *billingv1.ResumeSubscriptionRequest, o ...grpc.CallOption) (*billingv1.Subscription, error) {
	return c.Billing.ResumeSubscription(ctx, r, o...)
}
func (c *DomainClients) GetTokenBalance(ctx context.Context, r *quotav1.GetTokenBalanceRequest, o ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return c.Quota.GetTokenBalance(ctx, r, o...)
}
func (c *DomainClients) ListTokenUsage(ctx context.Context, r *quotav1.ListTokenUsageRequest, o ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return c.Quota.ListTokenUsage(ctx, r, o...)
}
func (c *DomainClients) AdjustPeriodQuota(ctx context.Context, r *quotav1.AdjustPeriodQuotaRequest, o ...grpc.CallOption) (*quotav1.QuotaAdjustment, error) {
	return c.Quota.AdjustPeriodQuota(ctx, r, o...)
}
func (c *DomainClients) ListNotifications(ctx context.Context, r *notificationv1.ListNotificationsRequest, o ...grpc.CallOption) (*notificationv1.ListNotificationsResponse, error) {
	return c.Notification.ListNotifications(ctx, r, o...)
}
func (c *DomainClients) CreateNotification(ctx context.Context, r *notificationv1.CreateNotificationRequest, o ...grpc.CallOption) (*notificationv1.CreateNotificationResponse, error) {
	return c.Notification.CreateNotification(ctx, r, o...)
}
func (c *DomainClients) ListCostAlerts(ctx context.Context, r *aiv1.ListCostAlertsRequest, o ...grpc.CallOption) (*aiv1.ListCostAlertsReply, error) {
	return c.AI.ListCostAlerts(ctx, r, o...)
}

type CustomerDetail struct {
	Profile       *userv1.UserProfile            `json:"profile"`
	Subscription  *billingv1.Subscription        `json:"subscription"`
	Orders        []*billingv1.Order             `json:"orders"`
	Balance       *quotav1.TokenBalance          `json:"balance"`
	Usage         []*quotav1.TokenUsage          `json:"usage"`
	Notifications []*notificationv1.Notification `json:"notifications"`
}
type OperationsUsecase struct {
	admin  *AdminUsecase
	domain DomainClient
}

func NewOperationsUsecase(admin *AdminUsecase, domain DomainClient) *OperationsUsecase {
	return &OperationsUsecase{admin: admin, domain: domain}
}

func (u *OperationsUsecase) Customer(ctx context.Context, actor Principal, userID string) (*CustomerDetail, error) {
	if !actor.Allows("audit.read") || strings.TrimSpace(userID) == "" {
		if !actor.Allows("audit.read") {
			return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
		}
		return nil, status.Error(codes.InvalidArgument, "user_id_required")
	}
	owned := platform.WithUserIdentity(ctx, userID)
	profile, err := u.domain.GetProfile(owned, &userv1.GetProfileRequest{UserId: userID})
	if err != nil {
		return nil, err
	}
	subscription, err := u.domain.GetSubscription(owned, &billingv1.GetSubscriptionRequest{UserId: userID})
	if err != nil && status.Code(err) != codes.NotFound {
		return nil, err
	}
	orders, err := u.domain.ListOrders(owned, &billingv1.ListOrdersRequest{UserId: userID})
	if err != nil {
		return nil, err
	}
	balance, err := u.domain.GetTokenBalance(owned, &quotav1.GetTokenBalanceRequest{UserId: userID})
	if err != nil {
		return nil, err
	}
	usage, err := u.domain.ListTokenUsage(owned, &quotav1.ListTokenUsageRequest{UserId: userID, Limit: 20})
	if err != nil {
		return nil, err
	}
	notifications, err := u.domain.ListNotifications(owned, &notificationv1.ListNotificationsRequest{UserId: userID, Limit: 20})
	if err != nil {
		return nil, err
	}
	return &CustomerDetail{Profile: profile, Subscription: subscription, Orders: orders.Orders, Balance: balance, Usage: usage.Usage, Notifications: notifications.Notifications}, nil
}

func (u *OperationsUsecase) CostAlerts(ctx context.Context, actor Principal, limit int, userID string) (*aiv1.ListCostAlertsReply, error) {
	if !actor.Allows("audit.read") {
		return nil, status.Error(codes.PermissionDenied, "admin_permission_denied")
	}
	return u.domain.ListCostAlerts(ctx, &aiv1.ListCostAlertsRequest{Limit: int32(limit), UserId: strings.TrimSpace(userID)})
}

func (u *OperationsUsecase) SetCustomerStatus(ctx context.Context, actor Principal, userID, state, confirmationID string) (*userv1.UserProfile, error) {
	confirmation, err := u.admin.PrepareOperation(ctx, actor, "customer.status.set", userID, confirmationID)
	if err != nil {
		return nil, err
	}
	if _, err = u.domain.SetUserStatus(ctx, &authv1.SetUserStatusRequest{UserId: userID, Status: state, OperatorId: actor.ID, Reason: confirmation.Reason, IdempotencyKey: confirmation.ID}); err != nil {
		return nil, err
	}
	profile, err := u.domain.SetProfileStatus(ctx, &userv1.SetProfileStatusRequest{UserId: userID, Status: state, OperatorId: actor.ID, Reason: confirmation.Reason, IdempotencyKey: confirmation.ID})
	if err != nil {
		return nil, err
	}
	if err := u.complete(ctx, actor, "customer.status.set", userID, confirmation.ID, "customer", map[string]string{"status": profile.Status}); err != nil {
		return nil, err
	}
	return profile, nil
}
func (u *OperationsUsecase) RequestRefund(ctx context.Context, actor Principal, userID, subscriptionID, confirmationID string) (*billingv1.Refund, error) {
	confirmation, err := u.admin.PrepareOperation(ctx, actor, "billing.refund.request", subscriptionID, confirmationID)
	if err != nil {
		return nil, err
	}
	result, err := u.domain.RequestRefund(platform.WithUserIdentity(ctx, userID), &billingv1.RequestRefundRequest{UserId: userID, SubscriptionId: subscriptionID, Reason: confirmation.Reason, IdempotencyKey: confirmation.ID})
	if err != nil {
		return nil, err
	}
	if err := u.complete(ctx, actor, "billing.refund.request", subscriptionID, confirmation.ID, "subscription", map[string]string{"refund_id": result.Id, "status": result.Status}); err != nil {
		return nil, err
	}
	return result, nil
}
func (u *OperationsUsecase) ResumeSubscription(ctx context.Context, actor Principal, userID, subscriptionID, confirmationID string) (*billingv1.Subscription, error) {
	confirmation, err := u.admin.PrepareOperation(ctx, actor, "billing.subscription.resume", subscriptionID, confirmationID)
	if err != nil {
		return nil, err
	}
	result, err := u.domain.ResumeSubscription(platform.WithUserIdentity(ctx, userID), &billingv1.ResumeSubscriptionRequest{UserId: userID, SubscriptionId: subscriptionID, IdempotencyKey: confirmation.ID})
	if err != nil {
		return nil, err
	}
	if err := u.complete(ctx, actor, "billing.subscription.resume", subscriptionID, confirmation.ID, "subscription", map[string]string{"status": result.Status}); err != nil {
		return nil, err
	}
	return result, nil
}
func (u *OperationsUsecase) AdjustQuota(ctx context.Context, actor Principal, userID, subscriptionID string, delta int64, confirmationID string) (*quotav1.QuotaAdjustment, error) {
	confirmation, err := u.admin.PrepareOperation(ctx, actor, "quota.adjust", subscriptionID, confirmationID)
	if err != nil {
		return nil, err
	}
	reason := fmt.Sprintf("admin:%s %s", actor.ID, confirmation.Reason)
	result, err := u.domain.AdjustPeriodQuota(platform.WithUserIdentity(ctx, userID), &quotav1.AdjustPeriodQuotaRequest{AdjustmentId: confirmation.ID, UserId: userID, SubscriptionId: subscriptionID, DeltaTokens: delta, Reason: reason})
	if err != nil {
		return nil, err
	}
	if err := u.complete(ctx, actor, "quota.adjust", subscriptionID, confirmation.ID, "quota", map[string]any{"delta_tokens": result.DeltaTokens, "status": result.Status}); err != nil {
		return nil, err
	}
	return result, nil
}
func (u *OperationsUsecase) SendNotification(ctx context.Context, actor Principal, userID, title, body, confirmationID string) (*notificationv1.Notification, error) {
	confirmation, err := u.admin.PrepareOperation(ctx, actor, "notification.send", userID, confirmationID)
	if err != nil {
		return nil, err
	}
	result, err := u.domain.CreateNotification(platform.WithUserIdentity(ctx, userID), &notificationv1.CreateNotificationRequest{UserId: userID, Type: "operator", Title: strings.TrimSpace(title), Body: strings.TrimSpace(body), SourceEventId: "admin:" + confirmation.ID})
	if err != nil {
		return nil, err
	}
	if result.GetNotification() == nil {
		return nil, status.Error(codes.Internal, "notification_create_missing_result")
	}
	if err := u.complete(ctx, actor, "notification.send", userID, confirmation.ID, "notification", map[string]string{"notification_id": result.Notification.Id}); err != nil {
		return nil, err
	}
	return result.Notification, nil
}
func (u *OperationsUsecase) complete(ctx context.Context, actor Principal, action, target, confirmationID, resource string, after any) error {
	payload, err := json.Marshal(after)
	if err != nil {
		return err
	}
	return u.admin.CompleteOperation(ctx, actor, action, target, confirmationID, resource, string(payload))
}
