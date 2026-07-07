package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Server ServerConfig `yaml:"server"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8102"}, GRPC: EndpointConfig{Addr: ":9102"}}}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("USER_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("USER_GRPC_ADDR", cfg.Server.GRPC.Addr)
	return cfg, nil
}
