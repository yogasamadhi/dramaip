package conf

import (
	"strings"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Server      ServerConfig        `yaml:"server"`
	Downstream  DownstreamConfig    `yaml:"downstream"`
	Environment string              `yaml:"environment"`
	Session     SessionConfig       `yaml:"session"`
	MTLS        platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type DownstreamConfig struct {
	AuthEndpoint         string `yaml:"auth_grpc_addr"`
	UserEndpoint         string `yaml:"user_grpc_addr"`
	BillingEndpoint      string `yaml:"billing_grpc_addr"`
	QuotaEndpoint        string `yaml:"quota_grpc_addr"`
	AIGatewayEndpoint    string `yaml:"ai_gateway_grpc_addr"`
	NotificationEndpoint string `yaml:"notification_grpc_addr"`
	ReviewEndpoint       string `yaml:"review_grpc_addr"`
	DialTimeout          string `yaml:"dial_timeout"`
}

type SessionConfig struct {
	RefreshCookieTTL string `yaml:"refresh_cookie_ttl"`
	CookieDomain     string `yaml:"cookie_domain"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server: ServerConfig{HTTP: EndpointConfig{Addr: ":8100"}},
		Downstream: DownstreamConfig{
			AuthEndpoint:         "localhost:9101",
			UserEndpoint:         "localhost:9102",
			BillingEndpoint:      "localhost:9103",
			QuotaEndpoint:        "localhost:9104",
			AIGatewayEndpoint:    "localhost:9105",
			NotificationEndpoint: "localhost:9106",
			ReviewEndpoint:       "localhost:9112",
			DialTimeout:          "15s",
		},
		Environment: "development",
		Session:     SessionConfig{RefreshCookieTTL: "720h"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("WEB_BFF_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Session.RefreshCookieTTL = kratosx.Env("WEB_REFRESH_COOKIE_TTL", cfg.Session.RefreshCookieTTL)
	cfg.Session.CookieDomain = kratosx.Env("WEB_COOKIE_DOMAIN", cfg.Session.CookieDomain)
	cfg.Downstream.AuthEndpoint = kratosx.Env("AUTH_GRPC_ENDPOINT", cfg.Downstream.AuthEndpoint)
	cfg.Downstream.UserEndpoint = kratosx.Env("USER_GRPC_ENDPOINT", cfg.Downstream.UserEndpoint)
	cfg.Downstream.BillingEndpoint = kratosx.Env("BILLING_GRPC_ENDPOINT", cfg.Downstream.BillingEndpoint)
	cfg.Downstream.QuotaEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Downstream.QuotaEndpoint)
	cfg.Downstream.AIGatewayEndpoint = kratosx.Env("AI_GATEWAY_GRPC_ENDPOINT", cfg.Downstream.AIGatewayEndpoint)
	cfg.Downstream.NotificationEndpoint = kratosx.Env("NOTIFICATION_GRPC_ENDPOINT", cfg.Downstream.NotificationEndpoint)
	cfg.Downstream.ReviewEndpoint = kratosx.Env("REVIEW_GRPC_ENDPOINT", cfg.Downstream.ReviewEndpoint)
	cfg.Downstream.DialTimeout = kratosx.Env("WEB_BFF_GRPC_DIAL_TIMEOUT", cfg.Downstream.DialTimeout)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}

func (c *Bootstrap) CookiesSecure() bool {
	switch strings.ToLower(strings.TrimSpace(c.Environment)) {
	case "prod", "production":
		return true
	default:
		return false
	}
}
