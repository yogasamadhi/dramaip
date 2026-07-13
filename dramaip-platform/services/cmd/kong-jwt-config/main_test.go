package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderKongConfigUsesEveryRS256VerificationKey(t *testing.T) {
	first, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	second, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(jwksDocument{Keys: []jwk{testJWK("2026-07", &first.PublicKey), testJWK("2026-06", &second.PublicKey)}})
	if err != nil {
		t.Fatal(err)
	}
	template := "services:\n  - routes:\n      - plugins:\n          # JWT_PLUGIN\n# JWT_CREDENTIALS\n"
	rendered, err := renderKongConfig(template, raw)
	if err != nil {
		t.Fatalf("renderKongConfig: %v", err)
	}
	for _, expected := range []string{"key_claim_name: kid", "cookie_names:", "- dramaip_web_access", "run_on_preflight: false", "- key: 2026-06", "- key: 2026-07", "algorithm: RS256", "BEGIN PUBLIC KEY"} {
		if !strings.Contains(rendered, expected) {
			t.Fatalf("rendered config missing %q:\n%s", expected, rendered)
		}
	}
	if strings.Contains(rendered, "HS256") {
		t.Fatalf("rendered config retained HMAC: %s", rendered)
	}
}

func TestRenderKongConfigRejectsUnsafeKID(t *testing.T) {
	raw := []byte(`{"keys":[{"kty":"RSA","alg":"RS256","kid":"bad:yaml","n":"AQ","e":"AQAB"}]}`)
	template := "services:\n  - routes:\n      - plugins:\n          # JWT_PLUGIN\n# JWT_CREDENTIALS\n"
	if _, err := renderKongConfig(template, raw); err == nil {
		t.Fatal("unsafe kid was accepted")
	}
}

func TestProductionTemplateRendersRS256Plugin(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(jwksDocument{Keys: []jwk{testJWK("active", &key.PublicKey)}})
	if err != nil {
		t.Fatal(err)
	}
	template, err := os.ReadFile(filepath.Join("..", "..", "..", "deploy", "kong", "kong.yml"))
	if err != nil {
		t.Fatalf("read Kong template: %v", err)
	}
	rendered, err := renderKongConfig(string(template), raw)
	if err != nil {
		t.Fatalf("render production template: %v", err)
	}
	if strings.Contains(rendered, jwtPluginMarker) || strings.Contains(rendered, jwtCredentialsMarker) || !strings.Contains(rendered, "algorithm: RS256") {
		t.Fatalf("production Kong template was not fully rendered:\n%s", rendered)
	}
	for _, header := range []string{"name: request-transformer", "X-User-Id", "X-User-Role", "X-Dramaip-User-Id"} {
		if !strings.Contains(rendered, header) {
			t.Fatalf("Kong template does not strip untrusted identity header %q", header)
		}
	}
}

func testJWK(kid string, key *rsa.PublicKey) jwk {
	return jwk{
		KTY: "RSA", Alg: "RS256", KID: kid,
		N: base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		E: base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}
}
