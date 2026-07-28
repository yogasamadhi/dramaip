package data

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/conf"
)

func TestS3PresignUsesPrivatePathAndSignedIntegrityHeaders(t *testing.T) {
	store := NewS3CompatibleStore(&conf.Bootstrap{
		Environment: "test",
		ObjectStore: conf.ObjectStoreConfig{
			Endpoint: "https://objects.example.test", Region: "cn-east-1", Bucket: "private-review",
			AccessKey: "access", SecretKey: "secret",
		},
	})
	signed, err := store.PresignPut("review/workspace/package/media", "video/mp4", strings.Repeat("a", 64), 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(signed.URL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/private-review/review/workspace/package/media" {
		t.Fatalf("unexpected object path %q", parsed.Path)
	}
	if parsed.Query().Get("X-Amz-Signature") == "" || parsed.Query().Get("X-Amz-Expires") != "600" {
		t.Fatalf("missing bounded signature: %s", signed.URL)
	}
	if signed.Headers["content-type"] != "video/mp4" || signed.Headers["x-amz-meta-sha256"] == "" {
		t.Fatalf("integrity headers are not signed: %#v", signed.Headers)
	}
}

func TestS3PresignFailsClosedWithoutCredentials(t *testing.T) {
	store := NewS3CompatibleStore(&conf.Bootstrap{Environment: "production"})
	if _, err := store.PresignGet("review/object", time.Minute); err == nil {
		t.Fatal("expected missing object store credentials to fail closed")
	}
}

func TestS3PresignRejectsLongLivedMediaURL(t *testing.T) {
	store := NewS3CompatibleStore(&conf.Bootstrap{
		Environment: "test",
		ObjectStore: conf.ObjectStoreConfig{
			Endpoint: "https://objects.example.test", Region: "us-east-1", Bucket: "review",
			AccessKey: "access", SecretKey: "secret",
		},
	})
	if _, err := store.presign(http.MethodGet, "review/object", nil, 16*time.Minute); err == nil {
		t.Fatal("expected long-lived signed URL to be rejected")
	}
}
