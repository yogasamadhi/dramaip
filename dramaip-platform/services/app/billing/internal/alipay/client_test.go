package alipay

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientSignsPrecreateAndQueryAndVerifiesNotification(t *testing.T) {
	merchantKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	alipayKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		if err := verifyTestSignature(&merchantKey.PublicKey, r.PostForm); err != nil {
			t.Fatalf("request signature: %v", err)
		}
		var business map[string]any
		if err := json.Unmarshal([]byte(r.PostForm.Get("biz_content")), &business); err != nil {
			t.Fatalf("decode biz content: %v", err)
		}
		switch r.PostForm.Get("method") {
		case "alipay.trade.precreate":
			if business["out_trade_no"] != "order-1" || business["total_amount"] != "39.00" || business["timeout_express"] != "30m" || r.PostForm.Get("notify_url") != "https://pay.example.test/v1/webhooks/alipay" {
				t.Fatalf("precreate form=%v business=%v", r.PostForm, business)
			}
			writeSignedTestResponse(t, w, alipayKey, "alipay_trade_precreate_response", []byte(`{"code":"10000","out_trade_no":"order-1","qr_code":"alipayqr://order-1"}`))
		case "alipay.trade.query":
			if business["out_trade_no"] != "order-1" {
				t.Fatalf("query business=%v", business)
			}
			writeSignedTestResponse(t, w, alipayKey, "alipay_trade_query_response", []byte(`{"code":"10000","out_trade_no":"order-1","trade_no":"trade-1","trade_status":"TRADE_SUCCESS","total_amount":39.00,"seller_id":"seller-1"}`))
		default:
			t.Fatalf("unexpected method %q", r.PostForm.Get("method"))
		}
	}))
	defer server.Close()
	privatePath, publicPath := writeTestKeys(t, merchantKey, alipayKey)
	client, err := NewClient(Config{
		AppID: "app-1", SellerID: "seller-1", MerchantPrivateKeyPath: privatePath,
		AlipayPublicKeyPath: publicPath, NotifyURL: "https://pay.example.test/v1/webhooks/alipay",
		Gateway: server.URL, HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	precreated, err := client.CreatePrecreateOrder(t.Context(), PrecreateOrderRequest{OutTradeNo: "order-1", Subject: "DramaIP Basic", TotalCents: 3900, Currency: "CNY", Timeout: "30m"})
	if err != nil || precreated.QRCode != "alipayqr://order-1" {
		t.Fatalf("CreatePrecreateOrder = %#v, %v", precreated, err)
	}
	transaction, _, err := client.QueryTransaction(t.Context(), "order-1")
	if err != nil || transaction.TradeNo != "trade-1" || transaction.TotalCents != 3900 {
		t.Fatalf("QueryTransaction = %#v, %v", transaction, err)
	}
	notification := url.Values{
		"notify_id": {"notify-1"}, "notify_time": {"2026-07-13 12:00:00"},
		"app_id": {"app-1"}, "seller_id": {"seller-1"}, "out_trade_no": {"order-1"},
		"trade_no": {"trade-1"}, "trade_status": {"TRADE_SUCCESS"}, "total_amount": {"39.00"},
		"sign_type": {signTypeRSA2},
	}
	notification.Set("sign", signTestParameters(t, alipayKey, notification))
	parsed, err := ParseNotificationForm([]byte(notification.Encode()))
	if err != nil {
		t.Fatalf("ParseNotificationForm: %v", err)
	}
	if err := client.VerifyNotification(parsed); err != nil {
		t.Fatalf("VerifyNotification: %v", err)
	}
	confirmed, err := client.ParseNotification(parsed)
	if err != nil || confirmed.TotalCents != 3900 || confirmed.NotifyID != "notify-1" {
		t.Fatalf("ParseNotification = %#v, %v", confirmed, err)
	}
	parsed.Set("total_amount", "0.01")
	if err := client.VerifyNotification(parsed); err == nil {
		t.Fatal("tampered notification was accepted")
	}
}

func TestAmountToCentsRejectsRoundingAndInvalidValues(t *testing.T) {
	for _, test := range []struct {
		value string
		want  int64
		valid bool
	}{
		{"39", 3900, true}, {"39.0", 3900, true}, {"39.01", 3901, true},
		{"0.001", 0, false}, {"-1", 0, false}, {"", 0, false}, {"NaN", 0, false},
	} {
		got, err := AmountToCents(test.value)
		if (err == nil) != test.valid || (test.valid && got != test.want) {
			t.Fatalf("AmountToCents(%q) = %d, %v", test.value, got, err)
		}
	}
}

func TestQueryRejectsUnsignedProviderResponse(t *testing.T) {
	merchantKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	alipayKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"alipay_trade_query_response":{"code":"10000","out_trade_no":"order-1","trade_no":"trade-1","trade_status":"TRADE_SUCCESS","total_amount":"39.00","seller_id":"seller-1"}}`))
	}))
	defer server.Close()
	privatePath, publicPath := writeTestKeys(t, merchantKey, alipayKey)
	client, err := NewClient(Config{
		AppID: "app-1", SellerID: "seller-1", MerchantPrivateKeyPath: privatePath,
		AlipayPublicKeyPath: publicPath, NotifyURL: "https://pay.example.test/v1/webhooks/alipay",
		Gateway: server.URL, HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := client.QueryTransaction(t.Context(), "order-1"); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("QueryTransaction unsigned response error = %v", err)
	}
}

func writeTestKeys(t *testing.T, merchantKey, alipayKey *rsa.PrivateKey) (string, string) {
	t.Helper()
	dir := t.TempDir()
	privateDER, err := x509.MarshalPKCS8PrivateKey(merchantKey)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&alipayKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	privatePath := filepath.Join(dir, "merchant.pem")
	publicPath := filepath.Join(dir, "alipay.pem")
	if err := os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return privatePath, publicPath
}

func signTestParameters(t *testing.T, key *rsa.PrivateKey, values url.Values) string {
	t.Helper()
	digest := sha256.Sum256([]byte(canonicalParameters(values, true)))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(signature)
}

func verifyTestSignature(key *rsa.PublicKey, values url.Values) error {
	signature, err := base64.StdEncoding.DecodeString(values.Get("sign"))
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(canonicalParameters(values, true)))
	return rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature)
}

func writeSignedTestResponse(t *testing.T, w http.ResponseWriter, key *rsa.PrivateKey, responseKey string, body []byte) {
	t.Helper()
	digest := sha256.Sum256(body)
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal(map[string]any{responseKey: json.RawMessage(body), "sign": base64.StdEncoding.EncodeToString(signature)})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write(response)
}
