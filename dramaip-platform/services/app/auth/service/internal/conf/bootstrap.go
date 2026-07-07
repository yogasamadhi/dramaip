package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Server      ServerConfig `yaml:"server"`
	Data        DataConfig   `yaml:"data"`
	JWT         JWTConfig    `yaml:"jwt"`
	AutoMigrate bool         `yaml:"auto_migrate"`
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
	AccessSecret    string `yaml:"access_secret"`
	AccessTokenTTL  string `yaml:"access_token_ttl"`
	RefreshSecret   string `yaml:"refresh_secret"`
	RefreshTokenTTL string `yaml:"refresh_token_ttl"`
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
			AccessSecret:    "changeme-access-secret-replace-in-production",
			AccessTokenTTL:  "15m",
			RefreshSecret:   "changeme-refresh-secret-replace-in-production",
			RefreshTokenTTL: "720h",
		},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Server.HTTP.Addr = kratosx.Env("AUTH_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("AUTH_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Data.MigrationsDir = kratosx.Env("MIGRATIONS_DIR", cfg.Data.MigrationsDir)
	cfg.AutoMigrate = kratosx.EnvBool("AUTO_MIGRATE", kratosx.EnvBool("BFF_AUTO_MIGRATE", cfg.AutoMigrate))
	cfg.JWT.Issuer = kratosx.Env("JWT_ISSUER", cfg.JWT.Issuer)
	cfg.JWT.AccessSecret = kratosx.Env("JWT_ACCESS_SECRET", cfg.JWT.AccessSecret)
	cfg.JWT.AccessTokenTTL = kratosx.Env("JWT_ACCESS_TTL", cfg.JWT.AccessTokenTTL)
	cfg.JWT.RefreshSecret = kratosx.Env("JWT_REFRESH_SECRET", cfg.JWT.RefreshSecret)
	cfg.JWT.RefreshTokenTTL = kratosx.Env("JWT_REFRESH_TTL", cfg.JWT.RefreshTokenTTL)
	return cfg, nil
}
