package conf

import (
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type Bootstrap struct {
	Env     string              `yaml:"env"`
	Server  ServerConfig        `yaml:"server"`
	Payment PaymentConfig       `yaml:"payment"`
	Quota   QuotaConfig         `yaml:"quota"`
	MTLS    platform.MTLSConfig `yaml:"-"`
}

type ServerConfig struct {
	HTTP EndpointConfig `yaml:"http"`
	GRPC EndpointConfig `yaml:"grpc"`
}

type EndpointConfig struct {
	Addr string `yaml:"addr"`
}

type PaymentConfig struct {
	SimulatedEnabled bool            `yaml:"simulated_enabled"`
	WechatPay        WechatPayConfig `yaml:"wechat_pay"`
	Alipay           AlipayConfig    `yaml:"alipay"`
}

type WechatPayConfig struct {
	Enabled                   bool   `yaml:"enabled"`
	AppID                     string `yaml:"app_id"`
	MchID                     string `yaml:"mch_id"`
	APIV3Key                  string `yaml:"-"`
	MerchantCertificateSerial string `yaml:"merchant_certificate_serial"`
	MerchantPrivateKeyPath    string `yaml:"merchant_private_key_path"`
	PlatformCertificateSerial string `yaml:"platform_certificate_serial"`
	PlatformCertificatePath   string `yaml:"platform_certificate_path"`
	NotifyURL                 string `yaml:"notify_url"`
	APIBaseURL                string `yaml:"api_base_url"`
}

type AlipayConfig struct {
	Enabled                bool   `yaml:"enabled"`
	AppID                  string `yaml:"app_id"`
	SellerID               string `yaml:"seller_id"`
	MerchantPrivateKeyPath string `yaml:"merchant_private_key_path"`
	AlipayPublicKeyPath    string `yaml:"alipay_public_key_path"`
	NotifyURL              string `yaml:"notify_url"`
	Gateway                string `yaml:"gateway"`
}

type QuotaConfig struct {
	GRPCEndpoint string `yaml:"grpc_addr"`
	DialTimeout  string `yaml:"dial_timeout"`
}

func Load() (*Bootstrap, error) {
	cfg := &Bootstrap{
		Env: "dev",
		Server: ServerConfig{
			HTTP: EndpointConfig{Addr: ":8103"},
			GRPC: EndpointConfig{Addr: ":9103"},
		},
		Payment: PaymentConfig{
			SimulatedEnabled: true,
			WechatPay:        WechatPayConfig{APIBaseURL: "https://api.mch.weixin.qq.com"},
			Alipay:           AlipayConfig{Gateway: "https://openapi.alipay.com/gateway.do"},
		},
		Quota: QuotaConfig{GRPCEndpoint: "localhost:9104", DialTimeout: "10s"},
	}
	if err := kratosx.LoadYAML("", cfg); err != nil {
		return nil, err
	}
	cfg.Env = kratosx.Env("ENV", cfg.Env)
	cfg.Server.HTTP.Addr = kratosx.Env("BILLING_HTTP_ADDR", cfg.Server.HTTP.Addr)
	cfg.Server.GRPC.Addr = kratosx.Env("BILLING_GRPC_ADDR", cfg.Server.GRPC.Addr)
	cfg.Quota.GRPCEndpoint = kratosx.Env("QUOTA_GRPC_ENDPOINT", cfg.Quota.GRPCEndpoint)
	cfg.Quota.DialTimeout = kratosx.Env("BILLING_QUOTA_DIAL_TIMEOUT", cfg.Quota.DialTimeout)
	cfg.Payment.SimulatedEnabled = kratosx.EnvBool("BILLING_SIMULATED_ENABLED", cfg.Payment.SimulatedEnabled)
	cfg.Payment.WechatPay.Enabled = kratosx.EnvBool("WECHAT_PAY_ENABLED", cfg.Payment.WechatPay.Enabled)
	cfg.Payment.WechatPay.AppID = kratosx.Env("WECHAT_PAY_APP_ID", cfg.Payment.WechatPay.AppID)
	cfg.Payment.WechatPay.MchID = kratosx.Env("WECHAT_PAY_MCH_ID", cfg.Payment.WechatPay.MchID)
	cfg.Payment.WechatPay.APIV3Key = kratosx.Env("WECHAT_PAY_API_V3_KEY", cfg.Payment.WechatPay.APIV3Key)
	cfg.Payment.WechatPay.MerchantCertificateSerial = kratosx.Env("WECHAT_PAY_CERT_SERIAL", cfg.Payment.WechatPay.MerchantCertificateSerial)
	cfg.Payment.WechatPay.MerchantPrivateKeyPath = kratosx.Env("WECHAT_PAY_PRIVATE_KEY_PATH", cfg.Payment.WechatPay.MerchantPrivateKeyPath)
	cfg.Payment.WechatPay.PlatformCertificateSerial = kratosx.Env("WECHAT_PAY_PLATFORM_CERT_SERIAL", cfg.Payment.WechatPay.PlatformCertificateSerial)
	cfg.Payment.WechatPay.PlatformCertificatePath = kratosx.Env("WECHAT_PAY_PLATFORM_CERT_PATH", cfg.Payment.WechatPay.PlatformCertificatePath)
	cfg.Payment.WechatPay.NotifyURL = kratosx.Env("WECHAT_PAY_NOTIFY_URL", cfg.Payment.WechatPay.NotifyURL)
	cfg.Payment.WechatPay.APIBaseURL = kratosx.Env("WECHAT_PAY_API_BASE_URL", cfg.Payment.WechatPay.APIBaseURL)
	cfg.Payment.Alipay.Enabled = kratosx.EnvBool("ALIPAY_ENABLED", cfg.Payment.Alipay.Enabled)
	cfg.Payment.Alipay.AppID = kratosx.Env("ALIPAY_APP_ID", cfg.Payment.Alipay.AppID)
	cfg.Payment.Alipay.SellerID = kratosx.Env("ALIPAY_SELLER_ID", cfg.Payment.Alipay.SellerID)
	cfg.Payment.Alipay.MerchantPrivateKeyPath = kratosx.Env("ALIPAY_PRIVATE_KEY_PATH", cfg.Payment.Alipay.MerchantPrivateKeyPath)
	cfg.Payment.Alipay.AlipayPublicKeyPath = kratosx.Env("ALIPAY_PUBLIC_KEY_PATH", cfg.Payment.Alipay.AlipayPublicKeyPath)
	cfg.Payment.Alipay.NotifyURL = kratosx.Env("ALIPAY_NOTIFY_URL", cfg.Payment.Alipay.NotifyURL)
	cfg.Payment.Alipay.Gateway = kratosx.Env("ALIPAY_GATEWAY", cfg.Payment.Alipay.Gateway)
	if cfg.Env != "dev" && cfg.Env != "test" {
		cfg.Payment.SimulatedEnabled = false
	}
	mtls, err := platform.LoadMTLSConfig(cfg.Env)
	if err != nil {
		return nil, err
	}
	cfg.MTLS = mtls
	return cfg, nil
}
