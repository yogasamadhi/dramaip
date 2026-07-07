package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Server ServerConfig `yaml:"server"`
	Job    JobConfig    `yaml:"jobs"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type JobConfig struct {
	TickInterval string `yaml:"usage_aggregate_interval"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8107"}},
		Job:    JobConfig{TickInterval: "60s"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("QUOTA_JOB_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Job.TickInterval = kratosx.Env("QUOTA_JOB_TICK_INTERVAL", kratosx.Env("QUOTA_JOB_TICK_SECONDS", cfg.Job.TickInterval))
	return cfg, nil
}
