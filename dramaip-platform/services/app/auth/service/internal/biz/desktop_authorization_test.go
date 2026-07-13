package biz

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestDesktopPKCEInputValidation(t *testing.T) {
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abcdefghijk"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	if !validDesktopVerifier(verifier) || !validDesktopAuthorizationRequest(challenge, "http://127.0.0.1:43123/callback", "desktop-12345678") {
		t.Fatal("valid PKCE desktop request rejected")
	}
	if desktopCodeChallenge(verifier) != challenge {
		t.Fatal("PKCE challenge is not S256 verifier hash")
	}
	for _, redirectURI := range []string{
		"https://127.0.0.1:43123/callback",
		"http://localhost:43123/callback",
		"http://127.0.0.1:43123/other",
		"http://127.0.0.1:43123/callback?code=leak",
	} {
		if validDesktopRedirectURI(redirectURI) {
			t.Fatalf("unsafe redirect URI accepted: %s", redirectURI)
		}
	}
	if validDesktopVerifier("short") || validDesktopVerifier(verifier+"!") {
		t.Fatal("invalid verifier accepted")
	}
}
