package wechat

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestVerifyAndDecryptNotification(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	key := "0123456789abcdef0123456789abcdef"
	transaction := Transaction{OutTradeNo: "order-1", TransactionID: "wechat-transaction-1", TradeState: "SUCCESS", Amount: Amount{Total: 3900, Currency: "CNY"}}
	plain, err := json.Marshal(transaction)
	if err != nil {
		t.Fatalf("marshal transaction: %v", err)
	}
	resource := encryptResource(t, key, plain, "associated-data")
	raw, err := json.Marshal(Notification{ID: "event-1", EventType: "TRANSACTION.SUCCESS", Resource: resource})
	if err != nil {
		t.Fatalf("marshal notification: %v", err)
	}
	now := time.Unix(1_700_000_000, 0)
	timestamp := "1700000000"
	nonce := "header-nonce"
	digest := sha256.Sum256([]byte(timestamp + "\n" + nonce + "\n" + string(raw) + "\n"))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign notification: %v", err)
	}
	if err := VerifySignature(&privateKey.PublicKey, timestamp, nonce, base64.StdEncoding.EncodeToString(signature), raw, now, DefaultReplayWindow); err != nil {
		t.Fatalf("VerifySignature: %v", err)
	}
	_, decoded, err := ParseNotification(key, raw)
	if err != nil || decoded.OutTradeNo != transaction.OutTradeNo || decoded.TransactionID != transaction.TransactionID {
		t.Fatalf("ParseNotification = %#v, %v", decoded, err)
	}
	if err := VerifySignature(&privateKey.PublicKey, timestamp, nonce, base64.StdEncoding.EncodeToString(signature), append(raw, 'x'), now, DefaultReplayWindow); err == nil {
		t.Fatal("tampered body signature unexpectedly verified")
	}
	if err := VerifySignature(&privateKey.PublicKey, "1699999000", nonce, base64.StdEncoding.EncodeToString(signature), raw, now, time.Minute); err == nil {
		t.Fatal("stale notification unexpectedly verified")
	}
}

func TestClientRejectsNotificationForAnotherMerchant(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	plaintext, err := json.Marshal(Transaction{
		AppID: "other-app", MchID: "other-merchant", OutTradeNo: "order-1",
		TransactionID: "transaction-1", TradeState: "SUCCESS", Amount: Amount{Total: 3900, Currency: "CNY"},
	})
	if err != nil {
		t.Fatalf("marshal transaction: %v", err)
	}
	raw, err := json.Marshal(Notification{ID: "event-1", EventType: "TRANSACTION.SUCCESS", Resource: encryptResource(t, key, plaintext, "associated-data")})
	if err != nil {
		t.Fatalf("marshal notification: %v", err)
	}
	client := &Client{appID: "expected-app", mchID: "expected-merchant", apiV3Key: key}
	if _, _, err := client.ParseNotification(raw); err == nil {
		t.Fatal("foreign merchant notification unexpectedly accepted")
	}
}

func encryptResource(t *testing.T, key string, plaintext []byte, associatedData string) Resource {
	t.Helper()
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("new gcm: %v", err)
	}
	nonce := []byte("nonce-value1") // WeChat v3 resource nonces are 12-byte ASCII strings.
	ciphertext := gcm.Seal(nil, nonce, plaintext, []byte(associatedData))
	return Resource{Algorithm: "AEAD_AES_256_GCM", Ciphertext: base64.StdEncoding.EncodeToString(ciphertext), Nonce: string(nonce), AssociatedData: associatedData}
}
