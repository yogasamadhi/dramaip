package biz

import (
	"context"
	"strings"
	"sync"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	reviewv1 "github.com/dramaip/dramaip-platform/services/api/review/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/web/interface/internal/data"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type BFFUsecase struct {
	data       *data.Data
	plansCache planCache
}

type planCache struct {
	mu      sync.RWMutex
	reply   *billingv1.ListPlansReply
	expires time.Time
}

// AccountBootstrap is deliberately a read model rather than another domain
// ownership boundary. Each section is independently loaded so a billing,
// quota, or notification outage cannot be converted into a plausible-looking
// zero on the account page.
type AccountBootstrap struct {
	GeneratedAt time.Time
	UsageLimit  int
	TrendDays   int
	Sections    map[string]AccountSection
}

type AccountSection struct {
	Status      string
	LastUpdated time.Time
	TraceID     string
	ErrorCode   string
	Data        any
}

const plansCacheTTL = 5 * time.Minute

func NewBFFUsecase(data *data.Data) *BFFUsecase {
	return &BFFUsecase{data: data}
}

func (u *BFFUsecase) Checks() map[string]func(context.Context) error {
	return u.data.Checks()
}

func (u *BFFUsecase) Login(ctx context.Context, email string, password string, deviceID string) (*authv1.AuthReply, error) {
	session, err := u.data.Auth.Login(ctx, &authv1.LoginRequest{Email: email, Password: password, DeviceId: deviceID})
	if err != nil {
		return nil, err
	}
	u.ensureSessionProfile(ctx, session, session.GetName(), "login")
	return session, nil
}

func (u *BFFUsecase) Register(ctx context.Context, email string, password string, displayName string, deviceID string) (*authv1.AuthReply, error) {
	session, err := u.data.Auth.Register(ctx, &authv1.RegisterRequest{Email: email, Password: password, DisplayName: displayName, DeviceId: deviceID})
	if err != nil {
		return nil, err
	}
	u.ensureSessionProfile(ctx, session, displayName, "register")
	return session, nil
}

func (u *BFFUsecase) Refresh(ctx context.Context, refreshToken string) (*authv1.AuthReply, error) {
	if refreshToken == "" {
		return nil, status.Error(codes.InvalidArgument, "missing_refresh_token")
	}
	session, err := u.data.Auth.Refresh(ctx, &authv1.RefreshRequest{RefreshToken: refreshToken})
	if err != nil {
		return nil, err
	}
	u.ensureSessionProfile(ctx, session, session.GetName(), "refresh")
	return session, nil
}

func (u *BFFUsecase) ensureSessionProfile(ctx context.Context, session *authv1.AuthReply, displayName string, operation string) {
	if session == nil || strings.TrimSpace(session.GetUserId()) == "" {
		return
	}
	profileCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		displayName = session.GetEmail()
	}
	_, err := u.data.User.EnsureProfile(profileCtx, &userv1.EnsureProfileRequest{
		UserId: session.GetUserId(), Email: session.GetEmail(), DisplayName: displayName, Status: "active",
	})
	if err != nil {
		platform.StructuredLog(ctx, "web-bff-interface", "warning", "profile_provision_deferred", map[string]any{
			"user_id": session.GetUserId(), "operation": operation, "error": err,
		})
	}
}

func (u *BFFUsecase) Logout(ctx context.Context, refreshToken string, accessToken string, deviceID string) (*authv1.LogoutReply, error) {
	return u.data.Auth.Logout(ctx, &authv1.LogoutRequest{RefreshToken: refreshToken, AccessToken: accessToken, DeviceId: deviceID})
}

func (u *BFFUsecase) RequestEmailVerification(ctx context.Context, userID string) (*authv1.EmailActionReply, error) {
	return u.data.Auth.RequestEmailVerification(ctx, &authv1.RequestEmailVerificationRequest{UserId: userID})
}

func (u *BFFUsecase) VerifyEmail(ctx context.Context, userID string, code string) (*authv1.EmailActionReply, error) {
	return u.data.Auth.VerifyEmail(ctx, &authv1.VerifyEmailRequest{UserId: userID, Code: code})
}

func (u *BFFUsecase) RequestPasswordReset(ctx context.Context, email string) (*authv1.EmailActionReply, error) {
	return u.data.Auth.RequestPasswordReset(ctx, &authv1.RequestPasswordResetRequest{Email: email})
}

func (u *BFFUsecase) ResetPassword(ctx context.Context, email string, code string, password string) (*authv1.EmailActionReply, error) {
	return u.data.Auth.ResetPassword(ctx, &authv1.ResetPasswordRequest{Email: email, Code: code, Password: password})
}

func (u *BFFUsecase) Plans(ctx context.Context) (*billingv1.ListPlansReply, error) {
	reply, err := u.data.Billing.ListPlans(ctx, &billingv1.ListPlansRequest{})
	if err == nil {
		u.plansCache.store(reply)
		return reply, nil
	}
	if !platform.IsTransientError(err) {
		return nil, err
	}
	if cached, ok := u.plansCache.load(); ok {
		platform.StructuredLog(ctx, "web-bff-interface", "warning", "plans_served_from_readonly_cache", map[string]any{"error": err})
		return cached, nil
	}
	return nil, err
}

func (c *planCache) store(reply *billingv1.ListPlansReply) {
	if reply == nil {
		return
	}
	copy := *reply
	copy.Plans = append([]*billingv1.Plan(nil), reply.Plans...)
	c.mu.Lock()
	c.reply = &copy
	c.expires = time.Now().Add(plansCacheTTL)
	c.mu.Unlock()
}

func (c *planCache) load() (*billingv1.ListPlansReply, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.reply == nil || time.Now().After(c.expires) {
		return nil, false
	}
	copy := *c.reply
	copy.Plans = append([]*billingv1.Plan(nil), c.reply.Plans...)
	return &copy, true
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

func (u *BFFUsecase) Workspaces(ctx context.Context, userID string) (*userv1.ListWorkspacesReply, error) {
	return u.data.Workspace.ListWorkspaces(ctx, &userv1.ListWorkspacesRequest{UserId: userID})
}

func (u *BFFUsecase) WorkspaceMembers(ctx context.Context, userID, workspaceID string) (*userv1.ListWorkspaceMembersReply, error) {
	return u.data.Workspace.ListWorkspaceMembers(ctx, &userv1.ListWorkspaceMembersRequest{UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID)})
}

func (u *BFFUsecase) WorkspaceInvitations(ctx context.Context, userID, workspaceID string) (*userv1.ListWorkspaceInvitationsReply, error) {
	return u.data.Workspace.ListWorkspaceInvitations(ctx, &userv1.ListWorkspaceInvitationsRequest{UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID)})
}

func (u *BFFUsecase) InviteWorkspaceMember(ctx context.Context, userID, workspaceID, email, role string, expiresInHours int32) (*userv1.WorkspaceInvitation, error) {
	return u.data.Workspace.InviteWorkspaceMember(ctx, &userv1.InviteWorkspaceMemberRequest{
		UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID), Email: strings.TrimSpace(email),
		Role: strings.TrimSpace(role), ExpiresInHours: expiresInHours,
	})
}

func (u *BFFUsecase) AcceptWorkspaceInvitation(ctx context.Context, userID, token string) (*userv1.WorkspaceMember, error) {
	return u.data.Workspace.AcceptWorkspaceInvitation(ctx, &userv1.AcceptWorkspaceInvitationRequest{UserId: userID, Token: strings.TrimSpace(token)})
}

func (u *BFFUsecase) RevokeWorkspaceInvitation(ctx context.Context, userID, workspaceID, invitationID string) (*userv1.WorkspaceInvitation, error) {
	return u.data.Workspace.RevokeWorkspaceInvitation(ctx, &userv1.RevokeWorkspaceInvitationRequest{
		UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID), InvitationId: strings.TrimSpace(invitationID),
	})
}

func (u *BFFUsecase) UpdateWorkspaceMemberRole(ctx context.Context, userID, workspaceID, memberUserID, role string) (*userv1.WorkspaceMember, error) {
	return u.data.Workspace.UpdateWorkspaceMemberRole(ctx, &userv1.UpdateWorkspaceMemberRoleRequest{
		UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID),
		MemberUserId: strings.TrimSpace(memberUserID), Role: strings.TrimSpace(role),
	})
}

func (u *BFFUsecase) RemoveWorkspaceMember(ctx context.Context, userID, workspaceID, memberUserID string) (*userv1.WorkspaceMember, error) {
	return u.data.Workspace.RemoveWorkspaceMember(ctx, &userv1.RemoveWorkspaceMemberRequest{
		UserId: userID, WorkspaceId: strings.TrimSpace(workspaceID), MemberUserId: strings.TrimSpace(memberUserID),
	})
}

func (u *BFFUsecase) PublicReviewPackage(ctx context.Context, token, pin string) (*reviewv1.PublicPackageReply, error) {
	return u.data.Review.GetPublicPackage(ctx, &reviewv1.GetPublicPackageRequest{Token: strings.TrimSpace(token), Pin: strings.TrimSpace(pin)})
}

func (u *BFFUsecase) SubmitPublicReviewComment(ctx context.Context, request *reviewv1.SubmitPublicCommentRequest) (*reviewv1.ReviewComment, error) {
	return u.data.Review.SubmitPublicComment(ctx, request)
}

func (u *BFFUsecase) SubmitPublicReviewDecision(ctx context.Context, request *reviewv1.SubmitPublicDecisionRequest) (*reviewv1.ReviewDecision, error) {
	return u.data.Review.SubmitPublicDecision(ctx, request)
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

// AccountBootstrap loads account concerns concurrently. A read model is
// successful even when an individual downstream section is unavailable: the
// caller receives the exact section state and trace id instead of fabricated
// empty data.
func (u *BFFUsecase) AccountBootstrap(ctx context.Context, userID string, usageLimit, trendDays int) AccountBootstrap {
	generatedAt := time.Now().UTC()
	bootstrap := AccountBootstrap{GeneratedAt: generatedAt, UsageLimit: usageLimit, TrendDays: trendDays, Sections: make(map[string]AccountSection, 7)}
	sections := []struct {
		name string
		load func() (any, error)
	}{
		{name: "profile", load: func() (any, error) { return u.Profile(ctx, userID) }},
		{name: "subscription", load: func() (any, error) { return u.Subscription(ctx, userID) }},
		{name: "token_balance", load: func() (any, error) { return u.TokenBalance(ctx, userID) }},
		{name: "orders", load: func() (any, error) { return u.Orders(ctx, userID) }},
		{name: "usage", load: func() (any, error) { return u.TokenUsage(ctx, userID, int32(usageLimit)) }},
		{name: "usage_trend", load: func() (any, error) { return u.UsageTrend(ctx, userID, int32(trendDays)) }},
		{name: "notifications", load: func() (any, error) { return u.Notifications(ctx, userID, 100) }},
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, section := range sections {
		section := section
		wg.Add(1)
		go func() {
			defer wg.Done()
			value, err := section.load()
			result := AccountSection{Status: "ready", LastUpdated: generatedAt, Data: value}
			if err != nil {
				result = AccountSection{
					Status: "unavailable", LastUpdated: generatedAt, TraceID: platform.TraceID(ctx), ErrorCode: accountSectionErrorCode(err),
				}
			}
			mu.Lock()
			bootstrap.Sections[section.name] = result
			mu.Unlock()
		}()
	}
	wg.Wait()
	return bootstrap
}

func accountSectionErrorCode(err error) string {
	if st, ok := status.FromError(err); ok && st.Code() != codes.OK {
		return "upstream_" + strings.ToLower(st.Code().String())
	}
	return "upstream_unavailable"
}

func (u *BFFUsecase) CreateNotification(ctx context.Context, userID string, typ string, title string, body string, sourceEventID string) {
	_ = u.data.CreateNotification(ctx, userID, typ, title, body, sourceEventID)
}

func (u *BFFUsecase) AccountReport(ctx context.Context, userID string) (map[string]any, error) {
	// Kept for older consumers. Unlike its original implementation, this
	// compatibility endpoint never converts a downstream failure into a zero
	// aggregate; new UIs should use AccountBootstrap for partial availability.
	sub, err := u.Subscription(ctx, userID)
	if err != nil {
		return nil, err
	}
	balance, err := u.TokenBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	orders, err := u.Orders(ctx, userID)
	if err != nil {
		return nil, err
	}
	usage, err := u.TokenUsage(ctx, userID, 100)
	if err != nil {
		return nil, err
	}
	trend, err := u.UsageTrend(ctx, userID, 30)
	if err != nil {
		return nil, err
	}
	notifications, err := u.Notifications(ctx, userID, 100)
	if err != nil {
		return nil, err
	}
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
	// A protobuf repeated field is nil when an account has no usage rows. Do
	// not expose that Go implementation detail as JSON null: the browser API
	// contract deliberately represents an empty trend as an empty array.
	usageTrend := make([]map[string]any, 0)
	if trend != nil {
		usageTrend = make([]map[string]any, 0, len(trend.GetPoints()))
		for _, point := range trend.GetPoints() {
			usageTrend = append(usageTrend, map[string]any{
				"date":         point.GetDate(),
				"total_tokens": point.GetTotalTokens(),
			})
		}
	}
	report := map[string]any{
		"generated_at":         time.Now().UTC().Format(time.RFC3339),
		"subscription":         sub,
		"token_balance":        balance,
		"order_summary":        map[string]any{"paid": paidOrders, "pending": pendingOrders, "total": len(orders.GetOrders())},
		"usage_summary":        map[string]any{"total_tokens": totalTokens, "requests": len(usage.GetUsage())},
		"usage_trend":          usageTrend,
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
	reply, err := u.data.Billing.ConfirmSimulatedPayment(ctx, &billingv1.ConfirmSimulatedPaymentRequest{UserId: userID, CheckoutId: checkoutID})
	if err != nil {
		return nil, err
	}
	if err := u.syncOwnerWorkspaceEntitlements(ctx, userID, reply.Subscription); err != nil {
		return nil, err
	}
	return reply, nil
}

func (u *BFFUsecase) CancelSubscription(ctx context.Context, userID string, subscriptionID string, immediate bool) (*billingv1.Subscription, error) {
	reply, err := u.data.Billing.CancelSubscription(ctx, &billingv1.CancelSubscriptionRequest{UserId: userID, SubscriptionId: subscriptionID, Immediate: immediate})
	if err == nil {
		u.CreateNotification(ctx, userID, "subscription_canceled", "订阅取消已受理", "你的订阅取消请求已记录。", "subscription-cancel:"+reply.Id)
	}
	return reply, err
}

func (u *BFFUsecase) ResumeSubscription(ctx context.Context, userID, subscriptionID, idempotencyKey string) (*billingv1.Subscription, error) {
	return u.data.Billing.ResumeSubscription(ctx, &billingv1.ResumeSubscriptionRequest{
		UserId: userID, SubscriptionId: subscriptionID, IdempotencyKey: idempotencyKey,
	})
}

func (u *BFFUsecase) ChangeSubscriptionPlan(ctx context.Context, userID, subscriptionID, planID, idempotencyKey string) (*billingv1.Subscription, error) {
	reply, err := u.data.Billing.ChangeSubscriptionPlan(ctx, &billingv1.ChangeSubscriptionPlanRequest{
		UserId: userID, SubscriptionId: subscriptionID, PlanId: planID, IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, err
	}
	if err := u.syncOwnerWorkspaceEntitlements(ctx, userID, reply); err != nil {
		return nil, err
	}
	return reply, nil
}

func (u *BFFUsecase) syncOwnerWorkspaceEntitlements(ctx context.Context, userID string, subscription *billingv1.Subscription) error {
	if subscription == nil || subscription.Entitlements == nil {
		return status.Error(codes.FailedPrecondition, "subscription_entitlements_missing")
	}
	workspaces, err := u.data.Workspace.ListWorkspaces(ctx, &userv1.ListWorkspacesRequest{UserId: userID})
	if err != nil {
		return err
	}
	for _, workspace := range workspaces.Workspaces {
		if workspace.OwnerUserId != userID {
			continue
		}
		_, err := u.data.Workspace.SetWorkspacePlan(ctx, &userv1.SetWorkspacePlanRequest{
			WorkspaceId: workspace.Id, PlanCode: subscription.PlanCode,
			IncludedSeats:       subscription.Entitlements.IncludedSeats,
			ReviewStorageBytes:  subscription.Entitlements.ReviewStorageBytes,
			ReviewRetentionDays: subscription.Entitlements.ReviewRetentionDays,
		})
		return err
	}
	return status.Error(codes.FailedPrecondition, "owner_workspace_missing")
}

func (u *BFFUsecase) RequestRefund(ctx context.Context, userID, subscriptionID, reason, idempotencyKey string) (*billingv1.Refund, error) {
	return u.data.Billing.RequestRefund(ctx, &billingv1.RequestRefundRequest{
		UserId: userID, SubscriptionId: subscriptionID, Reason: reason, IdempotencyKey: idempotencyKey,
	})
}

func (u *BFFUsecase) PreflightChat(ctx context.Context, userID, provider, model string, messages []*aiv1.ChatMessage, contextCharacters, maxTokens int64) (*aiv1.PreflightReply, *quotav1.TokenBalance, error) {
	// The browser may omit the model to select a provider default. Resolve it
	// first with a syntactically valid throwaway binding, then bind the exact
	// resolved provider/model/messages before returning anything to the client.
	resolved, err := u.data.AI.Preflight(ctx, &aiv1.PreflightRequest{
		UserId: userID, Provider: strings.TrimSpace(provider), Model: strings.TrimSpace(model), ContextCharacters: contextCharacters,
		MessageCount: int64(len(messages)), MaxTokens: maxTokens, RequestHash: strings.Repeat("a", 43),
	})
	if err != nil {
		return nil, nil, err
	}
	if resolved.GetModel() == nil {
		return nil, nil, status.Error(codes.Unavailable, "cloud_preflight_model_missing")
	}
	hashMessages := make([]platform.CloudAIHashMessage, 0, len(messages))
	for _, message := range messages {
		if message == nil {
			return nil, nil, status.Error(codes.InvalidArgument, "invalid_cloud_context")
		}
		hashMessages = append(hashMessages, platform.CloudAIHashMessage{Role: message.Role, Content: message.Content})
	}
	requestHash, err := platform.CloudAIRequestHash(resolved.GetModel().GetProvider(), resolved.GetModel().GetModel(), maxTokens, hashMessages)
	if err != nil {
		return nil, nil, status.Error(codes.Internal, "cloud_preflight_hash_failed")
	}
	preflight, err := u.data.AI.Preflight(ctx, &aiv1.PreflightRequest{
		UserId: userID, Provider: resolved.GetModel().GetProvider(), Model: resolved.GetModel().GetModel(), ContextCharacters: contextCharacters,
		MessageCount: int64(len(messages)), MaxTokens: maxTokens, RequestHash: requestHash,
	})
	if err != nil {
		return nil, nil, err
	}
	if preflight.GetRequestHash() != requestHash {
		return nil, nil, status.Error(codes.FailedPrecondition, "cloud_preflight_request_mismatch")
	}
	balance, err := u.data.Quota.GetTokenBalance(ctx, &quotav1.GetTokenBalanceRequest{UserId: userID})
	if err != nil {
		return nil, nil, err
	}
	if balance.GetRemainingTokens() < preflight.GetEstimatedTokens() {
		return nil, nil, status.Error(codes.ResourceExhausted, "cloud_quota_insufficient")
	}
	return preflight, balance, nil
}

func (u *BFFUsecase) Chat(ctx context.Context, userID string, requestID string, idempotencyKey string, clientIP string, provider string, model string, messages []*aiv1.ChatMessage, maxTokens int64, preflightRequestHash string) (*aiv1.ChatReply, error) {
	return u.data.AI.Chat(ctx, &aiv1.ChatRequest{
		UserId: userID, RequestId: requestID, IdempotencyKey: idempotencyKey, ClientIp: clientIP, Provider: provider,
		Model: model, Messages: messages, MaxTokens: maxTokens, PreflightRequestHash: preflightRequestHash,
	})
}

func (u *BFFUsecase) ChatModels(ctx context.Context, userID string) (*aiv1.ListModelsReply, error) {
	return u.data.AI.ListModels(ctx, &aiv1.ListModelsRequest{UserId: userID})
}

func (u *BFFUsecase) ChatStream(ctx context.Context, userID string, requestID string, idempotencyKey string, clientIP string, provider string, model string, messages []*aiv1.ChatMessage, maxTokens int64, preflightRequestHash string) (aiv1.AiGatewayService_ChatStreamClient, error) {
	return u.data.AI.ChatStream(ctx, &aiv1.ChatStreamRequest{
		UserId: userID, RequestId: requestID, IdempotencyKey: idempotencyKey, ClientIp: clientIP, Provider: provider,
		Model: model, Messages: messages, MaxTokens: maxTokens, PreflightRequestHash: preflightRequestHash,
	})
}

func (u *BFFUsecase) CancelChat(ctx context.Context, userID, idempotencyKey string) (*aiv1.CancelChatReply, error) {
	return u.data.AI.CancelChat(ctx, &aiv1.CancelChatRequest{UserId: userID, IdempotencyKey: idempotencyKey})
}

func (u *BFFUsecase) ChatStatus(ctx context.Context, userID, idempotencyKey string) (*aiv1.GetChatStatusReply, error) {
	return u.data.AI.GetChatStatus(ctx, &aiv1.GetChatStatusRequest{UserId: userID, IdempotencyKey: idempotencyKey})
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

func (u *BFFUsecase) CreateDesktopAuthorizationCode(ctx context.Context, userID, codeChallenge, redirectURI, deviceID string) (*authv1.CreateDesktopAuthorizationCodeReply, error) {
	return u.data.Auth.CreateDesktopAuthorizationCode(ctx, &authv1.CreateDesktopAuthorizationCodeRequest{
		UserId: userID, CodeChallenge: codeChallenge, RedirectUri: redirectURI, DeviceId: deviceID,
	})
}
