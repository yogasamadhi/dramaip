// Package wechat contains the protocol-only pieces of a WeChat Pay v3
// notification. It has no billing database dependency, so signature and
// ciphertext handling stay independently testable and reusable by the
// webhook ingress and reconciliation job.
package wechat

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"strconv"
	"time"
)

const DefaultReplayWindow = 5 * time.Minute

type Notification struct {
	ID        string   `json:"id"`
	EventType string   `json:"event_type"`
	Resource  Resource `json:"resource"`
}

type Resource struct {
	Algorithm      string `json:"algorithm"`
	Ciphertext     string `json:"ciphertext"`
	Nonce          string `json:"nonce"`
	AssociatedData string `json:"associated_data"`
}

type Transaction struct {
	AppID          string `json:"appid"`
	MchID          string `json:"mchid"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionID  string `json:"transaction_id"`
	TradeState     string `json:"trade_state"`
	TradeStateDesc string `json:"trade_state_desc"`
	Amount         Amount `json:"amount"`
}

type Amount struct {
	Total    int64  `json:"total"`
	Currency string `json:"currency"`
}

// VerifySignature rejects a malformed, forged, or stale request before its
// ciphertext is parsed. The signed canonical message is exactly the WeChat v3
// timestamp, nonce and raw HTTP body; decoding/re-encoding JSON first would
// invalidate the signature boundary.
func VerifySignature(publicKey *rsa.PublicKey, timestamp, nonce, signature string, rawBody []byte, now time.Time, replayWindow time.Duration) error {
	if publicKey == nil {
		return fmt.Errorf("wechat pay platform public key is required")
	}
	if nonce == "" || signature == "" || timestamp == "" {
		return fmt.Errorf("wechat pay signature headers are incomplete")
	}
	issuedAt, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return fmt.Errorf("parse wechat pay timestamp: %w", err)
	}
	if replayWindow <= 0 {
		replayWindow = DefaultReplayWindow
	}
	if delta := now.Sub(time.Unix(issuedAt, 0)); delta > replayWindow || delta < -replayWindow {
		return fmt.Errorf("wechat pay notification timestamp outside replay window")
	}
	encoded, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("decode wechat pay signature: %w", err)
	}
	message := []byte(timestamp + "\n" + nonce + "\n" + string(rawBody) + "\n")
	digest := sha256.Sum256(message)
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], encoded); err != nil {
		return fmt.Errorf("verify wechat pay signature: %w", err)
	}
	return nil
}

// ParseNotification decrypts a signed notification resource. Callers must
// verify its headers first; this method deliberately does not treat ciphertext
// decryption as an authenticity check.
func ParseNotification(apiV3Key string, rawBody []byte) (Notification, Transaction, error) {
	var notification Notification
	if err := json.Unmarshal(rawBody, &notification); err != nil {
		return Notification{}, Transaction{}, fmt.Errorf("decode wechat pay notification: %w", err)
	}
	if notification.ID == "" || notification.EventType == "" {
		return Notification{}, Transaction{}, fmt.Errorf("wechat pay notification id or event type is missing")
	}
	if notification.EventType != "TRANSACTION.SUCCESS" {
		return Notification{}, Transaction{}, fmt.Errorf("unsupported wechat pay event type %q", notification.EventType)
	}
	plaintext, err := decryptResource(apiV3Key, notification.Resource)
	if err != nil {
		return Notification{}, Transaction{}, err
	}
	var transaction Transaction
	if err := json.Unmarshal(plaintext, &transaction); err != nil {
		return Notification{}, Transaction{}, fmt.Errorf("decode wechat pay transaction resource: %w", err)
	}
	if transaction.OutTradeNo == "" || transaction.TransactionID == "" || transaction.TradeState != "SUCCESS" || transaction.Amount.Total <= 0 || transaction.Amount.Currency == "" {
		return Notification{}, Transaction{}, fmt.Errorf("wechat pay transaction is not a successful order")
	}
	return notification, transaction, nil
}

func decryptResource(apiV3Key string, resource Resource) ([]byte, error) {
	if len(apiV3Key) != 32 {
		return nil, fmt.Errorf("wechat pay api v3 key must be exactly 32 bytes")
	}
	if resource.Algorithm != "AEAD_AES_256_GCM" {
		return nil, fmt.Errorf("unsupported wechat pay resource algorithm %q", resource.Algorithm)
	}
	if resource.Nonce == "" || resource.Ciphertext == "" {
		return nil, fmt.Errorf("wechat pay encrypted resource is incomplete")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(resource.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("decode wechat pay ciphertext: %w", err)
	}
	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(resource.Nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid wechat pay resource nonce length")
	}
	plaintext, err := gcm.Open(nil, []byte(resource.Nonce), ciphertext, []byte(resource.AssociatedData))
	if err != nil {
		return nil, fmt.Errorf("decrypt wechat pay resource: %w", err)
	}
	return plaintext, nil
}

func ParsePlatformPublicKey(raw []byte) (*rsa.PublicKey, error) {
	// The configured platform certificate is PEM/X.509 in production. Keeping
	// parsing out of the request path makes certificate refresh explicit.
	return parseRSAPublicKey(raw)
}

func parseRSAPublicKey(raw []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("decode wechat pay platform PEM")
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		key, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("wechat pay platform certificate key is not RSA")
		}
		return key, nil
	}
	if key, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("wechat pay platform public key is not RSA")
		}
		return rsaKey, nil
	}
	return nil, fmt.Errorf("parse wechat pay platform certificate or public key")
}
