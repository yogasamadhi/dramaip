package platform

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"testing"

	"github.com/go-kratos/kratos/v2/middleware"
	"github.com/go-kratos/kratos/v2/transport"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

func TestProductionMTLSConfigurationFailsClosed(t *testing.T) {
	t.Setenv("GRPC_MTLS_ENABLED", "false")
	if _, err := LoadMTLSConfig("production"); err == nil {
		t.Fatal("production accepted disabled mTLS")
	}
	if _, err := LoadMTLSConfig("staging"); err == nil {
		t.Fatal("unknown deployment environment accepted disabled mTLS")
	}
	t.Setenv("GRPC_MTLS_ENABLED", "true")
	t.Setenv("GRPC_MTLS_CERT_FILE", "")
	t.Setenv("GRPC_MTLS_KEY_FILE", "")
	t.Setenv("GRPC_MTLS_CA_FILE", "")
	if _, err := LoadMTLSConfig("production"); err == nil {
		t.Fatal("production accepted missing mTLS material")
	}
}

func TestGRPCPeerAuthorizationRejectsUntrustedCaller(t *testing.T) {
	middleware := GRPCPeerAuthorization(MTLSConfig{Enabled: true}, "web-bff")
	next := func(ctx context.Context, _ any) (any, error) { return "ok", nil }

	validContext := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{State: tls.ConnectionState{PeerCertificates: []*x509.Certificate{{Subject: pkix.Name{CommonName: "web-bff"}}}}}})
	if reply, err := middleware(next)(validContext, nil); err != nil || reply != "ok" {
		t.Fatalf("valid mTLS caller reply=%v err=%v", reply, err)
	}

	wrongContext := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{State: tls.ConnectionState{PeerCertificates: []*x509.Certificate{{Subject: pkix.Name{CommonName: "billing-service"}}}}}})
	if _, err := middleware(next)(wrongContext, nil); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("wrong caller error=%v, want permission denied", err)
	}
	if _, err := middleware(next)(context.Background(), nil); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("missing mTLS error=%v, want unauthenticated", err)
	}
}

func TestGRPCUserIdentityPropagationEnforcesOwnership(t *testing.T) {
	ctx := transport.NewServerContext(context.Background(), testTransport{header: testHeader{userIdentityMetadataKey: "user-a"}})
	propagate := GRPCUserIdentityPropagation(MTLSConfig{Enabled: true})
	_, err := propagate(func(ctx context.Context, _ any) (any, error) {
		if err := RequireUserIdentity(ctx, "user-a"); err != nil {
			return nil, err
		}
		return nil, RequireUserIdentity(ctx, "user-b")
	})(ctx, nil)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("cross-user request error=%v, want permission denied", err)
	}

	if err := RequireUserIdentity(context.Background(), "user-a"); err != nil {
		t.Fatalf("development context should remain compatible: %v", err)
	}
}

func TestUnaryClientUserIdentityInterceptorPropagatesOnlyContextIdentity(t *testing.T) {
	ctx := WithUserIdentity(context.Background(), "user-a")
	err := unaryClientUserIdentityInterceptor(ctx, "/test", nil, nil, nil, func(ctx context.Context, _ string, _ any, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		metadata, ok := metadata.FromOutgoingContext(ctx)
		if !ok || metadata.Get(userIdentityMetadataKey)[0] != "user-a" {
			t.Fatalf("outgoing metadata = %v", metadata)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("interceptor: %v", err)
	}
}

type testHeader map[string]string

func (h testHeader) Get(key string) string        { return h[key] }
func (h testHeader) Set(key string, value string) { h[key] = value }
func (h testHeader) Add(key string, value string) { h[key] = value }
func (h testHeader) Keys() []string               { return nil }
func (h testHeader) Values(key string) []string   { return []string{h[key]} }

type testTransport struct{ header transport.Header }

func (testTransport) Kind() transport.Kind              { return transport.KindGRPC }
func (testTransport) Endpoint() string                  { return "grpc://test" }
func (testTransport) Operation() string                 { return "/test" }
func (t testTransport) RequestHeader() transport.Header { return t.header }
func (testTransport) ReplyHeader() transport.Header     { return testHeader{} }

var _ middleware.Middleware = GRPCPeerAuthorization(MTLSConfig{})
var _ = metadata.MD{}
