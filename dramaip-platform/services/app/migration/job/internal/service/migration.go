package service

import (
	"context"
	"log"

	"github.com/dramaip/dramaip-platform/services/app/migration/job/internal/biz"
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
	log.Printf("migrations applied")
	return nil
}
