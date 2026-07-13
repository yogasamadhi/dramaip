package server

import (
	"fmt"

	"net/http"

	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	authbiz "github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	authsvc "github.com/dramaip/dramaip-platform/services/app/auth/service/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	kgrpc "github.com/go-kratos/kratos/v2/transport/grpc"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
)

func NewGRPCServer(cfg *conf.Bootstrap, svc *authsvc.AuthService) *kgrpc.Server {
	options := []kgrpc.ServerOption{
		kgrpc.Address(cfg.Server.GRPC.Addr),
		kgrpc.Middleware(recovery.Recovery(), platform.GRPCPeerAuthorization(cfg.MTLS, "web-bff", "desktop-bff", "mobile-bff"), platform.GRPCUserIdentityPropagation(cfg.MTLS), kratosx.TraceMiddleware("auth-service")),
	}
	if tlsConfig, err := cfg.MTLS.ServerTLSConfig(); err != nil {
		panic(fmt.Sprintf("auth gRPC mTLS: %v", err))
	} else if tlsConfig != nil {
		options = append(options, kgrpc.TLSConfig(tlsConfig))
	}
	server := kgrpc.NewServer(options...)
	authv1.RegisterAuthServiceServer(server.Server, svc)
	return server
}

func NewHTTPServer(cfg *conf.Bootstrap, uc *authbiz.AuthUsecase) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("auth-service")),
	)
	kratosx.RegisterHealth(server, "auth-service", uc.Checks())
	server.HandleFunc("/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Content-Type", "application/jwk-set+json")
		_, _ = w.Write(uc.JWKS())
	})
	return server
}
