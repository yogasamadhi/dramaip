package service

import (
	"context"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type AiGatewayService struct {
	aiv1.UnimplementedAiGatewayServiceServer
	uc *biz.AiGatewayUsecase
}

func NewAiGatewayService(uc *biz.AiGatewayUsecase) *AiGatewayService {
	return &AiGatewayService{uc: uc}
}

func (s *AiGatewayService) Chat(ctx context.Context, req *aiv1.ChatRequest) (*aiv1.ChatReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	messages := make([]biz.ChatMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		messages = append(messages, biz.ChatMessage{Role: message.Role, Content: message.Content})
	}
	reply, err := s.uc.Chat(ctx, biz.ChatInput{
		UserID: req.UserId, RequestID: req.RequestId, IdempotencyKey: req.IdempotencyKey, ClientIP: req.ClientIp, Provider: req.Provider,
		Model: req.Model, Messages: messages, MaxTokens: req.MaxTokens,
	})
	if err != nil {
		return nil, err
	}
	return &aiv1.ChatReply{
		Content: reply.Content, Provider: reply.Provider, Model: reply.Model,
		PromptTokens: reply.PromptTokens, CompletionTokens: reply.CompletionTokens, TotalTokens: reply.TotalTokens,
		ReservationId: reply.ReservationID, RemainingTokens: reply.RemainingTokens,
		RequestId: reply.RequestID, Status: reply.Status,
	}, nil
}
