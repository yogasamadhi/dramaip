package platform

import (
	"encoding/json"
	"net/http"
	"strings"
)

// PublicContractVersion is the currently supported HTTP BFF contract. New
// breaking changes must be introduced as another version instead of changing
// this contract in place.
const PublicContractVersion = "1"

const (
	ContractVersionHeader = "X-DramaIP-Contract-Version"
	ContractTraceHeader   = "X-DramaIP-Trace-Id"
)

// ClientContractMiddleware declares the response contract and rejects an
// explicitly unsupported client contract. Omitting the request header remains
// supported during the v1 migration window for already-shipped clients.
func ClientContractMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := TraceID(r.Context())
		if traceID == "" {
			traceID = "unavailable"
		}
		w.Header().Set(ContractVersionHeader, PublicContractVersion)
		w.Header().Set(ContractTraceHeader, traceID)
		if requested := strings.TrimSpace(r.Header.Get(ContractVersionHeader)); requested != "" && requested != PublicContractVersion {
			writeContractError(w, http.StatusUpgradeRequired, "contract_version_unsupported")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ContractErrorBody(w http.ResponseWriter, code string) map[string]string {
	traceID := strings.TrimSpace(w.Header().Get(ContractTraceHeader))
	if traceID == "" {
		traceID = "unavailable"
	}
	return map[string]string{"code": code, "message": code, "trace_id": traceID}
}

func writeContractError(w http.ResponseWriter, statusCode int, code string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": ContractErrorBody(w, code)})
}
