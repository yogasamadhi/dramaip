// kong-jwt-config renders the production Kong declarative configuration from
// the public JWKS used by auth-service. It intentionally never reads a private
// signing key.
package main

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
)

const (
	jwtPluginMarker      = "          # JWT_PLUGIN"
	jwtCredentialsMarker = "# JWT_CREDENTIALS"
)

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KTY string `json:"kty"`
	Alg string `json:"alg"`
	KID string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type kongCredential struct {
	kid string
	pem string
}

func main() {
	var templatePath string
	var jwksPath string
	var outputPath string
	flag.StringVar(&templatePath, "template", "../../deploy/kong/kong.yml", "Kong declarative configuration template")
	flag.StringVar(&jwksPath, "jwks", "", "path to auth-service public JWKS JSON")
	flag.StringVar(&outputPath, "out", "", "path for the rendered production Kong configuration")
	flag.Parse()
	if jwksPath == "" || outputPath == "" {
		flag.Usage()
		os.Exit(2)
	}
	template, err := os.ReadFile(templatePath)
	if err != nil {
		fatal(err)
	}
	rawJWKS, err := os.ReadFile(jwksPath)
	if err != nil {
		fatal(err)
	}
	rendered, err := renderKongConfig(string(template), rawJWKS)
	if err != nil {
		fatal(err)
	}
	if err := os.WriteFile(outputPath, []byte(rendered), 0o644); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "kong-jwt-config:", err)
	os.Exit(1)
}

func renderKongConfig(template string, rawJWKS []byte) (string, error) {
	if strings.Count(template, jwtPluginMarker) != 1 || strings.Count(template, jwtCredentialsMarker) != 1 {
		return "", errors.New("Kong template must contain exactly one JWT_PLUGIN and one JWT_CREDENTIALS marker")
	}
	credentials, err := credentialsFromJWKS(rawJWKS)
	if err != nil {
		return "", err
	}
	template = strings.Replace(template, jwtPluginMarker, kongJWTPlugin(), 1)
	return strings.Replace(template, jwtCredentialsMarker, kongCredentials(credentials), 1), nil
}

func credentialsFromJWKS(raw []byte) ([]kongCredential, error) {
	var document jwksDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("parse JWKS: %w", err)
	}
	if len(document.Keys) == 0 {
		return nil, errors.New("JWKS has no verification keys")
	}
	credentials := make([]kongCredential, 0, len(document.Keys))
	seen := map[string]struct{}{}
	for _, entry := range document.Keys {
		if entry.KTY != "RSA" || entry.Alg != "RS256" {
			return nil, fmt.Errorf("JWKS key %q is not an RS256 RSA key", entry.KID)
		}
		if !safeKID(entry.KID) {
			return nil, fmt.Errorf("JWKS key has an unsafe kid %q", entry.KID)
		}
		if _, exists := seen[entry.KID]; exists {
			return nil, fmt.Errorf("JWKS contains duplicate kid %q", entry.KID)
		}
		publicKey, err := rsaPublicKey(entry)
		if err != nil {
			return nil, fmt.Errorf("JWKS key %q: %w", entry.KID, err)
		}
		rawPEM, err := x509.MarshalPKIXPublicKey(publicKey)
		if err != nil {
			return nil, fmt.Errorf("marshal public key %q: %w", entry.KID, err)
		}
		seen[entry.KID] = struct{}{}
		credentials = append(credentials, kongCredential{kid: entry.KID, pem: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: rawPEM}))})
	}
	sort.Slice(credentials, func(i, j int) bool { return credentials[i].kid < credentials[j].kid })
	return credentials, nil
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
		return nil, errors.New("invalid RSA key parameters")
	}
	exponent := 0
	for _, value := range e {
		exponent = exponent<<8 | int(value)
	}
	key := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}
	if key.N.BitLen() < 2048 || key.E < 3 {
		return nil, errors.New("RSA key is too weak")
	}
	return key, nil
}

func safeKID(kid string) bool {
	if kid == "" {
		return false
	}
	for _, character := range kid {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '.' || character == '_' || character == '-') {
			return false
		}
	}
	return true
}

func kongJWTPlugin() string {
	return `          - name: jwt
            config:
              key_claim_name: kid
              cookie_names:
                - dramaip_web_access
              run_on_preflight: false
              claims_to_verify:
                - exp
                - nbf`
}

func kongCredentials(credentials []kongCredential) string {
	var builder strings.Builder
	builder.WriteString("consumers:\n  - username: dramaip-auth\n    jwt_secrets:\n")
	for _, credential := range credentials {
		builder.WriteString("      - key: ")
		builder.WriteString(credential.kid)
		builder.WriteString("\n        algorithm: RS256\n        secret: unused-rs256-credential\n        rsa_public_key: |\n")
		for _, line := range strings.Split(strings.TrimSuffix(credential.pem, "\n"), "\n") {
			builder.WriteString("          ")
			builder.WriteString(line)
			builder.WriteByte('\n')
		}
	}
	return strings.TrimSuffix(builder.String(), "\n")
}
