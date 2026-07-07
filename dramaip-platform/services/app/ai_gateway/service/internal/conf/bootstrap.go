package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Env    string       `yaml:"env"`
	Server ServerConfig `yaml:"server"`
	Quota  QuotaConfig  `yaml:"quota"`
	AI     AIConfig     `yaml:"llm"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type QuotaConfig struct {
	GRPCEndpoint string `yaml:"grpc_addr"`
}

type AIConfig struct {
	DefaultProvider     string `yaml:"default_provider"`
	Providers           string `yaml:"providers"`
	BaseURL             string `yaml:"base_url"`
	APIKey              string `yaml:"api_key"`
	DefaultModel        string `yaml:"default_model"`
	Timeout             string `yaml:"timeout"`
	TestProviderEnabled bool   `yaml:"test_provider_enabled"`
	UserRPMLimit        int    `yaml:"user_rpm_limit"`
	UserDailyTokenLimit int    `yaml:"user_daily_token_limit"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Env: "dev",
		Server: ServerConfig{
			HTTP: EndpointConfig{Addr: ":8105"},
			GRPC: EndpointConfig{Addr: ":9105"},
		},
		Quota: QuotaConfig{GRPCEndpoint: "localhost:9104"},
		AI: AIConfig{
			DefaultProvider:     "openai-compatible",
			Providers:           "openai-compatible",
			BaseURL:             "https://api.openai.com/v1",
			DefaultModel:        "gpt-4o-mini",
			Timeout:             "90s",
			TestProviderEnabled: true,
			UserRPMLimit:        60,
			UserDailyTokenLimit: 2000000,
		},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Env = kratosx.Env("ENV", cfg.Env)
	cfg.Server.HTTP.Addr = kratosx.Env("AI_GATEWAY_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("AI_GATEWAY_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Quota.GRPCEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Quota.GRPCEndpoint)
	cfg.AI.DefaultProvider = kratosx.Env("AI_PROVIDER_DEFAULT", kratosx.Env("AI_DEFAULT_PROVIDER", cfg.AI.DefaultProvider))
	cfg.AI.Providers = kratosx.Env("AI_PROVIDERS", cfg.AI.DefaultProvider)
	cfg.AI.BaseURL = kratosx.Env("AI_PROVIDER_BASE_URL", cfg.AI.BaseURL)
	cfg.AI.APIKey = kratosx.Env("AI_PROVIDER_API_KEY", cfg.AI.APIKey)
	cfg.AI.DefaultModel = kratosx.Env("AI_DEFAULT_MODEL", cfg.AI.DefaultModel)
	cfg.AI.Timeout = kratosx.Env("AI_PROVIDER_TIMEOUT", kratosx.Env("AI_PROVIDER_TIMEOUT_SECONDS", cfg.AI.Timeout))
	cfg.AI.TestProviderEnabled = kratosx.EnvBool("AI_TEST_PROVIDER_ENABLED", cfg.Env == "dev" || cfg.Env == "test")
	cfg.AI.UserRPMLimit = kratosx.EnvInt("AI_USER_RPM_LIMIT", cfg.AI.UserRPMLimit)
	cfg.AI.UserDailyTokenLimit = kratosx.EnvInt("AI_USER_DAILY_TOKEN_LIMIT", cfg.AI.UserDailyTokenLimit)
	return cfg, nil
}
