package biz

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/golang-jwt/jwt/v5"
)

func TestSigningKeySetPublishesAndVerifiesRotatingKeys(t *testing.T) {
	activeKey := mustRSAKey(t)
	previousKey := mustRSAKey(t)
	dir := t.TempDir()
	privateKeyPath := filepath.Join(dir, "active.pem")
	writePrivateKey(t, privateKeyPath, activeKey)
	jwksPath := filepath.Join(dir, "jwks.json")
	writeJWKS(t, jwksPath, jwksDocument{Keys: []jwk{
		publicJWK("2026-07", &activeKey.PublicKey),
		publicJWK("2026-06", &previousKey.PublicKey),
	}})

	keys, err := loadSigningKeySet(&conf.Bootstrap{
		Environment: "production",
		JWT: conf.JWTConfig{
			Issuer:         "https://auth.example.test",
			Audience:       "dramaip-api",
			ActiveKeyID:    "2026-07",
			PrivateKeyFile: privateKeyPath,
			JWKSFile:       jwksPath,
		},
	})
	if err != nil {
		t.Fatalf("loadSigningKeySet: %v", err)
	}

	now := time.Now().UTC()
	accessToken, err := keys.sign("user-1", "user@example.test", "https://auth.example.test", "dramaip-api", now, time.Hour)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := keys.verify(accessToken, "https://auth.example.test", "dramaip-api")
	if err != nil {
		t.Fatalf("verify active token: %v", err)
	}
	if claims.Subject != "user-1" || claims.Email != "user@example.test" {
		t.Fatalf("claims = %+v", claims)
	}

	oldClaims := accessClaims{Email: "old@example.test", RegisteredClaims: jwt.RegisteredClaims{
		Issuer: "https://auth.example.test", Subject: "user-old", Audience: jwt.ClaimStrings{"dramaip-api"},
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	}}
	oldToken := jwt.NewWithClaims(jwt.SigningMethodRS256, oldClaims)
	oldToken.Header["kid"] = "2026-06"
	oldRaw, err := oldToken.SignedString(previousKey)
	if err != nil {
		t.Fatalf("sign old token: %v", err)
	}
	if _, err := keys.verify(oldRaw, "https://auth.example.test", "dramaip-api"); err != nil {
		t.Fatalf("verify retained key token: %v", err)
	}

	var published jwksDocument
	if err := json.Unmarshal(keys.JWKS(), &published); err != nil {
		t.Fatalf("parse published JWKS: %v", err)
	}
	if len(published.Keys) != 2 || published.Keys[0].KID != "2026-06" || published.Keys[1].KID != "2026-07" {
		t.Fatalf("published keys = %+v", published.Keys)
	}
}

func TestSigningKeySetRejectsWrongAudienceAndHMAC(t *testing.T) {
	key := mustRSAKey(t)
	keys := &signingKeySet{activeKID: "active", privateKey: key, publicKeys: map[string]*rsa.PublicKey{"active": &key.PublicKey}}
	now := time.Now().UTC()
	valid, err := keys.sign("user-1", "user@example.test", "issuer", "audience", now, time.Hour)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := keys.verify(valid, "issuer", "other-audience"); err == nil {
		t.Fatal("verify accepted a wrong audience")
	}
	if _, err := keys.verify(valid, "other-issuer", "audience"); err == nil {
		t.Fatal("verify accepted a wrong issuer")
	}

	hmac := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Issuer: "issuer", Subject: "user-1", Audience: jwt.ClaimStrings{"audience"},
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	})
	hmac.Header["kid"] = "active"
	hmacRaw, err := hmac.SignedString([]byte("not-a-production-shared-secret"))
	if err != nil {
		t.Fatalf("sign HMAC token: %v", err)
	}
	if _, err := keys.verify(hmacRaw, "issuer", "audience"); err == nil {
		t.Fatal("verify accepted HS256")
	}

	unknownKID := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.RegisteredClaims{
		Issuer: "issuer", Subject: "user-1", Audience: jwt.ClaimStrings{"audience"},
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	})
	unknownKID.Header["kid"] = "unknown"
	unknownRaw, err := unknownKID.SignedString(key)
	if err != nil {
		t.Fatalf("sign unknown kid token: %v", err)
	}
	if _, err := keys.verify(unknownRaw, "issuer", "audience"); err == nil {
		t.Fatal("verify accepted an unknown kid")
	}

	expired := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.RegisteredClaims{
		Issuer: "issuer", Subject: "user-1", Audience: jwt.ClaimStrings{"audience"},
		ExpiresAt: jwt.NewNumericDate(now.Add(-time.Minute)),
	})
	expired.Header["kid"] = "active"
	expiredRaw, err := expired.SignedString(key)
	if err != nil {
		t.Fatalf("sign expired token: %v", err)
	}
	if _, err := keys.verify(expiredRaw, "issuer", "audience"); err == nil {
		t.Fatal("verify accepted an expired token")
	}
}

func TestProductionKeySetRequiresMountedKeyMaterial(t *testing.T) {
	_, err := loadSigningKeySet(&conf.Bootstrap{Environment: "production", JWT: conf.JWTConfig{Issuer: "issuer", Audience: "audience"}})
	if err == nil {
		t.Fatal("production configuration unexpectedly generated a key")
	}
}

func TestProductionAliasesRequireMountedKeyMaterial(t *testing.T) {
	for _, environment := range []string{"production", "prod"} {
		t.Run(environment, func(t *testing.T) {
			_, err := loadSigningKeySet(&conf.Bootstrap{
				Environment: environment,
				JWT:         conf.JWTConfig{Issuer: "issuer", Audience: "audience"},
			})
			if err == nil {
				t.Fatal("production alias accepted missing key material")
			}
		})
	}
}

func TestProductionRequiresActiveKeyInJWKS(t *testing.T) {
	activeKey := mustRSAKey(t)
	retainedKey := mustRSAKey(t)
	dir := t.TempDir()
	privateKeyPath := filepath.Join(dir, "active.pem")
	writePrivateKey(t, privateKeyPath, activeKey)
	jwksPath := filepath.Join(dir, "jwks.json")
	writeJWKS(t, jwksPath, jwksDocument{Keys: []jwk{publicJWK("retained", &retainedKey.PublicKey)}})
	_, err := loadSigningKeySet(&conf.Bootstrap{
		Environment: "prod",
		JWT: conf.JWTConfig{
			Issuer: "issuer", Audience: "audience", ActiveKeyID: "active",
			PrivateKeyFile: privateKeyPath, JWKSFile: jwksPath,
		},
	})
	if err == nil {
		t.Fatal("production key set accepted an active key absent from JWKS")
	}
}

func mustRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return key
}

func writePrivateKey(t *testing.T, path string, key *rsa.PrivateKey) {
	t.Helper()
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw}), 0o600); err != nil {
		t.Fatalf("WriteFile private key: %v", err)
	}
}

func writeJWKS(t *testing.T, path string, document jwksDocument) {
	t.Helper()
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("Marshal JWKS: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("WriteFile JWKS: %v", err)
	}
}
