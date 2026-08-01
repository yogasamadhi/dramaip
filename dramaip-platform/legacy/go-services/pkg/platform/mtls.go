package platform

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/go-kratos/kratos/v3/middleware"
	"github.com/go-kratos/kratos/v3/transport"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const userIdentityMetadataKey = "x-dramaip-user-id"

// MTLSConfig holds the client and server material used for internal gRPC
// calls. It is deliberately file-based so production keys and certificates
// remain outside application configuration and the repository.
type MTLSConfig struct {
	Enabled  bool
	CertFile string
	KeyFile  string
	CAFile   string
}

func LoadMTLSConfig(environment string) (MTLSConfig, error) {
	required := productionEnvironment(environment)
	enabled := required
	if raw := strings.TrimSpace(Env("GRPC_MTLS_ENABLED", "")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return MTLSConfig{}, fmt.Errorf("parse GRPC_MTLS_ENABLED: %w", err)
		}
		enabled = parsed
	}
	cfg := MTLSConfig{
		Enabled:  enabled,
		CertFile: strings.TrimSpace(Env("GRPC_MTLS_CERT_FILE", "")),
		KeyFile:  strings.TrimSpace(Env("GRPC_MTLS_KEY_FILE", "")),
		CAFile:   strings.TrimSpace(Env("GRPC_MTLS_CA_FILE", "")),
	}
	if required && !cfg.Enabled {
		return MTLSConfig{}, fmt.Errorf("production requires GRPC_MTLS_ENABLED=true")
	}
	if cfg.Enabled && (cfg.CertFile == "" || cfg.KeyFile == "" || cfg.CAFile == "") {
		return MTLSConfig{}, fmt.Errorf("gRPC mTLS requires certificate, key, and CA files")
	}
	return cfg, nil
}

func (c MTLSConfig) ClientTLSConfig() (*tls.Config, error) {
	if !c.Enabled {
		return nil, nil
	}
	certificate, pool, err := c.loadMaterial()
	if err != nil {
		return nil, err
	}
	return &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}, RootCAs: pool}, nil
}

func (c MTLSConfig) ServerTLSConfig() (*tls.Config, error) {
	if !c.Enabled {
		return nil, nil
	}
	certificate, pool, err := c.loadMaterial()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}, nil
}

func (c MTLSConfig) loadMaterial() (tls.Certificate, *x509.CertPool, error) {
	certificate, err := tls.LoadX509KeyPair(c.CertFile, c.KeyFile)
	if err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("load gRPC mTLS certificate: %w", err)
	}
	rawCA, err := os.ReadFile(c.CAFile)
	if err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("read gRPC mTLS CA: %w", err)
	}
	if block, _ := pem.Decode(rawCA); block == nil {
		return tls.Certificate{}, nil, fmt.Errorf("gRPC mTLS CA is not PEM")
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(rawCA) {
		return tls.Certificate{}, nil, fmt.Errorf("load gRPC mTLS CA")
	}
	return certificate, pool, nil
}

// GRPCPeerAuthorization accepts only the listed mTLS client certificate common
// names. In development, disabled mTLS deliberately leaves the local stack
// runnable; production configuration cannot disable it.
func GRPCPeerAuthorization(cfg MTLSConfig, allowedCallers ...string) middleware.Middleware {
	allowed := make(map[string]struct{}, len(allowedCallers))
	for _, caller := range allowedCallers {
		if caller = strings.TrimSpace(caller); caller != "" {
			allowed[caller] = struct{}{}
		}
	}
	return func(next middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (any, error) {
			if !cfg.Enabled {
				return next(ctx, req)
			}
			principal, err := mtlsPrincipal(ctx)
			if err != nil {
				return nil, err
			}
			if _, ok := allowed[principal]; !ok {
				return nil, status.Error(codes.PermissionDenied, "internal caller is not authorized")
			}
			return next(ctx, req)
		}
	}
}

func mtlsPrincipal(ctx context.Context) (string, error) {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "missing internal mTLS peer")
	}
	tlsInfo, ok := peerInfo.AuthInfo.(credentials.TLSInfo)
	if !ok || len(tlsInfo.State.PeerCertificates) == 0 {
		return "", status.Error(codes.Unauthenticated, "missing internal client certificate")
	}
	commonName := strings.TrimSpace(tlsInfo.State.PeerCertificates[0].Subject.CommonName)
	if commonName == "" {
		return "", status.Error(codes.Unauthenticated, "internal client certificate has no common name")
	}
	return commonName, nil
}

// RequireInternalPeer narrows a sensitive RPC to the listed mTLS principals.
// It is intentionally a no-op in development when mTLS is disabled, matching
// GRPCPeerAuthorization; production always has the internal security marker.
func RequireInternalPeer(ctx context.Context, allowedCallers ...string) error {
	if secured, _ := ctx.Value(internalSecurityContextKey{}).(bool); !secured {
		return nil
	}
	principal, err := mtlsPrincipal(ctx)
	if err != nil {
		return err
	}
	for _, allowed := range allowedCallers {
		if principal == strings.TrimSpace(allowed) && principal != "" {
			return nil
		}
	}
	return status.Error(codes.PermissionDenied, "internal caller is not authorized for this operation")
}

type userIdentityContextKey struct{}
type internalSecurityContextKey struct{}

func WithUserIdentity(ctx context.Context, userID string) context.Context {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ctx
	}
	return context.WithValue(ctx, userIdentityContextKey{}, userID)
}

func UserIdentity(ctx context.Context) string {
	userID, _ := ctx.Value(userIdentityContextKey{}).(string)
	return userID
}

// GRPCUserIdentityPropagation only trusts the metadata after the mTLS caller
// check. It deliberately does nothing in development, where mTLS is opt-in.
func GRPCUserIdentityPropagation(cfg MTLSConfig) middleware.Middleware {
	return func(next middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (any, error) {
			if !cfg.Enabled {
				return next(ctx, req)
			}
			userID := ""
			if tr, ok := transport.FromServerContext(ctx); ok {
				userID = strings.TrimSpace(tr.RequestHeader().Get(userIdentityMetadataKey))
			}
			ctx = context.WithValue(ctx, internalSecurityContextKey{}, true)
			if userID != "" {
				ctx = WithUserIdentity(ctx, userID)
			}
			return next(ctx, req)
		}
	}
}

func RequireUserIdentity(ctx context.Context, requestedUserID string) error {
	enabled, _ := ctx.Value(internalSecurityContextKey{}).(bool)
	if !enabled {
		return nil
	}
	if requestedUserID == "" || UserIdentity(ctx) == "" || UserIdentity(ctx) != requestedUserID {
		return status.Error(codes.PermissionDenied, "requested user is not owned by authenticated principal")
	}
	return nil
}

func productionEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "dev", "development", "local", "test":
		return false
	default:
		// An unknown deployment environment must not silently downgrade
		// service-to-service traffic to plaintext.
		return true
	}
}
