package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBFFRoutes(t *testing.T) {
	tests := []struct {
		name string
		path string
		want map[string]any
	}{
		{
			name: "health",
			path: "/healthz",
			want: map[string]any{"ok": true, "service": "bff-interface"},
		},
		{
			name: "dashboard",
			path: "/me/dashboard",
			want: map[string]any{"email": "creator@example.com", "plan": "pro"},
		},
		{
			name: "token balance",
			path: "/me/token-balance",
			want: map[string]any{"plan": "pro", "remaining_tokens": float64(1_620_000)},
		},
	}

	router := newRouter()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}

			var got map[string]any
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode response: %v", err)
			}

			for key, want := range tt.want {
				if got[key] != want {
					t.Fatalf("%s = %v, want %v", key, got[key], want)
				}
			}
		})
	}
}

// CORS is handled at the Kong edge (deploy/kong/kong.yml), not in the BFF.
// This locks in that the BFF must not emit its own CORS headers, which would
// otherwise duplicate Kong's and be rejected by browsers.
func TestBFFDoesNotEmitCORS(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()

	newRouter().ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("BFF must not set Access-Control-Allow-Origin; got %q", got)
	}
}
