package platform

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func TestRedisPingAndCommand(t *testing.T) {
	server := miniredis.RunT(t)
	client := NewRedis(RedisConfig{Addr: server.Addr()})
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := client.Ping(ctx); err != nil {
		t.Fatalf("Ping() error = %v", err)
	}
	if got, err := client.Command(ctx, "SETEX", "session:test", "60", "user-1"); err != nil || got != "OK" {
		t.Fatalf("SETEX = %q, %v", got, err)
	}
	if got, err := client.Command(ctx, "GET", "session:test"); err != nil || got != "user-1" {
		t.Fatalf("GET = %q, %v", got, err)
	}
}

func TestRedisConfigFromEnv(t *testing.T) {
	t.Setenv("REDIS_ADDR", "redis:6379")
	t.Setenv("REDIS_PASSWORD", "secret")
	t.Setenv("REDIS_DB", "3")

	config := RedisConfigFromEnv()
	if config.Addr != "redis:6379" || config.Password != "secret" || config.DB != 3 {
		t.Fatalf("RedisConfigFromEnv() = %+v", config)
	}
}

func TestRedisPasswordAndDB(t *testing.T) {
	server := miniredis.RunT(t)
	server.RequireAuth("secret")
	client := NewRedis(RedisConfig{Addr: server.Addr(), Password: "secret", DB: 3})
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if got, err := client.Command(ctx, "SET", "scoped", "value"); err != nil || got != "OK" {
		t.Fatalf("SET = %q, %v", got, err)
	}
	server.Select(3)
	if !server.Exists("scoped") {
		t.Fatalf("expected key in selected database")
	}
}

func TestRedisCommandRequiresArguments(t *testing.T) {
	server := miniredis.RunT(t)
	client := NewRedis(RedisConfig{Addr: server.Addr()})
	defer client.Close()

	if _, err := client.Command(context.Background()); err == nil {
		t.Fatalf("Command() expected error")
	}
}
