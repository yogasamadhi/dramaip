package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Server      ServerConfig        `yaml:"server"`
	AdminJWT    JWTConfig           `yaml:"admin_jwt"`
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

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server:      ServerConfig{HTTP: EndpointConfig{Addr: ":8130"}},
		AdminJWT:    JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"},
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
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
