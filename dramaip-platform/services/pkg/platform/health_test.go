package platform

import (
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNormalizeHealthProbeError(t *testing.T) {
	if err := NormalizeHealthProbeError(status.Error(codes.NotFound, "synthetic subject is absent")); err != nil {
		t.Fatalf("NormalizeHealthProbeError(NotFound) = %v, want nil", err)
	}
	if err := NormalizeHealthProbeError(status.Error(codes.Unavailable, "dependency unavailable")); status.Code(err) != codes.Unavailable {
		t.Fatalf("NormalizeHealthProbeError(Unavailable) = %v, want Unavailable", err)
	}
	plain := errors.New("plain failure")
	if err := NormalizeHealthProbeError(plain); !errors.Is(err, plain) {
		t.Fatalf("NormalizeHealthProbeError(plain) = %v, want original error", err)
	}
}
