package platform

import (
	"log"
	"net"

	"google.golang.org/grpc"
)

func ServeGRPC(addr string, register func(*grpc.Server)) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	server := grpc.NewServer()
	register(server)
	log.Printf("gRPC listening on %s", addr)
	return server.Serve(listener)
}
