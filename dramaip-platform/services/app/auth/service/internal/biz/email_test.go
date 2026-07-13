package biz

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestEmailActionSenderDeliversCodeOnlyInRequestBody(t *testing.T) {
	var got emailEnvelope
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.String() != "/deliver" {
			t.Fatalf("delivery URL = %q", r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	sender := newEmailActionSender(conf.EmailConfig{DeliveryURL: server.URL + "/deliver", DeliveryToken: "test-token", From: "noreply@example.test"}, "test")
	if err := sender.Send(context.Background(), "creator@example.test", "verify_email", "ABCDEFG2"); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if got.To != "creator@example.test" || got.Template != "verify_email" || got.From != "noreply@example.test" {
		t.Fatalf("envelope = %+v", got)
	}
	if got.Subject == "" || got.Text == "" || !containsCode(got.Text, "ABCDEFG2") {
		t.Fatalf("delivery body = %+v", got)
	}
}

func TestEmailActionSenderRequiresConfiguredDelivery(t *testing.T) {
	err := newEmailActionSender(conf.EmailConfig{}, "test").Send(context.Background(), "creator@example.test", "verify_email", "ABCDEFG2")
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("error code = %s, want %s", status.Code(err), codes.FailedPrecondition)
	}
}

func TestEmailActionSenderRequiresHTTPSInProduction(t *testing.T) {
	err := newEmailActionSender(conf.EmailConfig{DeliveryURL: "http://mail.example.test/deliver"}, "production").Send(context.Background(), "creator@example.test", "verify_email", "ABCDEFG2")
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("error code = %s, want %s", status.Code(err), codes.FailedPrecondition)
	}
}

func containsCode(value string, code string) bool {
	for index := 0; index+len(code) <= len(value); index++ {
		if value[index:index+len(code)] == code {
			return true
		}
	}
	return false
}
