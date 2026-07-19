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
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type JobConfig struct {
	OutboxRelayInterval     string `yaml:"outbox_relay_interval"`
	OutboxBatchSize         int    `yaml:"outbox_batch_size"`
	OutboxLease             string `yaml:"outbox_lease"`
	OutboxRetryDelay        string `yaml:"outbox_retry_delay"`
	OperationTimeout        string `yaml:"operation_timeout"`
	ReconciliationEnabled   bool   `yaml:"reconciliation_enabled"`
	ReconciliationInterval  string `yaml:"reconciliation_interval"`
	ReconciliationBatchSize int    `yaml:"reconciliation_batch_size"`
}

type QuotaConfig struct {
	GRPCEndpoint string `yaml:"grpc_addr"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Environment: "dev",
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8106"}, GRPC: EndpointConfig{Addr: ":9110"}},
		Job:         JobConfig{OutboxRelayInterval: "1s", OutboxBatchSize: 100, OutboxLease: "30s", OutboxRetryDelay: "5s", OperationTimeout: "30s", ReconciliationEnabled: true, ReconciliationInterval: "1h", ReconciliationBatchSize: 100},
		Quota:       QuotaConfig{GRPCEndpoint: "localhost:9104"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("BILLING_JOB_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("BILLING_JOB_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Job.OutboxRelayInterval = kratosx.Env("OUTBOX_POLL_INTERVAL", kratosx.Env("OUTBOX_POLL_INTERVAL_MS", cfg.Job.OutboxRelayInterval))
	cfg.Job.OutboxBatchSize = kratosx.EnvInt("OUTBOX_BATCH_SIZE", cfg.Job.OutboxBatchSize)
	cfg.Job.OutboxLease = kratosx.Env("OUTBOX_LEASE", cfg.Job.OutboxLease)
	cfg.Job.OutboxRetryDelay = kratosx.Env("OUTBOX_RETRY_DELAY", cfg.Job.OutboxRetryDelay)
	cfg.Job.OperationTimeout = kratosx.Env("BILLING_JOB_OPERATION_TIMEOUT", cfg.Job.OperationTimeout)
	cfg.Job.ReconciliationEnabled = kratosx.EnvBool("BILLING_RECONCILIATION_ENABLED", cfg.Job.ReconciliationEnabled)
	cfg.Job.ReconciliationInterval = kratosx.Env("BILLING_RECONCILIATION_INTERVAL", cfg.Job.ReconciliationInterval)
	cfg.Job.ReconciliationBatchSize = kratosx.EnvInt("BILLING_RECONCILIATION_BATCH_SIZE", cfg.Job.ReconciliationBatchSize)
	cfg.Quota.GRPCEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Quota.GRPCEndpoint)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
