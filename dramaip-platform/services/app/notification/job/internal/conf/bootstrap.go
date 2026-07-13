package conf

import (
	"strings"

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
	ConsumerQueue      string   `yaml:"consumer_queue"`
	DeadLetterExchange string   `yaml:"dead_letter_exchange"`
	DeadLetterQueue    string   `yaml:"dead_letter_queue"`
	ConsumerPrefetch   int      `yaml:"consumer_prefetch"`
	MaxRetries         int      `yaml:"max_retries"`
	InboxLease         string   `yaml:"inbox_lease"`
	Channels           []string `yaml:"channels"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Environment: "dev",
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8109"}},
		Job: JobConfig{
			ConsumerQueue: "dramaip.notification.events", DeadLetterExchange: "dramaip.platform.events.dlx",
			DeadLetterQueue: "dramaip.notification.events.dlq", ConsumerPrefetch: 1, MaxRetries: 3,
			InboxLease: "1m", Channels: []string{"in_app"},
		},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Server.HTTP.Addr = kratosx.Env("NOTIFICATION_JOB_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Job.ConsumerQueue = kratosx.Env("NOTIFICATION_EVENTS_QUEUE", cfg.Job.ConsumerQueue)
	cfg.Job.DeadLetterExchange = kratosx.Env("NOTIFICATION_DLQ_EXCHANGE", cfg.Job.DeadLetterExchange)
	cfg.Job.DeadLetterQueue = kratosx.Env("NOTIFICATION_DLQ_QUEUE", cfg.Job.DeadLetterQueue)
	cfg.Job.ConsumerPrefetch = kratosx.EnvInt("NOTIFICATION_EVENT_PREFETCH", cfg.Job.ConsumerPrefetch)
	cfg.Job.MaxRetries = kratosx.EnvInt("NOTIFICATION_EVENT_MAX_RETRIES", cfg.Job.MaxRetries)
	cfg.Job.InboxLease = kratosx.Env("NOTIFICATION_INBOX_LEASE", cfg.Job.InboxLease)
	if channels := kratosx.Env("NOTIFICATION_CHANNELS", ""); channels != "" {
		cfg.Job.Channels = strings.Split(channels, ",")
	}
	return cfg, nil
}
