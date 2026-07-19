package service

import (
	"context"
	"errors"

	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/biz"
)

type ConsumerService struct {
	uc *biz.NotificationEventUsecase
}

func NewConsumerService(uc *biz.NotificationEventUsecase) *ConsumerService {
	return &ConsumerService{uc: uc}
}

func (s *ConsumerService) Checks() map[string]func(context.Context) error {
	return s.uc.Checks()
}

func (s *ConsumerService) Run(ctx context.Context) error {
	err := s.uc.Run(ctx)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func (s *ConsumerService) Retry(ctx context.Context, raw []byte) error {
	return s.uc.Retry(ctx, raw)
}
