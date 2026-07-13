package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/data"
)

func TestJWKSHTTPHandlerPublishesPublicKeySet(t *testing.T) {
	uc, err := biz.NewAuthUsecase(data.NewAuthRepo(&data.Data{}), &conf.Bootstrap{
		Environment: "dev",
		JWT: conf.JWTConfig{
			Issuer: "https://auth.example.test", Audience: "dramaip-api",
			AccessTokenTTL: "15m", RefreshTokenTTL: "720h",
		},
	})
	if err != nil {
		t.Fatalf("NewAuthUsecase: %v", err)
	}
	server := NewHTTPServer(&conf.Bootstrap{Server: conf.ServerConfig{HTTP: conf.EndpointConfig{Addr: ":0"}}}, uc)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET JWKS status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/jwk-set+json" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q", got)
	}
	var document struct {
		Keys []struct {
			KTY string `json:"kty"`
			KID string `json:"kid"`
			N   string `json:"n"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &document); err != nil {
		t.Fatalf("parse JWKS: %v", err)
	}
	if len(document.Keys) != 1 || document.Keys[0].KTY != "RSA" || document.Keys[0].KID == "" || document.Keys[0].N == "" {
		t.Fatalf("JWKS = %s", recorder.Body.String())
	}

	methodNotAllowed := httptest.NewRecorder()
	server.ServeHTTP(methodNotAllowed, httptest.NewRequest(http.MethodPost, "/.well-known/jwks.json", nil))
	if methodNotAllowed.Code != http.StatusMethodNotAllowed || methodNotAllowed.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("POST JWKS = %d, Allow = %q", methodNotAllowed.Code, methodNotAllowed.Header().Get("Allow"))
	}
}
