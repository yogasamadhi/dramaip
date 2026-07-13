package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthorizeReconciliationOperator(t *testing.T) {
	disabled := httptest.NewRecorder()
	if authorizeReconciliationOperator(disabled, httptest.NewRequest(http.MethodGet, "/internal/reconciliation/items", nil), "") {
		t.Fatal("empty operator token must disable reconciliation API")
	}
	if disabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled API status = %d", disabled.Code)
	}

	denied := httptest.NewRecorder()
	wrong := httptest.NewRequest(http.MethodGet, "/internal/reconciliation/items", nil)
	wrong.Header.Set("Authorization", "Bearer wrong")
	if authorizeReconciliationOperator(denied, wrong, "expected") {
		t.Fatal("wrong operator token was accepted")
	}
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token status = %d", denied.Code)
	}

	allowed := httptest.NewRecorder()
	valid := httptest.NewRequest(http.MethodGet, "/internal/reconciliation/items", nil)
	valid.Header.Set("Authorization", "Bearer expected")
	if !authorizeReconciliationOperator(allowed, valid, "expected") {
		t.Fatal("valid operator token was rejected")
	}
}
