package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Server      ServerConfig        `yaml:"server"`
	Downstream  DownstreamConfig    `yaml:"downstream"`
	Environment string              `yaml:"environment"`
	MTLS        platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type DownstreamConfig struct {
	AuthEndpoint    string `yaml:"auth_grpc_addr"`
	BillingEndpoint string `yaml:"billing_grpc_addr"`
	QuotaEndpoint   string `yaml:"quota_grpc_addr"`
	DialTimeout     string `yaml:"dial_timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8120"}},
		Downstream:  DownstreamConfig{AuthEndpoint: "localhost:9101", BillingEndpoint: "localhost:9103", QuotaEndpoint: "localhost:9104", DialTimeout: "15s"},
		Environment: "development",
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("MOBILE_BFF_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Downstream.AuthEndpoint = kratosx.Env("AUTH_GRPC_ENDPOINT", cfg.Downstream.AuthEndpoint)
	cfg.Downstream.BillingEndpoint = kratosx.Env("BILLING_GRPC_ENDPOINT", cfg.Downstream.BillingEndpoint)
	cfg.Downstream.QuotaEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Downstream.QuotaEndpoint)
	cfg.Downstream.DialTimeout = kratosx.Env("MOBILE_BFF_GRPC_DIAL_TIMEOUT", cfg.Downstream.DialTimeout)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
