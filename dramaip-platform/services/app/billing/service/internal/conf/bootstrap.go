package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Env     string              `yaml:"env"`
	Server  ServerConfig        `yaml:"server"`
	Payment PaymentConfig       `yaml:"payment"`
	Quota   QuotaConfig         `yaml:"quota"`
	MTLS    platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type PaymentConfig struct {
	SimulatedEnabled bool `yaml:"simulated_enabled"`
}

type QuotaConfig struct {
	GRPCEndpoint string `yaml:"grpc_addr"`
	DialTimeout  string `yaml:"dial_timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Env: "dev",
		Server: ServerConfig{
			HTTP: EndpointConfig{Addr: ":8103"},
			GRPC: EndpointConfig{Addr: ":9103"},
		},
		Payment: PaymentConfig{SimulatedEnabled: true},
		Quota:   QuotaConfig{GRPCEndpoint: "localhost:9104", DialTimeout: "10s"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Env = kratosx.Env("ENV", cfg.Env)
	cfg.Server.HTTP.Addr = kratosx.Env("BILLING_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("BILLING_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Quota.GRPCEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Quota.GRPCEndpoint)
	cfg.Quota.DialTimeout = kratosx.Env("BILLING_QUOTA_DIAL_TIMEOUT", cfg.Quota.DialTimeout)
	cfg.Payment.SimulatedEnabled = kratosx.EnvBool("BILLING_SIMULATED_ENABLED", cfg.Payment.SimulatedEnabled)
	if cfg.Env != "dev" && cfg.Env != "test" {
		cfg.Payment.SimulatedEnabled = false
	}
	mtls, err := platform.LoadMTLSConfig(cfg.Env)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
