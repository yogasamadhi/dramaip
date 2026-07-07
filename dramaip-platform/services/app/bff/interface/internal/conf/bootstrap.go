package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Server     ServerConfig     `yaml:"server"`
	Downstream DownstreamConfig `yaml:"downstream"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type DownstreamConfig struct {
	AuthEndpoint      string `yaml:"auth_grpc_addr"`
	UserEndpoint      string `yaml:"user_grpc_addr"`
	BillingEndpoint   string `yaml:"billing_grpc_addr"`
	QuotaEndpoint     string `yaml:"quota_grpc_addr"`
	AIGatewayEndpoint string `yaml:"ai_gateway_grpc_addr"`
	DialTimeout       string `yaml:"dial_timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8100"}},
		Downstream: DownstreamConfig{
			AuthEndpoint:      "localhost:9101",
			UserEndpoint:      "localhost:9102",
			BillingEndpoint:   "localhost:9103",
			QuotaEndpoint:     "localhost:9104",
			AIGatewayEndpoint: "localhost:9105",
			DialTimeout:       "15s",
		},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("BFF_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Downstream.AuthEndpoint = kratosx.Env("AUTH_GRPC_ENDPOINT", cfg.Downstream.AuthEndpoint)
	cfg.Downstream.UserEndpoint = kratosx.Env("USER_GRPC_ENDPOINT", cfg.Downstream.UserEndpoint)
	cfg.Downstream.BillingEndpoint = kratosx.Env("BILLING_GRPC_ENDPOINT", cfg.Downstream.BillingEndpoint)
	cfg.Downstream.QuotaEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Downstream.QuotaEndpoint)
	cfg.Downstream.AIGatewayEndpoint = kratosx.Env("AI_GATEWAY_GRPC_ENDPOINT", cfg.Downstream.AIGatewayEndpoint)
	cfg.Downstream.DialTimeout = kratosx.Env("BFF_GRPC_DIAL_TIMEOUT", cfg.Downstream.DialTimeout)
	return cfg, nil
}
