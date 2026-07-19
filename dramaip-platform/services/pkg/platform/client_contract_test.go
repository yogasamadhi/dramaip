package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientContractMiddlewareDeclaresV1AndRejectsUnsupportedVersions(t *testing.T) {
	handler := TraceMiddleware("contract-test", ClientContractMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	accepted := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/test", nil)
	request.Header.Set(ContractVersionHeader, PublicContractVersion)
	handler.ServeHTTP(accepted, request)
	if accepted.Code != http.StatusNoContent || accepted.Header().Get(ContractVersionHeader) != PublicContractVersion || accepted.Header().Get(ContractTraceHeader) == "" {
		t.Fatalf("accepted contract response = status=%d headers=%v", accepted.Code, accepted.Header())
	}

	rejected := httptest.NewRecorder()
	unsupported := httptest.NewRequest(http.MethodGet, "/v1/test", nil)
	unsupported.Header.Set(ContractVersionHeader, "2")
	handler.ServeHTTP(rejected, unsupported)
	if rejected.Code != http.StatusUpgradeRequired {
		t.Fatalf("unsupported version status = %d: %s", rejected.Code, rejected.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			TraceID string `json:"trace_id"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rejected.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "contract_version_unsupported" || body.Error.Message == "" || body.Error.TraceID == "" {
		t.Fatalf("unsupported version error = %#v", body.Error)
	}
}
