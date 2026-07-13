package service

import (
	"context"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
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
	return &authv1.AuthReply{TokenType: "Bearer", UserId: identity.UserID, Email: identity.Email}, nil
}

func sessionReply(session biz.Session) *authv1.AuthReply {
	return &authv1.AuthReply{
		AccessToken: session.AccessToken, RefreshToken: session.RefreshToken, TokenType: session.TokenType,
		ExpiresIn: session.ExpiresIn, UserId: session.UserID, Email: session.Email, Name: session.Name,
	}
}
