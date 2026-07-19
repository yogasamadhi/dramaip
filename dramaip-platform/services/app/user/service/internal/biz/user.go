package biz

import (
	"context"
	"strings"

	"github.com/dramaip/dramaip-platform/services/app/user/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type UserUsecase struct {
	repo *data.UserRepo
}

type Profile struct {
	ID          string
	Email       string
	Phone       string
	DisplayName string
	AvatarURL   string
	Locale      string
	Timezone    string
	Status      string
}

func NewUserUsecase(repo *data.UserRepo) *UserUsecase {
	return &UserUsecase{repo: repo}
}

func (u *UserUsecase) Checks() map[string]func(context.Context) error {
	return u.repo.Checks()
}

func (u *UserUsecase) GetProfile(ctx context.Context, userID string) (Profile, error) {
	row, err := u.repo.GetProfile(ctx, userID)
	if err != nil {
		return Profile{}, status.Error(codes.NotFound, "profile not found")
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName, AvatarURL: row.AvatarURL,
		Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) EnsureProfile(ctx context.Context, profile Profile) (Profile, error) {
	row, err := u.repo.EnsureProfile(ctx, data.ProfileRow{
		ID: profile.ID, Email: profile.Email, Phone: profile.Phone, DisplayName: profile.DisplayName, Status: profile.Status,
	})
	if err != nil {
		return Profile{}, err
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName,
		AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) UpdateProfile(ctx context.Context, profile Profile) (Profile, error) {
	if strings.TrimSpace(profile.DisplayName) == "" {
		return Profile{}, status.Error(codes.InvalidArgument, "display_name_required")
	}
	row, err := u.repo.UpdateProfile(ctx, data.ProfileRow{
		ID: profile.ID, Phone: profile.Phone, DisplayName: strings.TrimSpace(profile.DisplayName),
		AvatarURL: strings.TrimSpace(profile.AvatarURL), Locale: strings.TrimSpace(profile.Locale), Timezone: strings.TrimSpace(profile.Timezone),
	})
	if err != nil {
		return Profile{}, err
	}
	return Profile{
		ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName,
		AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}

func (u *UserUsecase) SetProfileStatus(ctx context.Context, userID, state, operatorID, reason, idempotencyKey string) (Profile, error) {
	userID, state = strings.TrimSpace(userID), strings.TrimSpace(state)
	if userID == "" || strings.TrimSpace(operatorID) == "" || strings.TrimSpace(idempotencyKey) == "" || len(strings.TrimSpace(reason)) < 4 || len(strings.TrimSpace(reason)) > 300 || (state != "active" && state != "suspended") {
		return Profile{}, status.Error(codes.InvalidArgument, "invalid_profile_status_change")
	}
	row, err := u.repo.SetProfileStatus(ctx, userID, state, strings.TrimSpace(operatorID), strings.TrimSpace(reason), strings.TrimSpace(idempotencyKey))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return Profile{}, status.Error(codes.NotFound, "profile not found")
		}
		return Profile{}, err
	}
	return Profile{ID: row.ID, Email: row.Email, Phone: row.Phone, DisplayName: row.DisplayName, AvatarURL: row.AvatarURL, Locale: row.Locale, Timezone: row.Timezone, Status: row.Status}, nil
}
