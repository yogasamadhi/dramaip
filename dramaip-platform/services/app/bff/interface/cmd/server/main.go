package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	authConn, err := drpc.Dial(ctx, platform.Env("AUTH_GRPC_ENDPOINT", "localhost:9101"))
	if err != nil {
		log.Fatalf("connect auth: %v", err)
	}
	userConn, err := drpc.Dial(ctx, platform.Env("USER_GRPC_ENDPOINT", "localhost:9102"))
	if err != nil {
		log.Fatalf("connect user: %v", err)
	}
	billingConn, err := drpc.Dial(ctx, platform.Env("BILLING_GRPC_ENDPOINT", "localhost:9103"))
	if err != nil {
		log.Fatalf("connect billing: %v", err)
	}
	quotaConn, err := drpc.Dial(ctx, platform.Env("QUOTA_GRPC_ENDPOINT", "localhost:9104"))
	if err != nil {
		log.Fatalf("connect quota: %v", err)
	}
	aiConn, err := drpc.Dial(ctx, platform.Env("AI_GATEWAY_GRPC_ENDPOINT", "localhost:9105"))
	if err != nil {
		log.Fatalf("connect ai-gateway: %v", err)
	}

	app := newApp(
		drpc.NewAuthServiceClient(authConn),
		drpc.NewUserServiceClient(userConn),
		drpc.NewBillingServiceClient(billingConn),
		drpc.NewQuotaServiceClient(quotaConn),
		drpc.NewAiGatewayServiceClient(aiConn),
	)
	server := &http.Server{
		Addr:              platform.Env("BFF_HTTP_ADDR", "0.0.0.0:8100"),
		Handler:           app.router(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("dramaip bff interface listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("bff interface failed: %v", err)
	}
}
