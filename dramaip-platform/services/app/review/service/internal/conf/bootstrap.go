package conf

import (
	"strings"

	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Environment string              `yaml:"environment"`
	Server      ServerConfig        `yaml:"server"`
	User        UserConfig          `yaml:"user"`
	ObjectStore ObjectStoreConfig   `yaml:"object_store"`
	MTLS        platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type UserConfig struct {
	GRPCEndpoint string `yaml:"grpc_endpoint"`
	DialTimeout  string `yaml:"dial_timeout"`
}

type ObjectStoreConfig struct {
	Endpoint  string `yaml:"endpoint"`
	Region    string `yaml:"region"`
	Bucket    string `yaml:"bucket"`
	AccessKey string `yaml:"-"`
	SecretKey string `yaml:"-"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Environment: "development",
		Server: ServerConfig{
			HTTP: EndpointConfig{Addr: ":8115"},
			GRPC: EndpointConfig{Addr: ":9112"},
		},
		User:        UserConfig{GRPCEndpoint: "127.0.0.1:9102", DialTimeout: "3s"},
		ObjectStore: ObjectStoreConfig{Region: "us-east-1"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Environment = kratosx.Env("ENV", cfg.Environment)
	cfg.Server.HTTP.Addr = kratosx.Env("REVIEW_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("REVIEW_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.User.GRPCEndpoint = kratosx.Env("USER_GRPC_ENDPOINT", cfg.User.GRPCEndpoint)
	cfg.ObjectStore.Endpoint = strings.TrimRight(strings.TrimSpace(kratosx.Env("REVIEW_S3_ENDPOINT", cfg.ObjectStore.Endpoint)), "/")
	cfg.ObjectStore.Region = kratosx.Env("REVIEW_S3_REGION", cfg.ObjectStore.Region)
	cfg.ObjectStore.Bucket = kratosx.Env("REVIEW_S3_BUCKET", cfg.ObjectStore.Bucket)
	cfg.ObjectStore.AccessKey = kratosx.Env("REVIEW_S3_ACCESS_KEY", "")
	cfg.ObjectStore.SecretKey = kratosx.Env("REVIEW_S3_SECRET_KEY", "")
	mtls, err := platform.LoadMTLSConfig(cfg.Environment)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
