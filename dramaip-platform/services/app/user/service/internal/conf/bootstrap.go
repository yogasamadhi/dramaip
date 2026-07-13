package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Environment string              `yaml:"environment"`
	Server      ServerConfig        `yaml:"server"`
	MTLS        platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{Environment: "dev", Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8102"}, GRPC: EndpointConfig{Addr: ":9102"}}}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("USER_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("USER_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
