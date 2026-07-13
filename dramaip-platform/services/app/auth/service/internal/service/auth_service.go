package service

import (
	"context"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type AuthService struct {
	authv1.UnimplementedAuthServiceServer
	uc *biz.AuthUsecase
}

func NewAuthService(uc *biz.AuthUsecase) *AuthService {
	return &AuthService{uc: uc}
}

func (s *AuthService) Register(ctx context.Context, req *authv1.RegisterRequest) (*authv1.AuthReply, error) {
	session, err := s.uc.Register(ctx, req.Email, req.Password, req.DisplayName, req.DeviceId)
	if err != nil {
		return nil, err
	}
	return sessionReply(session), nil
}

func (s *AuthService) Login(ctx context.Context, req *authv1.LoginRequest) (*authv1.AuthReply, error) {
	session, err := s.uc.Login(ctx, req.Email, req.Password, req.DeviceId)
	if err != nil {
		return nil, err
	}
	return sessionReply(session), nil
}

func (s *AuthService) Refresh(ctx context.Context, req *authv1.RefreshRequest) (*authv1.AuthReply, error) {
	session, err := s.uc.Refresh(ctx, req.RefreshToken)
	if err != nil {
		return nil, err
	}
	return sessionReply(session), nil
}

func (s *AuthService) Logout(ctx context.Context, req *authv1.LogoutRequest) (*authv1.LogoutReply, error) {
	if err := s.uc.Logout(ctx, req.RefreshToken, req.AccessToken, req.DeviceId); err != nil {
		return nil, err
	}
	return &authv1.LogoutReply{Ok: true}, nil
}

func (s *AuthService) ValidateAccessToken(ctx context.Context, req *authv1.ValidateAccessTokenRequest) (*authv1.AuthReply, error) {
	identity, err := s.uc.ValidateAccessToken(ctx, req.AccessToken)
	if err != nil {
		return nil, err
	}
	return &authv1.AuthReply{TokenType: "Bearer", UserId: identity.UserID, Email: identity.Email, EmailVerified: identity.EmailVerified}, nil
}

func (s *AuthService) RequestEmailVerification(ctx context.Context, req *authv1.RequestEmailVerificationRequest) (*authv1.EmailActionReply, error) {
	if err := s.uc.RequestEmailVerification(ctx, req.UserId); err != nil {
		return nil, err
	}
	return &authv1.EmailActionReply{Accepted: true}, nil
}

func (s *AuthService) VerifyEmail(ctx context.Context, req *authv1.VerifyEmailRequest) (*authv1.EmailActionReply, error) {
	if err := s.uc.VerifyEmail(ctx, req.UserId, req.Code); err != nil {
		return nil, err
	}
	return &authv1.EmailActionReply{Accepted: true}, nil
}

func (s *AuthService) RequestPasswordReset(ctx context.Context, req *authv1.RequestPasswordResetRequest) (*authv1.EmailActionReply, error) {
	if err := s.uc.RequestPasswordReset(ctx, req.Email); err != nil {
		return nil, err
	}
	return &authv1.EmailActionReply{Accepted: true}, nil
}

func (s *AuthService) ResetPassword(ctx context.Context, req *authv1.ResetPasswordRequest) (*authv1.EmailActionReply, error) {
	if err := s.uc.ResetPassword(ctx, req.Email, req.Code, req.Password); err != nil {
		return nil, err
	}
	return &authv1.EmailActionReply{Accepted: true}, nil
}

func (s *AuthService) CreateDesktopAuthorizationCode(ctx context.Context, req *authv1.CreateDesktopAuthorizationCodeRequest) (*authv1.CreateDesktopAuthorizationCodeReply, error) {
	if err := platform.RequireInternalPeer(ctx, "web-bff"); err != nil {
		return nil, err
	}
	code, expiresIn, err := s.uc.CreateDesktopAuthorizationCode(ctx, req.UserId, req.CodeChallenge, req.RedirectUri, req.DeviceId)
	if err != nil {
		return nil, err
	}
	return &authv1.CreateDesktopAuthorizationCodeReply{AuthorizationCode: code, ExpiresIn: expiresIn}, nil
}

func (s *AuthService) ExchangeDesktopAuthorizationCode(ctx context.Context, req *authv1.ExchangeDesktopAuthorizationCodeRequest) (*authv1.AuthReply, error) {
	if err := platform.RequireInternalPeer(ctx, "desktop-bff"); err != nil {
		return nil, err
	}
	session, err := s.uc.ExchangeDesktopAuthorizationCode(ctx, req.AuthorizationCode, req.CodeVerifier, req.RedirectUri, req.DeviceId)
	if err != nil {
		return nil, err
	}
	return sessionReply(session), nil
}

func sessionReply(session biz.Session) *authv1.AuthReply {
	return &authv1.AuthReply{
		AccessToken: session.AccessToken, RefreshToken: session.RefreshToken, TokenType: session.TokenType,
		ExpiresIn: session.ExpiresIn, UserId: session.UserID, Email: session.Email, Name: session.Name,
		EmailVerified: session.EmailVerified,
	}
}
