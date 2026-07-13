package platform

import (
	"context"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

func ServeGRPC(addr string, register func(*grpc.Server)) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	server := grpc.NewServer(grpc.ChainUnaryInterceptor(
		UnaryServerTraceInterceptor(Env("OTEL_SERVICE_NAME", "dramaip-grpc")),
		UnaryServerDeadlineInterceptor(),
	))
	register(server)
	StructuredLog(context.Background(), Env("OTEL_SERVICE_NAME", "dramaip-grpc"), "info", "grpc_listening", map[string]any{"address": addr})
	return server.Serve(listener)
}

func DialGRPC(ctx context.Context, target string, mtls MTLSConfig) (*grpc.ClientConn, error) {
	transportCredentials := credentials.TransportCredentials(insecure.NewCredentials())
	if mtls.Enabled {
		tlsConfig, err := mtls.ClientTLSConfig()
		if err != nil {
			return nil, err
		}
		transportCredentials = credentials.NewTLS(tlsConfig)
	}
	return grpc.DialContext(
		ctx,
		target,
		grpc.WithBlock(),
		grpc.WithTransportCredentials(transportCredentials),
		grpc.WithChainUnaryInterceptor(
			UnaryClientTraceInterceptor(Env("OTEL_SERVICE_NAME", "dramaip-client")),
			unaryClientUserIdentityInterceptor,
			UnaryClientResilienceInterceptor(target),
		),
	)
}

func unaryClientUserIdentityInterceptor(ctx context.Context, method string, req any, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	if userID := UserIdentity(ctx); userID != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, userIdentityMetadataKey, userID)
	}
	return invoker(ctx, method, req, reply, cc, opts...)
}
