package conf

import "github.com/dramaip/dramaip-platform/services/pkg/kratosx"

type Bootstrap struct {
	Data DataConfig `yaml:"data"`
}

type DataConfig struct {
	MigrationsDir string `yaml:"migrations_dir"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{Data: DataConfig{MigrationsDir: "./migrations"}}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Data.MigrationsDir = kratosx.Env("MIGRATIONS_DIR", cfg.Data.MigrationsDir)
	return cfg, nil
}
