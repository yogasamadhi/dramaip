package platform

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type Redis struct {
	client *redis.Client
}

func RedisConfigFromEnv() RedisConfig {
	return RedisConfig{
		Addr:     Env("REDIS_ADDR", "localhost:6379"),
		Password: Env("REDIS_PASSWORD", "dramaip"),
		DB:       EnvInt("REDIS_DB", 0),
	}
}

func NewRedis(config RedisConfig) *Redis {
	return &Redis{client: redis.NewClient(&redis.Options{
		Addr:     config.Addr,
		Password: config.Password,
		DB:       config.DB,
	})}
}

func (r *Redis) Ping(ctx context.Context) error {
	return r.client.Ping(ctx).Err()
}

func (r *Redis) Command(ctx context.Context, args ...string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("redis command requires at least one argument")
	}
	values := make([]any, len(args))
	for i, arg := range args {
		values[i] = arg
	}
	result, err := r.client.Do(ctx, values...).Result()
	if err != nil {
		return "", err
	}
	return fmt.Sprint(result), nil
}

func (r *Redis) Close() error {
	return r.client.Close()
}
