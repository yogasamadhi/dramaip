package main

import (
	"context"
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type service struct{ db *gorm.DB }

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	svc := &service{db: db}
	health := platform.HealthServer(platform.Env("USER_HTTP_ADDR", ":8102"), "user-service", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("user health server stopped: %v", err)
		}
	}()
	if err := platform.ServeGRPC(platform.Env("USER_GRPC_ADDR", ":9102"), func(server *grpc.Server) {
		drpc.RegisterUserServiceServer(server, svc)
	}); err != nil {
		log.Fatalf("user gRPC failed: %v", err)
	}
}

func (s *service) GetProfile(ctx context.Context, req *drpc.GetProfileRequest) (*drpc.UserProfile, error) {
	var row struct {
		ID          string
		Email       string
		DisplayName string
		AvatarURL   string
		Locale      string
		Timezone    string
		Status      string
	}
	err := s.db.WithContext(ctx).Raw(`
		SELECT
			u.id::text AS id,
			u.email,
			COALESCE(p.display_name, u.email) AS display_name,
			COALESCE(p.avatar_url, '') AS avatar_url,
			COALESCE(p.locale, '') AS locale,
			COALESCE(p.timezone, '') AS timezone,
			u.status
		FROM auth.users u
		LEFT JOIN user_profile.profiles p ON p.user_id = u.id
		WHERE u.id = ?::uuid
		LIMIT 1
	`, req.UserID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return nil, status.Error(codes.NotFound, "profile not found")
	}
	return &drpc.UserProfile{
		ID: row.ID, Email: row.Email, DisplayName: row.DisplayName, AvatarURL: row.AvatarURL,
		Locale: row.Locale, Timezone: row.Timezone, Status: row.Status,
	}, nil
}
