package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
)

type Bootstrap struct {
	Environment string       `yaml:"environment"`
	Server      ServerConfig `yaml:"server"`
	Job         JobConfig    `yaml:"jobs"`
}
type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}
type EndpointConfig struct {
	Addr string `yaml:"addr"`
}
type JobConfig struct {
	ConsumerQueue      string `yaml:"consumer_queue"`
	DeadLetterExchange string `yaml:"dead_letter_exchange"`
	DeadLetterQueue    string `yaml:"dead_letter_queue"`
	ConsumerPrefetch   int    `yaml:"consumer_prefetch"`
	MaxRetries         int    `yaml:"max_retries"`
	RebuildOnStart     bool   `yaml:"rebuild_on_start"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{Environment: "development", Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8113"}}, Job: JobConfig{ConsumerQueue: "dramaip.reporting.events", DeadLetterExchange: "dramaip.platform.events.dlx", DeadLetterQueue: "dramaip.reporting.events.dlq", ConsumerPrefetch: 10, MaxRetries: 3}}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Server.HTTP.Addr = kratosx.Env("REPORTING_JOB_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Job.ConsumerQueue = kratosx.Env("REPORTING_EVENTS_QUEUE", cfg.Job.ConsumerQueue)
	cfg.Job.DeadLetterExchange = kratosx.Env("REPORTING_DLQ_EXCHANGE", cfg.Job.DeadLetterExchange)
	cfg.Job.DeadLetterQueue = kratosx.Env("REPORTING_DLQ_QUEUE", cfg.Job.DeadLetterQueue)
	cfg.Job.ConsumerPrefetch = kratosx.EnvInt("REPORTING_EVENT_PREFETCH", cfg.Job.ConsumerPrefetch)
	cfg.Job.MaxRetries = kratosx.EnvInt("REPORTING_EVENT_MAX_RETRIES", cfg.Job.MaxRetries)
	cfg.Job.RebuildOnStart = kratosx.EnvBool("REPORTING_REBUILD_ON_START", cfg.Job.RebuildOnStart)
	return cfg, nil
}
