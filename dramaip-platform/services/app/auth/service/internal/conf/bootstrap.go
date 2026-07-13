package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Server      ServerConfig `yaml:"server"`
	Data        DataConfig   `yaml:"data"`
	JWT         JWTConfig    `yaml:"jwt"`
	Environment string       `yaml:"environment"`
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
	Audience        string `yaml:"audience"`
	ActiveKeyID     string `yaml:"active_key_id"`
	PrivateKeyFile  string `yaml:"private_key_file"`
	JWKSFile        string `yaml:"jwks_file"`
	AccessTokenTTL  string `yaml:"access_token_ttl"`
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
			Audience:        "dramaip-api",
			AccessTokenTTL:  "15m",
			RefreshTokenTTL: "720h",
		},
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
	return cfg, nil
}
