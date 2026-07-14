package platform

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// NormalizeHealthProbeError treats NotFound from a deliberately synthetic
// dependency probe as successful reachability. The request has reached and
// been handled by the downstream service; its test subject is intentionally
// absent. All other errors still make the dependency unhealthy.
func NormalizeHealthProbeError(err error) error {
	if status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}
