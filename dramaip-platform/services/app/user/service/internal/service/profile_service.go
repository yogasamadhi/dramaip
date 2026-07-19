package service

import (
	"context"

	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type UserService struct {
	userv1.UnimplementedUserServiceServer
	uc *biz.UserUsecase
}

func NewUserService(uc *biz.UserUsecase) *UserService {
	return &UserService{uc: uc}
}

func (s *UserService) GetProfile(ctx context.Context, req *userv1.GetProfileRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	profile, err := s.uc.GetProfile(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) EnsureProfile(ctx context.Context, req *userv1.EnsureProfileRequest) (*userv1.UserProfile, error) {
	profile, err := s.uc.EnsureProfile(ctx, biz.Profile{
		ID: req.UserId, Email: req.Email, Phone: req.Phone, DisplayName: req.DisplayName, Status: req.Status,
	})
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) UpdateProfile(ctx context.Context, req *userv1.UpdateProfileRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	profile, err := s.uc.UpdateProfile(ctx, biz.Profile{
		ID: req.UserId, Phone: req.Phone, DisplayName: req.DisplayName,
		AvatarURL: req.AvatarUrl, Locale: req.Locale, Timezone: req.Timezone,
	})
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func (s *UserService) SetProfileStatus(ctx context.Context, req *userv1.SetProfileStatusRequest) (*userv1.UserProfile, error) {
	if err := platform.RequireInternalPeer(ctx, "admin-bff"); err != nil {
		return nil, err
	}
	profile, err := s.uc.SetProfileStatus(ctx, req.UserId, req.Status, req.OperatorId, req.Reason, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	return profileReply(profile), nil
}

func profileReply(profile biz.Profile) *userv1.UserProfile {
	return &userv1.UserProfile{
		Id: profile.ID, Email: profile.Email, Phone: profile.Phone, DisplayName: profile.DisplayName,
		AvatarUrl: profile.AvatarURL, Locale: profile.Locale, Timezone: profile.Timezone, Status: profile.Status,
	}
}
