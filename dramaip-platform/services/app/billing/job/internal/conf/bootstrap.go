package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Environment string              `yaml:"environment"`
	Server      ServerConfig        `yaml:"server"`
	Job         JobConfig           `yaml:"jobs"`
	Quota       QuotaConfig         `yaml:"quota"`
	MTLS        platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type JobConfig struct {
	OutboxRelayInterval string `yaml:"outbox_relay_interval"`
	OutboxBatchSize     int    `yaml:"outbox_batch_size"`
}

type QuotaConfig struct {
	GRPCEndpoint string `yaml:"grpc_addr"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Environment: "dev",
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8106"}},
		Job:         JobConfig{OutboxRelayInterval: "1s", OutboxBatchSize: 100},
		Quota:       QuotaConfig{GRPCEndpoint: "localhost:9104"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("BILLING_JOB_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Job.OutboxRelayInterval = kratosx.Env("OUTBOX_POLL_INTERVAL", kratosx.Env("OUTBOX_POLL_INTERVAL_MS", cfg.Job.OutboxRelayInterval))
	cfg.Job.OutboxBatchSize = kratosx.EnvInt("OUTBOX_BATCH_SIZE", cfg.Job.OutboxBatchSize)
	cfg.Quota.GRPCEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Quota.GRPCEndpoint)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
