package rpc

import (
	"context"

	"google.golang.org/grpc"
)

type AuthServiceClient interface {
	Login(context.Context, *LoginRequest, ...grpc.CallOption) (*AuthReply, error)
	Refresh(context.Context, *RefreshRequest, ...grpc.CallOption) (*AuthReply, error)
	Logout(context.Context, *LogoutRequest, ...grpc.CallOption) (*LogoutReply, error)
	ValidateAccessToken(context.Context, *ValidateAccessTokenRequest, ...grpc.CallOption) (*AuthReply, error)
}

type authClient struct{ cc grpc.ClientConnInterface }

func NewAuthServiceClient(cc grpc.ClientConnInterface) AuthServiceClient { return &authClient{cc: cc} }
func (c *authClient) Login(ctx context.Context, in *LoginRequest, opts ...grpc.CallOption) (*AuthReply, error) {
	out := new(AuthReply)
	err := c.cc.Invoke(ctx, "/dramaip.auth.service.v1.AuthService/Login", in, out, opts...)
	return out, err
}
func (c *authClient) Refresh(ctx context.Context, in *RefreshRequest, opts ...grpc.CallOption) (*AuthReply, error) {
	out := new(AuthReply)
	err := c.cc.Invoke(ctx, "/dramaip.auth.service.v1.AuthService/Refresh", in, out, opts...)
	return out, err
}
func (c *authClient) Logout(ctx context.Context, in *LogoutRequest, opts ...grpc.CallOption) (*LogoutReply, error) {
	out := new(LogoutReply)
	err := c.cc.Invoke(ctx, "/dramaip.auth.service.v1.AuthService/Logout", in, out, opts...)
	return out, err
}
func (c *authClient) ValidateAccessToken(ctx context.Context, in *ValidateAccessTokenRequest, opts ...grpc.CallOption) (*AuthReply, error) {
	out := new(AuthReply)
	err := c.cc.Invoke(ctx, "/dramaip.auth.service.v1.AuthService/ValidateAccessToken", in, out, opts...)
	return out, err
}

func RegisterAuthServiceServer(s grpc.ServiceRegistrar, srv AuthServiceServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "dramaip.auth.service.v1.AuthService",
		HandlerType: (*AuthServiceServer)(nil),
		Methods: []grpc.MethodDesc{
			{MethodName: "Login", Handler: unary(func(ctx context.Context, req *LoginRequest) (any, error) { return srv.Login(ctx, req) })},
			{MethodName: "Refresh", Handler: unary(func(ctx context.Context, req *RefreshRequest) (any, error) { return srv.Refresh(ctx, req) })},
			{MethodName: "Logout", Handler: unary(func(ctx context.Context, req *LogoutRequest) (any, error) { return srv.Logout(ctx, req) })},
			{MethodName: "ValidateAccessToken", Handler: unary(func(ctx context.Context, req *ValidateAccessTokenRequest) (any, error) {
				return srv.ValidateAccessToken(ctx, req)
			})},
		},
	}, srv)
}

type UserServiceClient interface {
	GetProfile(context.Context, *GetProfileRequest, ...grpc.CallOption) (*UserProfile, error)
}
type userClient struct{ cc grpc.ClientConnInterface }

func NewUserServiceClient(cc grpc.ClientConnInterface) UserServiceClient { return &userClient{cc: cc} }
func (c *userClient) GetProfile(ctx context.Context, in *GetProfileRequest, opts ...grpc.CallOption) (*UserProfile, error) {
	out := new(UserProfile)
	err := c.cc.Invoke(ctx, "/dramaip.user.service.v1.UserService/GetProfile", in, out, opts...)
	return out, err
}
func RegisterUserServiceServer(s grpc.ServiceRegistrar, srv UserServiceServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "dramaip.user.service.v1.UserService",
		HandlerType: (*UserServiceServer)(nil),
		Methods:     []grpc.MethodDesc{{MethodName: "GetProfile", Handler: unary(func(ctx context.Context, req *GetProfileRequest) (any, error) { return srv.GetProfile(ctx, req) })}},
	}, srv)
}

type BillingServiceClient interface {
	ListPlans(context.Context, *ListPlansRequest, ...grpc.CallOption) (*ListPlansReply, error)
	CreateCheckout(context.Context, *CreateCheckoutRequest, ...grpc.CallOption) (*CreateCheckoutReply, error)
	ConfirmSandboxPayment(context.Context, *ConfirmSandboxPaymentRequest, ...grpc.CallOption) (*ConfirmSandboxPaymentReply, error)
	GetSubscription(context.Context, *GetSubscriptionRequest, ...grpc.CallOption) (*Subscription, error)
}
type billingClient struct{ cc grpc.ClientConnInterface }

func NewBillingServiceClient(cc grpc.ClientConnInterface) BillingServiceClient {
	return &billingClient{cc: cc}
}
func (c *billingClient) ListPlans(ctx context.Context, in *ListPlansRequest, opts ...grpc.CallOption) (*ListPlansReply, error) {
	out := new(ListPlansReply)
	err := c.cc.Invoke(ctx, "/dramaip.billing.service.v1.BillingService/ListPlans", in, out, opts...)
	return out, err
}
func (c *billingClient) CreateCheckout(ctx context.Context, in *CreateCheckoutRequest, opts ...grpc.CallOption) (*CreateCheckoutReply, error) {
	out := new(CreateCheckoutReply)
	err := c.cc.Invoke(ctx, "/dramaip.billing.service.v1.BillingService/CreateCheckout", in, out, opts...)
	return out, err
}
func (c *billingClient) ConfirmSandboxPayment(ctx context.Context, in *ConfirmSandboxPaymentRequest, opts ...grpc.CallOption) (*ConfirmSandboxPaymentReply, error) {
	out := new(ConfirmSandboxPaymentReply)
	err := c.cc.Invoke(ctx, "/dramaip.billing.service.v1.BillingService/ConfirmSandboxPayment", in, out, opts...)
	return out, err
}
func (c *billingClient) GetSubscription(ctx context.Context, in *GetSubscriptionRequest, opts ...grpc.CallOption) (*Subscription, error) {
	out := new(Subscription)
	err := c.cc.Invoke(ctx, "/dramaip.billing.service.v1.BillingService/GetSubscription", in, out, opts...)
	return out, err
}
func RegisterBillingServiceServer(s grpc.ServiceRegistrar, srv BillingServiceServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "dramaip.billing.service.v1.BillingService",
		HandlerType: (*BillingServiceServer)(nil),
		Methods: []grpc.MethodDesc{
			{MethodName: "ListPlans", Handler: unary(func(ctx context.Context, req *ListPlansRequest) (any, error) { return srv.ListPlans(ctx, req) })},
			{MethodName: "CreateCheckout", Handler: unary(func(ctx context.Context, req *CreateCheckoutRequest) (any, error) {
				return srv.CreateCheckout(ctx, req)
			})},
			{MethodName: "ConfirmSandboxPayment", Handler: unary(func(ctx context.Context, req *ConfirmSandboxPaymentRequest) (any, error) {
				return srv.ConfirmSandboxPayment(ctx, req)
			})},
			{MethodName: "GetSubscription", Handler: unary(func(ctx context.Context, req *GetSubscriptionRequest) (any, error) {
				return srv.GetSubscription(ctx, req)
			})},
		},
	}, srv)
}

type QuotaServiceClient interface {
	GetTokenBalance(context.Context, *GetTokenBalanceRequest, ...grpc.CallOption) (*TokenBalance, error)
	ReserveTokens(context.Context, *ReserveTokensRequest, ...grpc.CallOption) (*TokenReservation, error)
	SettleTokens(context.Context, *SettleTokensRequest, ...grpc.CallOption) (*TokenUsage, error)
	CancelReservation(context.Context, *CancelReservationRequest, ...grpc.CallOption) (*TokenReservation, error)
}
type quotaClient struct{ cc grpc.ClientConnInterface }

func NewQuotaServiceClient(cc grpc.ClientConnInterface) QuotaServiceClient {
	return &quotaClient{cc: cc}
}
func (c *quotaClient) GetTokenBalance(ctx context.Context, in *GetTokenBalanceRequest, opts ...grpc.CallOption) (*TokenBalance, error) {
	out := new(TokenBalance)
	err := c.cc.Invoke(ctx, "/dramaip.quota.service.v1.QuotaService/GetTokenBalance", in, out, opts...)
	return out, err
}
func (c *quotaClient) ReserveTokens(ctx context.Context, in *ReserveTokensRequest, opts ...grpc.CallOption) (*TokenReservation, error) {
	out := new(TokenReservation)
	err := c.cc.Invoke(ctx, "/dramaip.quota.service.v1.QuotaService/ReserveTokens", in, out, opts...)
	return out, err
}
func (c *quotaClient) SettleTokens(ctx context.Context, in *SettleTokensRequest, opts ...grpc.CallOption) (*TokenUsage, error) {
	out := new(TokenUsage)
	err := c.cc.Invoke(ctx, "/dramaip.quota.service.v1.QuotaService/SettleTokens", in, out, opts...)
	return out, err
}
func (c *quotaClient) CancelReservation(ctx context.Context, in *CancelReservationRequest, opts ...grpc.CallOption) (*TokenReservation, error) {
	out := new(TokenReservation)
	err := c.cc.Invoke(ctx, "/dramaip.quota.service.v1.QuotaService/CancelReservation", in, out, opts...)
	return out, err
}
func RegisterQuotaServiceServer(s grpc.ServiceRegistrar, srv QuotaServiceServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "dramaip.quota.service.v1.QuotaService",
		HandlerType: (*QuotaServiceServer)(nil),
		Methods: []grpc.MethodDesc{
			{MethodName: "GetTokenBalance", Handler: unary(func(ctx context.Context, req *GetTokenBalanceRequest) (any, error) {
				return srv.GetTokenBalance(ctx, req)
			})},
			{MethodName: "ReserveTokens", Handler: unary(func(ctx context.Context, req *ReserveTokensRequest) (any, error) { return srv.ReserveTokens(ctx, req) })},
			{MethodName: "SettleTokens", Handler: unary(func(ctx context.Context, req *SettleTokensRequest) (any, error) { return srv.SettleTokens(ctx, req) })},
			{MethodName: "CancelReservation", Handler: unary(func(ctx context.Context, req *CancelReservationRequest) (any, error) {
				return srv.CancelReservation(ctx, req)
			})},
		},
	}, srv)
}

type AiGatewayServiceClient interface {
	Chat(context.Context, *ChatRequest, ...grpc.CallOption) (*ChatReply, error)
}
type aiGatewayClient struct{ cc grpc.ClientConnInterface }

func NewAiGatewayServiceClient(cc grpc.ClientConnInterface) AiGatewayServiceClient {
	return &aiGatewayClient{cc: cc}
}
func (c *aiGatewayClient) Chat(ctx context.Context, in *ChatRequest, opts ...grpc.CallOption) (*ChatReply, error) {
	out := new(ChatReply)
	err := c.cc.Invoke(ctx, "/dramaip.ai_gateway.service.v1.AiGatewayService/Chat", in, out, opts...)
	return out, err
}
func RegisterAiGatewayServiceServer(s grpc.ServiceRegistrar, srv AiGatewayServiceServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "dramaip.ai_gateway.service.v1.AiGatewayService",
		HandlerType: (*AiGatewayServiceServer)(nil),
		Methods:     []grpc.MethodDesc{{MethodName: "Chat", Handler: unary(func(ctx context.Context, req *ChatRequest) (any, error) { return srv.Chat(ctx, req) })}},
	}, srv)
}

func unary[Req any](fn func(context.Context, *Req) (any, error)) func(any, context.Context, func(any) error, grpc.UnaryServerInterceptor) (any, error) {
	return func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
		req := new(Req)
		if err := dec(req); err != nil {
			return nil, err
		}
		if interceptor == nil {
			return fn(ctx, req)
		}
		info := &grpc.UnaryServerInfo{Server: srv}
		return interceptor(ctx, req, info, func(ctx context.Context, req any) (any, error) {
			return fn(ctx, req.(*Req))
		})
	}
}
