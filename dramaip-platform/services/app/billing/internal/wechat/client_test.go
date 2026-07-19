package wechat

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientSignsCreateAndQueryRequests(t *testing.T) {
	merchantKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate merchant key: %v", err)
	}
	platformKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate platform key: %v", err)
	}
	temporaryDir := t.TempDir()
	merchantPath := filepath.Join(temporaryDir, "merchant.pem")
	platformPath := filepath.Join(temporaryDir, "platform.pem")
	if err := os.WriteFile(merchantPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(merchantKey)}), 0o600); err != nil {
		t.Fatalf("write merchant key: %v", err)
	}
	platformDER, err := x509.MarshalPKIXPublicKey(&platformKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal platform key: %v", err)
	}
	if err := os.WriteFile(platformPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: platformDER}), 0o600); err != nil {
		t.Fatalf("write platform key: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "WECHATPAY2-SHA256-RSA2048 ") {
			t.Errorf("missing signed authorization: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/v3/pay/transactions/native":
			body, _ := io.ReadAll(r.Body)
			if r.Method != http.MethodPost || !strings.Contains(string(body), `"out_trade_no":"wx-order-1"`) || !strings.Contains(string(body), `"time_expire":"2026-07-20T12:30:00Z"`) {
				t.Errorf("native request %s %s", r.Method, body)
			}
			_, _ = w.Write([]byte(`{"code_url":"weixin://wxpay/bizpayurl?pr=test"}`))
		case "/v3/pay/transactions/out-trade-no/wx-order-1":
			if r.Method != http.MethodGet || r.URL.Query().Get("mchid") != "merchant-1" {
				t.Errorf("query request %s %s", r.Method, r.URL.String())
			}
			_, _ = w.Write([]byte(`{"appid":"app-1","mchid":"merchant-1","out_trade_no":"wx-order-1","transaction_id":"tx-1","trade_state":"SUCCESS","amount":{"total":990,"currency":"CNY"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewClient(Config{
		AppID: "app-1", MchID: "merchant-1", APIV3Key: "0123456789abcdef0123456789abcdef",
		MerchantCertificateSerial: "merchant-serial", MerchantPrivateKeyPath: merchantPath,
		PlatformCertificateSerial: "platform-serial", PlatformCertificatePath: platformPath, APIBaseURL: server.URL,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	native, err := client.CreateNativeOrder(t.Context(), NativeOrderRequest{OutTradeNo: "wx-order-1", Description: "DramaIP Basic", TotalCents: 990, NotifyURL: "https://example.test/v1/webhooks/wechat-pay", TimeExpire: "2026-07-20T12:30:00Z"})
	if err != nil || native.CodeURL == "" {
		t.Fatalf("CreateNativeOrder = %#v, %v", native, err)
	}
	transaction, _, err := client.QueryTransaction(t.Context(), "wx-order-1")
	if err != nil || transaction.TransactionID != "tx-1" {
		t.Fatalf("QueryTransaction = %#v, %v", transaction, err)
	}
}
