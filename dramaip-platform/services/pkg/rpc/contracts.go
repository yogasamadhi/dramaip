package rpc

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type ValidateAccessTokenRequest struct {
	AccessToken string `json:"access_token"`
}

type AuthReply struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
}

type LogoutReply struct {
	OK bool `json:"ok"`
}

type GetProfileRequest struct {
	UserID string `json:"user_id"`
}

type UserProfile struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Locale      string `json:"locale"`
	Timezone    string `json:"timezone"`
	Status      string `json:"status"`
}

type ListPlansRequest struct{}

type Plan struct {
	ID                string `json:"id"`
	Code              string `json:"code"`
	Name              string `json:"name"`
	MonthlyTokenQuota int64  `json:"monthly_token_quota"`
	PriceCNY          int64  `json:"price_cny"`
	Currency          string `json:"currency"`
	ModelLevel        string `json:"model_level"`
	MaxRPM            int64  `json:"max_rpm"`
}

type ListPlansReply struct {
	Plans []Plan `json:"plans"`
}

type CreateCheckoutRequest struct {
	UserID   string `json:"user_id"`
	PlanID   string `json:"plan_id"`
	Provider string `json:"provider"`
}

type CreateCheckoutReply struct {
	OrderID    string         `json:"order_id"`
	PlanID     string         `json:"plan_id"`
	Provider   string         `json:"provider"`
	Status     string         `json:"status"`
	PaymentURL string         `json:"payment_url"`
	Event      map[string]any `json:"event"`
}

type ConfirmSandboxPaymentRequest struct {
	UserID     string `json:"user_id"`
	CheckoutID string `json:"checkout_id"`
}

type ConfirmSandboxPaymentReply struct {
	OrderID      string       `json:"order_id"`
	Status       string       `json:"status"`
	Subscription Subscription `json:"subscription"`
	TokenBalance TokenBalance `json:"token_balance"`
}

type GetSubscriptionRequest struct {
	UserID string `json:"user_id"`
}

type Subscription struct {
	ID                 string `json:"id"`
	UserID             string `json:"user_id"`
	PlanID             string `json:"plan_id"`
	PlanCode           string `json:"plan_code"`
	Status             string `json:"status"`
	CurrentPeriodStart string `json:"current_period_start"`
	CurrentPeriodEnd   string `json:"current_period_end"`
}

type GetTokenBalanceRequest struct {
	UserID string `json:"user_id"`
}

type TokenBalance struct {
	Plan            string `json:"plan"`
	QuotaTokens     int64  `json:"quota_tokens"`
	UsedTokens      int64  `json:"used_tokens"`
	RemainingTokens int64  `json:"remaining_tokens"`
	PeriodStart     string `json:"period_start"`
	PeriodEnd       string `json:"period_end"`
}

type ReserveTokensRequest struct {
	UserID         string `json:"user_id"`
	RequestID      string `json:"request_id"`
	ReservedTokens int64  `json:"reserved_tokens"`
}

type TokenReservation struct {
	ID             string `json:"id"`
	TokenAccountID string `json:"token_account_id"`
	ReservedTokens int64  `json:"reserved_tokens"`
	Status         string `json:"status"`
	SubscriptionID string `json:"subscription_id"`
	CurrentUsed    int64  `json:"current_used"`
	CurrentQuota   int64  `json:"current_quota"`
}

type SettleTokensRequest struct {
	ReservationID    string `json:"reservation_id"`
	RequestID        string `json:"request_id"`
	Model            string `json:"model"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
}

type CancelReservationRequest struct {
	ReservationID string `json:"reservation_id"`
}

type TokenUsage struct {
	ID          string `json:"id"`
	TotalTokens int64  `json:"total_tokens"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	UserID    string        `json:"user_id"`
	RequestID string        `json:"request_id"`
	Provider  string        `json:"provider"`
	Model     string        `json:"model"`
	Messages  []ChatMessage `json:"messages"`
	MaxTokens int64         `json:"max_tokens"`
}

type ChatReply struct {
	Content          string `json:"content"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	ReservationID    string `json:"reservation_id"`
	RemainingTokens  int64  `json:"remaining_tokens"`
}

type AuthServiceServer interface {
	Login(context.Context, *LoginRequest) (*AuthReply, error)
	Refresh(context.Context, *RefreshRequest) (*AuthReply, error)
	Logout(context.Context, *LogoutRequest) (*LogoutReply, error)
	ValidateAccessToken(context.Context, *ValidateAccessTokenRequest) (*AuthReply, error)
}

type UserServiceServer interface {
	GetProfile(context.Context, *GetProfileRequest) (*UserProfile, error)
}

type BillingServiceServer interface {
	ListPlans(context.Context, *ListPlansRequest) (*ListPlansReply, error)
	CreateCheckout(context.Context, *CreateCheckoutRequest) (*CreateCheckoutReply, error)
	ConfirmSandboxPayment(context.Context, *ConfirmSandboxPaymentRequest) (*ConfirmSandboxPaymentReply, error)
	GetSubscription(context.Context, *GetSubscriptionRequest) (*Subscription, error)
}

type QuotaServiceServer interface {
	GetTokenBalance(context.Context, *GetTokenBalanceRequest) (*TokenBalance, error)
	ReserveTokens(context.Context, *ReserveTokensRequest) (*TokenReservation, error)
	SettleTokens(context.Context, *SettleTokensRequest) (*TokenUsage, error)
	CancelReservation(context.Context, *CancelReservationRequest) (*TokenReservation, error)
}

type AiGatewayServiceServer interface {
	Chat(context.Context, *ChatRequest) (*ChatReply, error)
}

func Dial(ctx context.Context, target string) (*grpc.ClientConn, error) {
	return grpc.DialContext(
		ctx,
		target,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.ForceCodec(jsonCodec{})),
	)
}
