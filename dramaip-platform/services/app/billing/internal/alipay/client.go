// Package alipay implements the small, protocol-focused surface required for
// Alipay face-to-face precreate orders, signed asynchronous notifications and
// server-side transaction confirmation. It intentionally has no billing
// database dependency.
package alipay

import (
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
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	signTypeRSA2   = "RSA2"
	defaultGateway = "https://openapi.alipay.com/gateway.do"
)

// Config contains only operator-provided credentials and endpoints. Secret
// material is loaded from mounted files; it is never accepted from a request.
type Config struct {
	AppID                  string
	SellerID               string
	MerchantPrivateKeyPath string
	AlipayPublicKeyPath    string
	NotifyURL              string
	Gateway                string
	HTTPClient             *http.Client
}

type Client struct {
	appID       string
	sellerID    string
	merchantKey *rsa.PrivateKey
	alipayKey   *rsa.PublicKey
	notifyURL   string
	gateway     string
	httpClient  *http.Client
}

type PrecreateOrderRequest struct {
	OutTradeNo string
	Subject    string
	TotalCents int64
	Currency   string
	Timeout    string
}

type PrecreateOrder struct {
	QRCode string
}

// Notification holds only the callback fields needed by billing. The original
// form body is retained separately by the webhook inbox for audit purposes.
type Notification struct {
	NotifyID    string
	NotifyTime  string
	AppID       string
	SellerID    string
	OutTradeNo  string
	TradeNo     string
	TradeStatus string
	TotalAmount string
	TotalCents  int64
}

type Transaction struct {
	AppID       string `json:"app_id"`
	SellerID    string `json:"seller_id"`
	OutTradeNo  string `json:"out_trade_no"`
	TradeNo     string `json:"trade_no"`
	TradeStatus string `json:"trade_status"`
	TotalAmount string `json:"total_amount"`
	TotalCents  int64  `json:"-"`
}

// UnmarshalJSON accepts the provider's documented amount representations.
// Some endpoint examples encode total_amount as a JSON string while others
// return a JSON number; both must be converted without floating-point rounding.
func (t *Transaction) UnmarshalJSON(payload []byte) error {
	var wire struct {
		AppID       string          `json:"app_id"`
		SellerID    string          `json:"seller_id"`
		OutTradeNo  string          `json:"out_trade_no"`
		TradeNo     string          `json:"trade_no"`
		TradeStatus string          `json:"trade_status"`
		TotalAmount json.RawMessage `json:"total_amount"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		return err
	}
	var amount string
	if err := json.Unmarshal(wire.TotalAmount, &amount); err != nil {
		var number json.Number
		if numericErr := json.Unmarshal(wire.TotalAmount, &number); numericErr != nil {
			return fmt.Errorf("decode alipay total_amount: %w", err)
		}
		amount = number.String()
	}
	*t = Transaction{
		AppID: wire.AppID, SellerID: wire.SellerID, OutTradeNo: wire.OutTradeNo,
		TradeNo: wire.TradeNo, TradeStatus: wire.TradeStatus, TotalAmount: amount,
	}
	return nil
}

type apiResponse struct {
	Code    string `json:"code"`
	Msg     string `json:"msg"`
	SubCode string `json:"sub_code"`
	SubMsg  string `json:"sub_msg"`
}

type precreateResponse struct {
	apiResponse
	OutTradeNo string `json:"out_trade_no"`
	QRCode     string `json:"qr_code"`
}

type queryResponse struct {
	apiResponse
	Transaction
}

func (r *queryResponse) UnmarshalJSON(payload []byte) error {
	var response apiResponse
	if err := json.Unmarshal(payload, &response); err != nil {
		return err
	}
	var transaction Transaction
	if err := json.Unmarshal(payload, &transaction); err != nil {
		return err
	}
	r.apiResponse = response
	r.Transaction = transaction
	return nil
}

func NewClient(cfg Config) (*Client, error) {
	for name, value := range map[string]string{
		"app id":                    cfg.AppID,
		"seller id":                 cfg.SellerID,
		"merchant private key path": cfg.MerchantPrivateKeyPath,
		"alipay public key path":    cfg.AlipayPublicKeyPath,
		"notify url":                cfg.NotifyURL,
	} {
		if strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("alipay %s is required", name)
		}
	}
	if notifyURL, err := url.ParseRequestURI(cfg.NotifyURL); err != nil || notifyURL.Scheme != "https" || notifyURL.Host == "" || notifyURL.Path != "/v1/webhooks/alipay" || notifyURL.RawQuery != "" || notifyURL.Fragment != "" {
		return nil, fmt.Errorf("alipay notify url must be the absolute HTTPS /v1/webhooks/alipay endpoint")
	}
	merchantRaw, err := os.ReadFile(cfg.MerchantPrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read alipay merchant private key: %w", err)
	}
	merchantKey, err := parseRSAPrivateKey(merchantRaw)
	if err != nil {
		return nil, err
	}
	publicRaw, err := os.ReadFile(cfg.AlipayPublicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read alipay public key: %w", err)
	}
	publicKey, err := ParseAlipayPublicKey(publicRaw)
	if err != nil {
		return nil, err
	}
	gateway := strings.TrimRight(cfg.Gateway, "/")
	if gateway == "" {
		gateway = defaultGateway
	}
	parsedGateway, err := url.ParseRequestURI(gateway)
	if err != nil || parsedGateway.Scheme != "https" || parsedGateway.Host == "" {
		return nil, fmt.Errorf("alipay gateway must be an absolute HTTPS URL")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{
		appID: cfg.AppID, sellerID: cfg.SellerID, merchantKey: merchantKey,
		alipayKey: publicKey, notifyURL: cfg.NotifyURL, gateway: gateway,
		httpClient: client,
	}, nil
}

// CreatePrecreateOrder creates an Alipay face-to-face order and returns the
// QR code URL. The caller owns the stable out_trade_no and persists it only
// after Alipay accepted the precreate request.
func (c *Client) CreatePrecreateOrder(ctx context.Context, order PrecreateOrderRequest) (PrecreateOrder, error) {
	if strings.TrimSpace(order.OutTradeNo) == "" || strings.TrimSpace(order.Subject) == "" || order.TotalCents <= 0 {
		return PrecreateOrder{}, fmt.Errorf("alipay precreate order fields are incomplete")
	}
	if order.Currency == "" {
		order.Currency = "CNY"
	}
	if order.Currency != "CNY" {
		return PrecreateOrder{}, fmt.Errorf("alipay precreate supports only CNY")
	}
	var response precreateResponse
	business := map[string]any{
		"out_trade_no": order.OutTradeNo,
		"subject":      order.Subject,
		"total_amount": centsToAmount(order.TotalCents),
	}
	if order.Timeout != "" {
		business["timeout_express"] = order.Timeout
	}
	if err := c.call(ctx, "alipay.trade.precreate", business, c.notifyURL, &response); err != nil {
		return PrecreateOrder{}, err
	}
	if response.Code != "10000" || response.QRCode == "" || response.OutTradeNo != order.OutTradeNo {
		return PrecreateOrder{}, apiError("alipay precreate order", response.apiResponse)
	}
	return PrecreateOrder{QRCode: response.QRCode}, nil
}

// QueryTransaction is the confirmation source of truth. A signed webhook
// only starts reconciliation; it cannot activate an entitlement by itself.
func (c *Client) QueryTransaction(ctx context.Context, outTradeNo string) (Transaction, []byte, error) {
	if strings.TrimSpace(outTradeNo) == "" {
		return Transaction{}, nil, fmt.Errorf("alipay out_trade_no is required")
	}
	var response queryResponse
	if err := c.call(ctx, "alipay.trade.query", map[string]any{"out_trade_no": outTradeNo}, "", &response); err != nil {
		return Transaction{}, nil, err
	}
	payload, err := json.Marshal(response)
	if err != nil {
		return Transaction{}, nil, err
	}
	transaction := response.Transaction
	transaction.TotalCents, err = AmountToCents(transaction.TotalAmount)
	if err != nil {
		return Transaction{}, payload, err
	}
	if response.Code != "10000" || transaction.OutTradeNo != outTradeNo || transaction.TradeNo == "" || transaction.TradeStatus != "TRADE_SUCCESS" || transaction.TotalCents <= 0 || transaction.SellerID != c.sellerID {
		return Transaction{}, payload, apiError("alipay query transaction", response.apiResponse)
	}
	return transaction, payload, nil
}

// ParseNotificationForm preserves the provider's decoded form parameters for
// signature verification. Repeated parameters are rejected to avoid parser
// ambiguity between the signature boundary and business-field extraction.
func ParseNotificationForm(rawBody []byte) (url.Values, error) {
	values, err := url.ParseQuery(string(rawBody))
	if err != nil {
		return nil, fmt.Errorf("parse alipay notification form: %w", err)
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("alipay notification form is empty")
	}
	for key, valuesForKey := range values {
		if key == "" || len(valuesForKey) != 1 {
			return nil, fmt.Errorf("alipay notification has ambiguous parameter %q", key)
		}
	}
	return values, nil
}

// VerifyNotification checks the RSA2 signature over every parameter except
// sign. Call ParseNotification only after this verification succeeds.
func (c *Client) VerifyNotification(values url.Values) error {
	for key, valuesForKey := range values {
		if key == "" || len(valuesForKey) != 1 {
			return fmt.Errorf("alipay notification has ambiguous parameter %q", key)
		}
	}
	if values.Get("sign_type") != signTypeRSA2 {
		return fmt.Errorf("alipay notification sign_type must be RSA2")
	}
	encodedSignature := values.Get("sign")
	if encodedSignature == "" {
		return fmt.Errorf("alipay notification signature is missing")
	}
	signature, err := base64.StdEncoding.DecodeString(encodedSignature)
	if err != nil {
		return fmt.Errorf("decode alipay notification signature: %w", err)
	}
	digest := sha256.Sum256([]byte(canonicalParameters(values, true)))
	if err := rsa.VerifyPKCS1v15(c.alipayKey, crypto.SHA256, digest[:], signature); err != nil {
		return fmt.Errorf("verify alipay notification signature: %w", err)
	}
	return nil
}

// ParseNotification validates the notification business fields against the
// configured merchant. A callback in any non-success state cannot proceed to
// payment activation.
func (c *Client) ParseNotification(values url.Values) (Notification, error) {
	notification := Notification{
		NotifyID: values.Get("notify_id"), NotifyTime: values.Get("notify_time"),
		AppID: values.Get("app_id"), SellerID: values.Get("seller_id"),
		OutTradeNo: values.Get("out_trade_no"), TradeNo: values.Get("trade_no"),
		TradeStatus: values.Get("trade_status"), TotalAmount: values.Get("total_amount"),
	}
	if notification.NotifyID == "" || notification.NotifyTime == "" || notification.AppID != c.appID || notification.SellerID != c.sellerID || notification.OutTradeNo == "" || notification.TradeNo == "" || notification.TradeStatus != "TRADE_SUCCESS" {
		return Notification{}, fmt.Errorf("alipay notification fields do not match a successful configured merchant transaction")
	}
	var err error
	notification.TotalCents, err = AmountToCents(notification.TotalAmount)
	if err != nil || notification.TotalCents <= 0 {
		return Notification{}, fmt.Errorf("alipay notification amount is invalid")
	}
	return notification, nil
}

func (c *Client) call(ctx context.Context, method string, business map[string]any, notifyURL string, output any) error {
	bizContent, err := json.Marshal(business)
	if err != nil {
		return err
	}
	values := url.Values{
		"app_id":      {c.appID},
		"method":      {method},
		"format":      {"JSON"},
		"charset":     {"utf-8"},
		"sign_type":   {signTypeRSA2},
		"timestamp":   {time.Now().In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02 15:04:05")},
		"version":     {"1.0"},
		"biz_content": {string(bizContent)},
	}
	if notifyURL != "" {
		values.Set("notify_url", notifyURL)
	}
	signature, err := c.sign(values)
	if err != nil {
		return err
	}
	values.Set("sign", signature)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.gateway, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("alipay %s: status %d: %s", method, response.StatusCode, strings.TrimSpace(string(payload)))
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return fmt.Errorf("decode alipay %s response: %w", method, err)
	}
	responseBody, ok := envelope[strings.ReplaceAll(method, ".", "_")+"_response"]
	if !ok {
		return fmt.Errorf("alipay %s response is missing", method)
	}
	var encodedSignature string
	if err := json.Unmarshal(envelope["sign"], &encodedSignature); err != nil || encodedSignature == "" {
		return fmt.Errorf("alipay %s response signature is missing", method)
	}
	if err := c.verifyResponseSignature(responseBody, encodedSignature); err != nil {
		return fmt.Errorf("alipay %s response signature: %w", method, err)
	}
	if err := json.Unmarshal(responseBody, output); err != nil {
		return fmt.Errorf("decode alipay %s result: %w", method, err)
	}
	return nil
}

func (c *Client) verifyResponseSignature(responseBody []byte, encodedSignature string) error {
	signature, err := base64.StdEncoding.DecodeString(encodedSignature)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	digest := sha256.Sum256(responseBody)
	if err := rsa.VerifyPKCS1v15(c.alipayKey, crypto.SHA256, digest[:], signature); err != nil {
		return err
	}
	return nil
}

func (c *Client) sign(values url.Values) (string, error) {
	digest := sha256.Sum256([]byte(canonicalParameters(values, false)))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.merchantKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign alipay request: %w", err)
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func canonicalParameters(values url.Values, excludeSignature bool) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		if excludeSignature && key == "sign" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if value := values.Get(key); value != "" {
			parts = append(parts, key+"="+value)
		}
	}
	return strings.Join(parts, "&")
}

func AmountToCents(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") {
		return 0, fmt.Errorf("alipay amount is invalid")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, fmt.Errorf("alipay amount is invalid")
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole < 0 || whole > math.MaxInt64/100 {
		return 0, fmt.Errorf("alipay amount is invalid")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > 2 || (fraction != "" && strings.Trim(fraction, "0123456789") != "") {
		return 0, fmt.Errorf("alipay amount has more than two decimal places")
	}
	for len(fraction) < 2 {
		fraction += "0"
	}
	cents := int64(0)
	if fraction != "" {
		cents, _ = strconv.ParseInt(fraction, 10, 64)
	}
	if whole > (math.MaxInt64-cents)/100 {
		return 0, fmt.Errorf("alipay amount is too large")
	}
	return whole*100 + cents, nil
}

func centsToAmount(cents int64) string {
	return strconv.FormatInt(cents/100, 10) + "." + fmt.Sprintf("%02d", cents%100)
}

func apiError(operation string, response apiResponse) error {
	message := strings.TrimSpace(strings.Join([]string{response.Code, response.Msg, response.SubCode, response.SubMsg}, " "))
	if message == "" {
		message = "unexpected provider response"
	}
	return fmt.Errorf("%s: %s", operation, message)
}

func ParseAlipayPublicKey(raw []byte) (*rsa.PublicKey, error) {
	der := raw
	if block, _ := pem.Decode(raw); block != nil {
		der = block.Bytes
	} else {
		decoded, err := base64.StdEncoding.DecodeString(strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, string(raw)))
		if err != nil {
			return nil, fmt.Errorf("decode alipay public key: %w", err)
		}
		der = decoded
	}
	if certificate, err := x509.ParseCertificate(der); err == nil {
		if key, ok := certificate.PublicKey.(*rsa.PublicKey); ok {
			return key, nil
		}
	}
	key, err := x509.ParsePKIXPublicKey(der)
	if err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("alipay public key is not RSA")
		}
		return rsaKey, nil
	}
	if rsaKey, pkcs1Err := x509.ParsePKCS1PublicKey(der); pkcs1Err == nil {
		return rsaKey, nil
	}
	return nil, fmt.Errorf("parse alipay public key: %w", err)
}

func parseRSAPrivateKey(raw []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("decode alipay merchant private key PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse alipay merchant private key: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("alipay merchant private key is not RSA")
	}
	return rsaKey, nil
}
