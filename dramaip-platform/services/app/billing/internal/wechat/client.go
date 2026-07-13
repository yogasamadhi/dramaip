package wechat

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Config has only the material required for WeChat Pay v3 request signing,
// callback verification and sandbox endpoint selection. Credentials are read
// from mounted files/environment by the service configuration, never from a
// request.
type Config struct {
	AppID                     string
	MchID                     string
	APIV3Key                  string
	MerchantCertificateSerial string
	MerchantPrivateKeyPath    string
	PlatformCertificateSerial string
	PlatformCertificatePath   string
	APIBaseURL                string
	HTTPClient                *http.Client
}

type Client struct {
	appID          string
	mchID          string
	apiV3Key       string
	serial         string
	merchantKey    *rsa.PrivateKey
	platformKey    *rsa.PublicKey
	platformSerial string
	apiBaseURL     string
	httpClient     *http.Client
}

type NativeOrderRequest struct {
	OutTradeNo  string
	Description string
	TotalCents  int64
	Currency    string
	NotifyURL   string
}

type NativeOrder struct {
	CodeURL string `json:"code_url"`
}

// NewClient parses local keys when the adapter is constructed so an enabled
// payment path fails closed before it can accept unsigned traffic.
func NewClient(cfg Config) (*Client, error) {
	for name, value := range map[string]string{
		"app id": cfg.AppID, "merchant id": cfg.MchID, "api v3 key": cfg.APIV3Key,
		"merchant certificate serial": cfg.MerchantCertificateSerial,
		"merchant private key path":   cfg.MerchantPrivateKeyPath,
		"platform certificate serial": cfg.PlatformCertificateSerial,
		"platform certificate path":   cfg.PlatformCertificatePath,
	} {
		if strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("wechat pay %s is required", name)
		}
	}
	if len(cfg.APIV3Key) != 32 {
		return nil, fmt.Errorf("wechat pay api v3 key must be exactly 32 bytes")
	}
	merchantRaw, err := os.ReadFile(cfg.MerchantPrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read wechat pay merchant private key: %w", err)
	}
	merchantKey, err := parseRSAPrivateKey(merchantRaw)
	if err != nil {
		return nil, err
	}
	platformRaw, err := os.ReadFile(cfg.PlatformCertificatePath)
	if err != nil {
		return nil, fmt.Errorf("read wechat pay platform certificate: %w", err)
	}
	platformKey, err := ParsePlatformPublicKey(platformRaw)
	if err != nil {
		return nil, err
	}
	baseURL := strings.TrimRight(cfg.APIBaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.mch.weixin.qq.com"
	}
	if _, err := url.ParseRequestURI(baseURL); err != nil {
		return nil, fmt.Errorf("parse wechat pay api base URL: %w", err)
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		appID: cfg.AppID, mchID: cfg.MchID, apiV3Key: cfg.APIV3Key,
		serial: cfg.MerchantCertificateSerial, merchantKey: merchantKey,
		platformKey: platformKey, platformSerial: cfg.PlatformCertificateSerial,
		apiBaseURL: baseURL, httpClient: client,
	}, nil
}

func (c *Client) VerifyNotification(platformSerial, timestamp, nonce, signature string, rawBody []byte, now time.Time) error {
	if !strings.EqualFold(strings.TrimSpace(platformSerial), strings.TrimSpace(c.platformSerial)) {
		return fmt.Errorf("wechat pay notification certificate serial does not match configured certificate")
	}
	return VerifySignature(c.platformKey, timestamp, nonce, signature, rawBody, now, DefaultReplayWindow)
}

func (c *Client) ParseNotification(rawBody []byte) (Notification, Transaction, error) {
	notification, transaction, err := ParseNotification(c.apiV3Key, rawBody)
	if err != nil {
		return Notification{}, Transaction{}, err
	}
	if transaction.AppID != c.appID {
		return Notification{}, Transaction{}, fmt.Errorf("wechat pay callback appid does not match configured merchant")
	}
	if transaction.MchID != c.mchID {
		return Notification{}, Transaction{}, fmt.Errorf("wechat pay callback mchid does not match configured merchant")
	}
	return notification, transaction, nil
}

// CreateNativeOrder opens a native-code order against the configured WeChat
// endpoint. The caller supplies the stable out_trade_no before invoking this
// network operation, then persists the local order only after WeChat accepts
// it. That prevents a local checkout that has no provider-side payment order.
func (c *Client) CreateNativeOrder(ctx context.Context, order NativeOrderRequest) (NativeOrder, error) {
	if order.OutTradeNo == "" || order.Description == "" || order.TotalCents <= 0 || order.NotifyURL == "" {
		return NativeOrder{}, fmt.Errorf("wechat pay native order fields are incomplete")
	}
	if order.Currency == "" {
		order.Currency = "CNY"
	}
	body, err := json.Marshal(map[string]any{
		"appid": c.appID, "mchid": c.mchID, "description": order.Description,
		"out_trade_no": order.OutTradeNo, "notify_url": order.NotifyURL,
		"amount": map[string]any{"total": order.TotalCents, "currency": order.Currency},
	})
	if err != nil {
		return NativeOrder{}, err
	}
	response, err := c.do(ctx, http.MethodPost, "/v3/pay/transactions/native", body)
	if err != nil {
		return NativeOrder{}, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return NativeOrder{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return NativeOrder{}, fmt.Errorf("wechat pay create native order: status %d: %s", response.StatusCode, strings.TrimSpace(string(payload)))
	}
	var result NativeOrder
	if err := json.Unmarshal(payload, &result); err != nil || result.CodeURL == "" {
		if err != nil {
			return NativeOrder{}, fmt.Errorf("decode wechat pay native order: %w", err)
		}
		return NativeOrder{}, fmt.Errorf("wechat pay native order response has no code_url")
	}
	return result, nil
}

// QueryTransaction is the confirmation source of truth. A notification can
// wake processing up, but it can never activate a subscription by itself.
func (c *Client) QueryTransaction(ctx context.Context, outTradeNo string) (Transaction, []byte, error) {
	if outTradeNo == "" {
		return Transaction{}, nil, fmt.Errorf("wechat pay out_trade_no is required")
	}
	path := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(outTradeNo) + "?mchid=" + url.QueryEscape(c.mchID)
	response, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return Transaction{}, nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return Transaction{}, nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return Transaction{}, payload, fmt.Errorf("wechat pay query transaction: status %d: %s", response.StatusCode, strings.TrimSpace(string(payload)))
	}
	var transaction Transaction
	if err := json.Unmarshal(payload, &transaction); err != nil {
		return Transaction{}, payload, fmt.Errorf("decode wechat pay transaction query: %w", err)
	}
	if transaction.AppID != c.appID || transaction.MchID != c.mchID || transaction.OutTradeNo != outTradeNo || transaction.TransactionID == "" || transaction.TradeState != "SUCCESS" || transaction.Amount.Total <= 0 || transaction.Amount.Currency == "" {
		return Transaction{}, payload, fmt.Errorf("wechat pay query did not confirm a successful matching transaction")
	}
	return transaction, payload, nil
}

func (c *Client) do(ctx context.Context, method, requestPath string, body []byte) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, c.apiBaseURL+requestPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if len(body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	authorization, err := c.authorization(method, request.URL.RequestURI(), body, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Accept", "application/json")
	return c.httpClient.Do(request)
}

func (c *Client) authorization(method, requestURI string, body []byte, now time.Time) (string, error) {
	nonce, err := randomNonce()
	if err != nil {
		return "", err
	}
	timestamp := fmt.Sprintf("%d", now.Unix())
	message := method + "\n" + requestURI + "\n" + timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	digest := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.merchantKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign wechat pay request: %w", err)
	}
	return fmt.Sprintf(`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",timestamp="%s",serial_no="%s",signature="%s"`,
		c.mchID, nonce, timestamp, c.serial, base64.StdEncoding.EncodeToString(signature)), nil
}

func randomNonce() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func parseRSAPrivateKey(raw []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("decode wechat pay merchant private key PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse wechat pay merchant private key: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("wechat pay merchant private key is not RSA")
	}
	return rsaKey, nil
}
