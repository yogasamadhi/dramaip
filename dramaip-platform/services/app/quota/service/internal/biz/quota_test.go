package biz

import (
	"context"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/quota/service/internal/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreatePeriodAccountRejectsIncompleteSnapshot(t *testing.T) {
	uc := &QuotaUsecase{}
	_, err := uc.CreatePeriodAccount(context.Background(), data.CreatePeriodAccountInput{
		UserID: "user", SubscriptionID: "subscription", PlanCode: "basic", QuotaTokens: 100,
		PlanSnapshotSource: "checkout",
		PeriodStart:        "2026-07-01T00:00:00Z", PeriodEnd: "2026-08-01T00:00:00Z",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("CreatePeriodAccount() error = %v, want InvalidArgument", err)
	}
}

func TestLegacyCompatibleSnapshotMarksFallback(t *testing.T) {
	got := legacyCompatibleSnapshot(data.CreatePeriodAccountInput{PlanCode: "basic", QuotaTokens: 100})
	if got.PlanSnapshotSource != "legacy_compat" || got.PlanName != "Legacy plan" || got.PlanSnapshotAt == "" {
		t.Fatalf("legacyCompatibleSnapshot() = %#v", got)
	}
}
