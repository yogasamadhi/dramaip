package platform

import (
	"context"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func ServeGRPC(addr string, register func(*grpc.Server)) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	server := grpc.NewServer(grpc.UnaryInterceptor(UnaryServerTraceInterceptor(Env("OTEL_SERVICE_NAME", "dramaip-grpc"))))
	register(server)
	log.Printf("gRPC listening on %s", addr)
	return server.Serve(listener)
}

func DialGRPC(ctx context.Context, target string) (*grpc.ClientConn, error) {
	return grpc.DialContext(
		ctx,
		target,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(UnaryClientTraceInterceptor(Env("OTEL_SERVICE_NAME", "dramaip-client"))),
	)
}
