package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Server      ServerConfig        `yaml:"server"`
	AdminJWT    JWTConfig           `yaml:"admin_jwt"`
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
type JWTConfig struct {
	Issuer         string `yaml:"issuer"`
	Audience       string `yaml:"audience"`
	ActiveKeyID    string `yaml:"active_key_id"`
	PrivateKeyFile string `yaml:"private_key_file"`
	JWKSFile       string `yaml:"jwks_file"`
	AccessTokenTTL string `yaml:"access_token_ttl"`
}
type DownstreamConfig struct {
	ReportingEndpoint       string `yaml:"reporting_grpc_addr"`
	AuthEndpoint            string `yaml:"auth_grpc_addr"`
	UserEndpoint            string `yaml:"user_grpc_addr"`
	BillingEndpoint         string `yaml:"billing_grpc_addr"`
	QuotaEndpoint           string `yaml:"quota_grpc_addr"`
	AIGatewayEndpoint       string `yaml:"ai_gateway_grpc_addr"`
	NotificationEndpoint    string `yaml:"notification_grpc_addr"`
	BillingJobEndpoint      string `yaml:"billing_job_grpc_addr"`
	NotificationJobEndpoint string `yaml:"notification_job_grpc_addr"`
	DialTimeout             string `yaml:"dial_timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8130"}},
		AdminJWT:    JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"},
		Downstream:  DownstreamConfig{ReportingEndpoint: "localhost:9108", AuthEndpoint: "localhost:9101", UserEndpoint: "localhost:9102", BillingEndpoint: "localhost:9103", QuotaEndpoint: "localhost:9104", AIGatewayEndpoint: "localhost:9105", NotificationEndpoint: "localhost:9106", BillingJobEndpoint: "localhost:9110", NotificationJobEndpoint: "localhost:9111", DialTimeout: "15s"},
		Environment: "development",
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Server.HTTP.Addr = kratosx.Env("ADMIN_BFF_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.AdminJWT.Issuer = kratosx.Env("ADMIN_JWT_ISSUER", cfg.AdminJWT.Issuer)
	cfg.AdminJWT.Audience = kratosx.Env("ADMIN_JWT_AUDIENCE", cfg.AdminJWT.Audience)
	cfg.AdminJWT.ActiveKeyID = kratosx.Env("ADMIN_JWT_ACTIVE_KID", cfg.AdminJWT.ActiveKeyID)
	cfg.AdminJWT.PrivateKeyFile = kratosx.Env("ADMIN_JWT_PRIVATE_KEY_FILE", cfg.AdminJWT.PrivateKeyFile)
	cfg.AdminJWT.JWKSFile = kratosx.Env("ADMIN_JWT_JWKS_FILE", cfg.AdminJWT.JWKSFile)
	cfg.AdminJWT.AccessTokenTTL = kratosx.Env("ADMIN_JWT_ACCESS_TTL", cfg.AdminJWT.AccessTokenTTL)
	cfg.Downstream.ReportingEndpoint = kratosx.Env("REPORTING_GRPC_ENDPOINT", cfg.Downstream.ReportingEndpoint)
	cfg.Downstream.AuthEndpoint = kratosx.Env("AUTH_GRPC_ENDPOINT", cfg.Downstream.AuthEndpoint)
	cfg.Downstream.UserEndpoint = kratosx.Env("USER_GRPC_ENDPOINT", cfg.Downstream.UserEndpoint)
	cfg.Downstream.BillingEndpoint = kratosx.Env("BILLING_GRPC_ENDPOINT", cfg.Downstream.BillingEndpoint)
	cfg.Downstream.QuotaEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Downstream.QuotaEndpoint)
	cfg.Downstream.AIGatewayEndpoint = kratosx.Env("AI_GATEWAY_GRPC_ENDPOINT", cfg.Downstream.AIGatewayEndpoint)
	cfg.Downstream.NotificationEndpoint = kratosx.Env("NOTIFICATION_GRPC_ENDPOINT", cfg.Downstream.NotificationEndpoint)
	cfg.Downstream.BillingJobEndpoint = kratosx.Env("BILLING_JOB_GRPC_ENDPOINT", cfg.Downstream.BillingJobEndpoint)
	cfg.Downstream.NotificationJobEndpoint = kratosx.Env("NOTIFICATION_JOB_GRPC_ENDPOINT", cfg.Downstream.NotificationJobEndpoint)
	cfg.Downstream.DialTimeout = kratosx.Env("ADMIN_BFF_GRPC_DIAL_TIMEOUT", cfg.Downstream.DialTimeout)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
