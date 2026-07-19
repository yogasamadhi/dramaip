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

func (s *AiGatewayService) ListModels(ctx context.Context, req *aiv1.ListModelsRequest) (*aiv1.ListModelsReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	models := s.uc.ListModels()
	reply := &aiv1.ListModelsReply{Models: make([]*aiv1.CloudModel, 0, len(models))}
	for _, model := range models {
		reply.Models = append(reply.Models, &aiv1.CloudModel{Provider: model.Provider, Model: model.Model, IsDefault: model.IsDefault})
	}
	return reply, nil
}

func (s *AiGatewayService) Preflight(ctx context.Context, req *aiv1.PreflightRequest) (*aiv1.PreflightReply, error) {
	if err := platform.RequireUserIdentity(ctx, req.UserId); err != nil {
		return nil, err
	}
	result, err := s.uc.Preflight(biz.PreflightInput{
		UserID: req.UserId, Provider: req.Provider, Model: req.Model,
		ContextCharacters: req.ContextCharacters, MessageCount: req.MessageCount, MaxTokens: req.MaxTokens, RequestHash: req.RequestHash,
	})
	if err != nil {
		return nil, err
	}
	return &aiv1.PreflightReply{
		Model:           &aiv1.CloudModel{Provider: result.Model.Provider, Model: result.Model.Model, IsDefault: result.Model.IsDefault},
		EstimatedTokens: result.EstimatedTokens,
		RequestHash:     result.RequestHash,
	}, nil
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
		Model: req.Model, Messages: messages, MaxTokens: req.MaxTokens, PreflightRequestHash: req.PreflightRequestHash,
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
