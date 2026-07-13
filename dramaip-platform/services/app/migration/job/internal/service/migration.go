package service

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type MigrationService struct {
	uc *biz.MigrationUsecase
}

func NewMigrationService(uc *biz.MigrationUsecase) *MigrationService {
	return &MigrationService{uc: uc}
}

func (s *MigrationService) Run(ctx context.Context) error {
	if err := s.uc.Run(ctx); err != nil {
		return err
	}
	platform.StructuredLog(ctx, "migration-job", "info", "migrations_applied", nil)
	return nil
}
