package biz

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/golang-jwt/jwt/v5"
)

const rsaSigningAlgorithm = "RS256"

type accessClaims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KTY string `json:"kty"`
	Use string `json:"use,omitempty"`
	Alg string `json:"alg,omitempty"`
	KID string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type signingKeySet struct {
	activeKID  string
	privateKey *rsa.PrivateKey
	publicKeys map[string]*rsa.PublicKey
	jwks       []byte
}

func loadSigningKeySet(cfg *conf.Bootstrap) (*signingKeySet, error) {
	if strings.TrimSpace(cfg.JWT.Issuer) == "" || strings.TrimSpace(cfg.JWT.Audience) == "" {
		return nil, fmt.Errorf("JWT issuer and audience are required")
	}
	production := isProductionEnvironment(cfg.Environment)
	if production && strings.TrimSpace(cfg.JWT.PrivateKeyFile) == "" {
		return nil, fmt.Errorf("JWT_PRIVATE_KEY_FILE is required in production")
	}
	if production && strings.TrimSpace(cfg.JWT.JWKSFile) == "" {
		return nil, fmt.Errorf("JWT_JWKS_FILE is required in production so rotation retains previous public keys")
	}
	activeKID := strings.TrimSpace(cfg.JWT.ActiveKeyID)
	privateKey, generated, err := loadPrivateKey(cfg.JWT.PrivateKeyFile)
	if err != nil {
		return nil, err
	}
	if generated {
		if activeKID == "" {
			activeKID = "development-ephemeral"
		}
	}
	if activeKID == "" {
		return nil, fmt.Errorf("JWT_ACTIVE_KID is required when a private key is configured")
	}
	publicKeys, err := loadPublicKeys(cfg.JWT.JWKSFile)
	if err != nil {
		return nil, err
	}
	configured, activeKeyPublished := publicKeys[activeKID]
	if production && !activeKeyPublished {
		return nil, fmt.Errorf("active JWT key %q is missing from JWT_JWKS_FILE", activeKID)
	}
	if activeKeyPublished && !samePublicKey(configured, &privateKey.PublicKey) {
		return nil, fmt.Errorf("active JWT key %q does not match the configured JWKS", activeKID)
	}
	publicKeys[activeKID] = &privateKey.PublicKey

	document := jwksDocument{Keys: make([]jwk, 0, len(publicKeys))}
	for kid, key := range publicKeys {
		document.Keys = append(document.Keys, publicJWK(kid, key))
	}
	sort.Slice(document.Keys, func(i, j int) bool { return document.Keys[i].KID < document.Keys[j].KID })
	rawJWKS, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("marshal JWKS: %w", err)
	}
	return &signingKeySet{activeKID: activeKID, privateKey: privateKey, publicKeys: publicKeys, jwks: rawJWKS}, nil
}

func isProductionEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

func loadPrivateKey(path string) (*rsa.PrivateKey, bool, error) {
	if strings.TrimSpace(path) == "" {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, false, fmt.Errorf("generate development RSA key: %w", err)
		}
		return key, true, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, false, fmt.Errorf("read JWT private key: %w", err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, false, fmt.Errorf("decode JWT private key PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		if err := validateRSAKey(key); err != nil {
			return nil, false, err
		}
		return key, false, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, false, fmt.Errorf("parse JWT private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, false, fmt.Errorf("JWT private key must be RSA")
	}
	if err := validateRSAKey(key); err != nil {
		return nil, false, err
	}
	return key, false, nil
}

func validateRSAKey(key *rsa.PrivateKey) error {
	if key == nil || key.N == nil || key.N.BitLen() < 2048 {
		return fmt.Errorf("JWT RSA private key must be at least 2048 bits")
	}
	return key.Validate()
}

func loadPublicKeys(path string) (map[string]*rsa.PublicKey, error) {
	keys := map[string]*rsa.PublicKey{}
	if strings.TrimSpace(path) == "" {
		return keys, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read JWT JWKS: %w", err)
	}
	var document jwksDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("parse JWT JWKS: %w", err)
	}
	for _, entry := range document.Keys {
		if entry.KTY != "RSA" || entry.Alg != "" && entry.Alg != rsaSigningAlgorithm {
			continue
		}
		if strings.TrimSpace(entry.KID) == "" {
			return nil, fmt.Errorf("JWKS RSA key is missing kid")
		}
		key, err := rsaPublicKey(entry)
		if err != nil {
			return nil, fmt.Errorf("JWKS key %q: %w", entry.KID, err)
		}
		if _, exists := keys[entry.KID]; exists {
			return nil, fmt.Errorf("JWKS contains duplicate kid %q", entry.KID)
		}
		keys[entry.KID] = key
	}
	return keys, nil
}

func rsaPublicKey(entry jwk) (*rsa.PublicKey, error) {
	n, err := base64.RawURLEncoding.DecodeString(entry.N)
	if err != nil {
		return nil, fmt.Errorf("decode modulus: %w", err)
	}
	e, err := base64.RawURLEncoding.DecodeString(entry.E)
	if err != nil {
		return nil, fmt.Errorf("decode exponent: %w", err)
	}
	if len(n) == 0 || len(e) == 0 || len(e) > 4 {
		return nil, fmt.Errorf("invalid RSA key parameters")
	}
	exponent := 0
	for _, value := range e {
		exponent = exponent<<8 | int(value)
	}
	key := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
	if key.N.BitLen() < 2048 || key.E < 3 {
		return nil, fmt.Errorf("RSA key is too weak")
	}
	return key, nil
}

func publicJWK(kid string, key *rsa.PublicKey) jwk {
	exponent := big.NewInt(int64(key.E)).Bytes()
	return jwk{
		KTY: "RSA",
		Use: "sig",
		Alg: rsaSigningAlgorithm,
		KID: kid,
		N:   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(exponent),
	}
}

func samePublicKey(left, right *rsa.PublicKey) bool {
	return left != nil && right != nil && left.E == right.E && left.N.Cmp(right.N) == 0
}

func (keys *signingKeySet) sign(userID, email, issuer, audience string, now time.Time, ttl time.Duration) (string, error) {
	claims := accessClaims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keys.activeKID
	return token.SignedString(keys.privateKey)
}

func (keys *signingKeySet) verify(raw, issuer, audience string) (accessClaims, error) {
	claims := accessClaims{}
	token, err := jwt.ParseWithClaims(raw, &claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != rsaSigningAlgorithm {
			return nil, fmt.Errorf("unexpected JWT signing algorithm")
		}
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("JWT kid is required")
		}
		key, ok := keys.publicKeys[kid]
		if !ok {
			return nil, fmt.Errorf("JWT kid is not trusted")
		}
		return key, nil
	}, jwt.WithIssuer(issuer), jwt.WithAudience(audience), jwt.WithValidMethods([]string{rsaSigningAlgorithm}))
	if err != nil || !token.Valid {
		if err == nil {
			err = fmt.Errorf("invalid JWT")
		}
		return accessClaims{}, err
	}
	return claims, nil
}

func (keys *signingKeySet) JWKS() []byte {
	return append([]byte(nil), keys.jwks...)
}
