package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	// BFF binds loopback only: external clients must enter through Kong (:8000),
	// which proxies here via host.docker.internal. See deploy/kong/kong.yml.
	addr := getenv("BFF_HTTP_ADDR", "127.0.0.1:8100")

	server := &http.Server{
		Addr:              addr,
		Handler:           newRouter(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("dramaip bff interface listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("bff interface failed: %v", err)
	}
}

func newRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealth)
	mux.HandleFunc("/me/dashboard", handleDashboard)
	mux.HandleFunc("/me/token-balance", handleTokenBalance)
	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "bff-interface",
		"version": "0.1.0",
	})
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":             "demo-user",
		"email":               "creator@example.com",
		"subscription_status": "active",
		"plan":                "pro",
		"quota_tokens":        2_000_000,
		"used_tokens":         380_000,
		"remaining_tokens":    1_620_000,
	})
}

func handleTokenBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"plan":             "pro",
		"quota_tokens":     2_000_000,
		"used_tokens":      380_000,
		"remaining_tokens": 1_620_000,
		"period_start":     "2026-07-01T00:00:00Z",
		"period_end":       "2026-08-01T00:00:00Z",
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write response failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": code,
	})
}

func getenv(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
