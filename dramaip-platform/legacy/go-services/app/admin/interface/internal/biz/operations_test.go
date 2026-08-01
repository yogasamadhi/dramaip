package biz

import (
	"context"
	"testing"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingjobv1 "github.com/dramaip/dramaip-platform/services/api/billing/job/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationjobv1 "github.com/dramaip/dramaip-platform/services/api/notification/job/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCustomerStatusUsesSecondConfirmationAndDomainIdempotencyKey(t *testing.T) {
	repo := newFakeRepo(t)
	admin := newTestUsecase(t, repo)
	login, err := admin.Login(context.Background(), "security@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	confirmation, err := admin.CreateConfirmation(context.Background(), login.Principal, "customer.status.set", "dddddddd-dddd-dddd-dddd-dddddddddddd", "account abuse review")
	if err != nil {
		t.Fatal(err)
	}
	domain := &operationFake{}
	operations := NewOperationsUsecase(admin, domain)
	profile, err := operations.SetCustomerStatus(context.Background(), login.Principal, "dddddddd-dddd-dddd-dddd-dddddddddddd", "suspended", confirmation.ID)
	if err != nil || profile.GetStatus() != "suspended" {
		t.Fatalf("status change = %#v, %v", profile, err)
	}
	if domain.authRequest == nil || domain.authRequest.GetIdempotencyKey() != confirmation.ID || domain.authRequest.GetOperatorId() != login.Principal.ID {
		t.Fatalf("auth operation missing durable confirmation binding: %#v", domain.authRequest)
	}
	if domain.profileRequest == nil || domain.profileRequest.GetIdempotencyKey() != confirmation.ID {
		t.Fatalf("profile mirror missing durable confirmation binding: %#v", domain.profileRequest)
	}
	if _, err := admin.PrepareOperation(context.Background(), login.Principal, "customer.status.set", "dddddddd-dddd-dddd-dddd-dddddddddddd", confirmation.ID); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("confirmation was not consumed: %v", err)
	}
}

func TestViewerCannotPrepareCustomerOperation(t *testing.T) {
	admin := newTestUsecase(t, newFakeRepo(t))
	login, err := admin.Login(context.Background(), "viewer@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.CreateConfirmation(context.Background(), login.Principal, "customer.status.set", "dddddddd-dddd-dddd-dddd-dddddddddddd", "attempt suspend"); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("viewer confirmation = %v", err)
	}
}

func TestJobOperationsBindConfirmationToActorAndIdempotency(t *testing.T) {
	admin := newTestUsecase(t, newFakeRepo(t))
	login, err := admin.Login(context.Background(), "security@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	domain := &operationFake{}
	operations := NewOperationsUsecase(admin, domain)
	startConfirmation, err := admin.CreateConfirmation(context.Background(), login.Principal, "billing.reconciliation.start", "billing-reconciliation", "daily ledger review")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := operations.StartReconciliation(context.Background(), login.Principal, startConfirmation.ID); err != nil {
		t.Fatalf("StartReconciliation() error = %v", err)
	}
	if domain.startRequest == nil || domain.startRequest.GetActorId() != login.Principal.ID || domain.startRequest.GetIdempotencyKey() != startConfirmation.ID {
		t.Fatalf("start request missing actor/idempotency binding: %#v", domain.startRequest)
	}

	const attemptID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	retryConfirmation, err := admin.CreateConfirmation(context.Background(), login.Principal, "notification.delivery.retry", attemptID, "retry failed delivery")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := operations.RetryDelivery(context.Background(), login.Principal, attemptID, retryConfirmation.ID); err != nil {
		t.Fatalf("RetryDelivery() error = %v", err)
	}
	if domain.retryRequest == nil || domain.retryRequest.GetActorId() != login.Principal.ID || domain.retryRequest.GetIdempotencyKey() != retryConfirmation.ID {
		t.Fatalf("retry request missing actor/idempotency binding: %#v", domain.retryRequest)
	}
}

type operationFake struct {
	authRequest    *authv1.SetUserStatusRequest
	profileRequest *userv1.SetProfileStatusRequest
	startRequest   *billingjobv1.StartReconciliationRequest
	retryRequest   *notificationjobv1.RetryDeliveryRequest
}

func (f *operationFake) SetUserStatus(_ context.Context, req *authv1.SetUserStatusRequest, _ ...grpc.CallOption) (*authv1.SetUserStatusReply, error) {
	f.authRequest = req
	return &authv1.SetUserStatusReply{UserId: req.UserId, Status: req.Status}, nil
}
func (f *operationFake) SetProfileStatus(_ context.Context, req *userv1.SetProfileStatusRequest, _ ...grpc.CallOption) (*userv1.UserProfile, error) {
	f.profileRequest = req
	return &userv1.UserProfile{Id: req.UserId, Status: req.Status}, nil
}
func (*operationFake) GetProfile(context.Context, *userv1.GetProfileRequest, ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{}, nil
}
func (*operationFake) GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{}, nil
}
func (*operationFake) ListOrders(context.Context, *billingv1.ListOrdersRequest, ...grpc.CallOption) (*billingv1.ListOrdersReply, error) {
	return &billingv1.ListOrdersReply{}, nil
}
func (*operationFake) RequestRefund(context.Context, *billingv1.RequestRefundRequest, ...grpc.CallOption) (*billingv1.Refund, error) {
	return &billingv1.Refund{}, nil
}
func (*operationFake) ResumeSubscription(context.Context, *billingv1.ResumeSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{}, nil
}
func (*operationFake) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{}, nil
}
func (*operationFake) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{}, nil
}
func (*operationFake) AdjustPeriodQuota(context.Context, *quotav1.AdjustPeriodQuotaRequest, ...grpc.CallOption) (*quotav1.QuotaAdjustment, error) {
	return &quotav1.QuotaAdjustment{}, nil
}
func (*operationFake) ListNotifications(context.Context, *notificationv1.ListNotificationsRequest, ...grpc.CallOption) (*notificationv1.ListNotificationsResponse, error) {
	return &notificationv1.ListNotificationsResponse{}, nil
}
func (*operationFake) CreateNotification(context.Context, *notificationv1.CreateNotificationRequest, ...grpc.CallOption) (*notificationv1.CreateNotificationResponse, error) {
	return &notificationv1.CreateNotificationResponse{}, nil
}
func (f *operationFake) StartReconciliation(_ context.Context, req *billingjobv1.StartReconciliationRequest, _ ...grpc.CallOption) (*billingjobv1.StartReconciliationResponse, error) {
	f.startRequest = req
	return &billingjobv1.StartReconciliationResponse{Run: &billingjobv1.ReconciliationRun{Id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", Status: "completed"}}, nil
}
func (*operationFake) GetLatestReconciliationRun(context.Context, *billingjobv1.GetLatestReconciliationRunRequest, ...grpc.CallOption) (*billingjobv1.GetLatestReconciliationRunResponse, error) {
	return &billingjobv1.GetLatestReconciliationRunResponse{}, nil
}
func (*operationFake) ListReconciliationItems(context.Context, *billingjobv1.ListReconciliationItemsRequest, ...grpc.CallOption) (*billingjobv1.ListReconciliationItemsResponse, error) {
	return &billingjobv1.ListReconciliationItemsResponse{}, nil
}
func (*operationFake) ApplyReconciliationAction(context.Context, *billingjobv1.ApplyReconciliationActionRequest, ...grpc.CallOption) (*billingjobv1.ApplyReconciliationActionResponse, error) {
	return &billingjobv1.ApplyReconciliationActionResponse{}, nil
}
func (*operationFake) ListDeliveryAttempts(context.Context, *notificationjobv1.ListDeliveryAttemptsRequest, ...grpc.CallOption) (*notificationjobv1.ListDeliveryAttemptsResponse, error) {
	return &notificationjobv1.ListDeliveryAttemptsResponse{}, nil
}
func (f *operationFake) RetryDelivery(_ context.Context, req *notificationjobv1.RetryDeliveryRequest, _ ...grpc.CallOption) (*notificationjobv1.RetryDeliveryResponse, error) {
	f.retryRequest = req
	return &notificationjobv1.RetryDeliveryResponse{EventId: "event-1", NotificationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", Status: "replayed"}, nil
}
func (*operationFake) ListCostAlerts(context.Context, *aiv1.ListCostAlertsRequest, ...grpc.CallOption) (*aiv1.ListCostAlertsReply, error) {
	return &aiv1.ListCostAlertsReply{}, nil
}
