package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Server      ServerConfig        `yaml:"server"`
	Data        DataConfig          `yaml:"data"`
	JWT         JWTConfig           `yaml:"jwt"`
	Email       EmailConfig         `yaml:"email"`
	Environment string              `yaml:"environment"`
	MTLS        platform.MTLSConfig `yaml:"-"`
	AutoMigrate bool                `yaml:"auto_migrate"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type DataConfig struct {
	MigrationsDir string `yaml:"migrations_dir"`
}

type JWTConfig struct {
	Issuer          string `yaml:"issuer"`
	Audience        string `yaml:"audience"`
	ActiveKeyID     string `yaml:"active_key_id"`
	PrivateKeyFile  string `yaml:"private_key_file"`
	JWKSFile        string `yaml:"jwks_file"`
	AccessTokenTTL  string `yaml:"access_token_ttl"`
	RefreshTokenTTL string `yaml:"refresh_token_ttl"`
}

// EmailConfig points to a provider-owned delivery gateway. The auth service
// sends a short code in the request body only; it never constructs a token URL.
type EmailConfig struct {
	DeliveryURL   string `yaml:"delivery_url"`
	DeliveryToken string `yaml:"delivery_token"`
	From          string `yaml:"from"`
	Timeout       string `yaml:"timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Server: ServerConfig{
			HTTP: EndpointConfig{Addr: ":8101"},
			GRPC: EndpointConfig{Addr: ":9101"},
		},
		Data: DataConfig{MigrationsDir: "./migrations"},
		JWT: JWTConfig{
			Issuer:          "dramaip",
			Audience:        "dramaip-api",
			AccessTokenTTL:  "15m",
			RefreshTokenTTL: "720h",
		},
		Email:       EmailConfig{Timeout: "10s"},
		Environment: "development",
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("AUTH_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("AUTH_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Data.MigrationsDir = kratosx.Env("MIGRATIONS_DIR", cfg.Data.MigrationsDir)
	cfg.AutoMigrate = kratosx.EnvBool("AUTO_MIGRATE", cfg.AutoMigrate)
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.JWT.Issuer = kratosx.Env("JWT_ISSUER", cfg.JWT.Issuer)
	cfg.JWT.Audience = kratosx.Env("JWT_AUDIENCE", cfg.JWT.Audience)
	cfg.JWT.ActiveKeyID = kratosx.Env("JWT_ACTIVE_KID", cfg.JWT.ActiveKeyID)
	cfg.JWT.PrivateKeyFile = kratosx.Env("JWT_PRIVATE_KEY_FILE", cfg.JWT.PrivateKeyFile)
	cfg.JWT.JWKSFile = kratosx.Env("JWT_JWKS_FILE", cfg.JWT.JWKSFile)
	cfg.JWT.AccessTokenTTL = kratosx.Env("JWT_ACCESS_TTL", cfg.JWT.AccessTokenTTL)
	cfg.JWT.RefreshTokenTTL = kratosx.Env("JWT_REFRESH_TTL", cfg.JWT.RefreshTokenTTL)
	cfg.Email.DeliveryURL = kratosx.Env("AUTH_EMAIL_DELIVERY_URL", cfg.Email.DeliveryURL)
	cfg.Email.DeliveryToken = kratosx.Env("AUTH_EMAIL_DELIVERY_TOKEN", cfg.Email.DeliveryToken)
	cfg.Email.From = kratosx.Env("AUTH_EMAIL_FROM", cfg.Email.From)
	cfg.Email.Timeout = kratosx.Env("AUTH_EMAIL_TIMEOUT", cfg.Email.Timeout)
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
