package biz

import (
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/ai_gateway/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDesktopPreflightListsOnlyPricedCallableModels(t *testing.T) {
	uc := NewAiGatewayUsecase(&data.Data{
		DefaultProvider: "test",
		Providers: map[string]data.Provider{
			"test":    {Name: "test", Model: "test-dramaip-chat"},
			"missing": {Name: "missing", Model: "missing-model"},
		},
	})
	models := uc.ListModels()
	if len(models) != 1 || models[0].Provider != "test" || !models[0].IsDefault {
		t.Fatalf("models = %#v", models)
	}
	result, err := uc.Preflight(PreflightInput{
		UserID: "user-1", Provider: "test", Model: "test-dramaip-chat",
		ContextCharacters: 120, MessageCount: 2, MaxTokens: 64,
	})
	if err != nil {
		t.Fatalf("Preflight: %v", err)
	}
	if result.EstimatedTokens != 96 || result.Model.Provider != "test" {
		t.Fatalf("preflight result = %#v", result)
	}
	_, err = uc.Preflight(PreflightInput{UserID: "user-1", Provider: "test", ContextCharacters: 24_001, MessageCount: 1, MaxTokens: 1})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("oversized context error = %v, want InvalidArgument", err)
	}
}
