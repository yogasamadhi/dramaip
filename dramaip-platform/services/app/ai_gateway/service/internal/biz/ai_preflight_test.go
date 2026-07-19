package biz

import (
	"context"
	"strings"
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
		ContextCharacters: 120, MessageCount: 2, MaxTokens: 64, RequestHash: strings.Repeat("a", 43),
	})
	if err != nil {
		t.Fatalf("Preflight: %v", err)
	}
	if result.EstimatedTokens != 96 || result.Model.Provider != "test" {
		t.Fatalf("preflight result = %#v", result)
	}
	_, err = uc.Preflight(PreflightInput{UserID: "user-1", Provider: "test", ContextCharacters: 24_001, MessageCount: 1, MaxTokens: 1, RequestHash: strings.Repeat("a", 43)})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("oversized context error = %v, want InvalidArgument", err)
	}
}

func TestDesktopPreflightRejectsUnboundRequestHash(t *testing.T) {
	uc := NewAiGatewayUsecase(&data.Data{Providers: map[string]data.Provider{"test": {Name: "test", Model: "test-dramaip-chat"}}})
	_, err := uc.Preflight(PreflightInput{UserID: "user-1", Provider: "test", Model: "test-dramaip-chat", ContextCharacters: 12, MessageCount: 1, MaxTokens: 8, RequestHash: "not-a-hash"})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid hash error = %v, want InvalidArgument", err)
	}
}

func TestCloudChatRejectsPayloadThatDoesNotMatchPreflightHash(t *testing.T) {
	uc := NewAiGatewayUsecase(&data.Data{Providers: map[string]data.Provider{"test": {Name: "test", Model: "test-dramaip-chat"}}})
	_, err := uc.Chat(context.Background(), ChatInput{
		UserID: "user-1", Provider: "test", Model: "test-dramaip-chat", MaxTokens: 8,
		Messages:             []ChatMessage{{Role: "user", Content: "this must not call a provider"}},
		PreflightRequestHash: strings.Repeat("a", 43),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("mismatched chat error = %v, want FailedPrecondition", err)
	}
}

func TestDesktopCloudRequestHashHasStableWireFormat(t *testing.T) {
	hash, err := chatRequestHash("test", "test-dramaip-chat", []ChatMessage{
		{Role: "system", Content: "short instruction"},
		{Role: "user", Content: "write one line"},
	}, 32)
	if err != nil {
		t.Fatalf("chatRequestHash: %v", err)
	}
	// This value is also asserted by Desktop's cloudRequestHash test. Keeping a
	// literal here prevents a protocol change in either runtime from silently
	// making an otherwise valid preflight unusable at execution time.
	if hash != "1t8IT5Nm0U1hmv99OBhz4jNMkOT1MbflE_xD6URWdO8" {
		t.Fatalf("request hash = %q", hash)
	}
}
