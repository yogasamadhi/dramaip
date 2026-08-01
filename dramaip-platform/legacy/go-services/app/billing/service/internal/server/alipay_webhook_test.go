package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/billing/internal/alipay"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
)

func TestAlipayWebhookOnlyActivatesAfterMatchingServerConfirmation(t *testing.T) {
	client := &fakeAlipayWebhookClient{
		notification: alipay.Notification{NotifyID: "notify-1", NotifyTime: "2026-07-13 12:00:00", AppID: "app-1", SellerID: "seller-1", OutTradeNo: "order-1", TradeNo: "trade-1", TradeStatus: "TRADE_SUCCESS", TotalAmount: "39.00", TotalCents: 3900},
		queried:      alipay.Transaction{SellerID: "seller-1", OutTradeNo: "order-1", TradeNo: "trade-1", TradeStatus: "TRADE_SUCCESS", TotalAmount: "39.00", TotalCents: 3900},
	}
	uc := &fakeAlipayWebhookUsecase{}
	handler := &alipayWebhook{enabled: true, client: client, uc: uc}
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, alipayWebhookRequest())
	if recorder.Code != http.StatusOK || recorder.Body.String() != "success" || client.queries != 1 || uc.confirmed != 1 || uc.recorded.ProviderEventID != "notify-1" {
		t.Fatalf("webhook code=%d body=%q queries=%d confirmed=%d recorded=%#v", recorder.Code, recorder.Body.String(), client.queries, uc.confirmed, uc.recorded)
	}
	if uc.queryConfirmed != 1 || uc.queryFailed != 0 || !strings.Contains(string(uc.recorded.AuditPayload), `"out_trade_no":"order-1"`) {
		t.Fatalf("query calls confirmed=%d failed=%d audit=%s", uc.queryConfirmed, uc.queryFailed, uc.recorded.AuditPayload)
	}
}

func TestAlipayWebhookRejectsForgedAndDoesNotWriteInbox(t *testing.T) {
	handler := &alipayWebhook{enabled: true, client: &fakeAlipayWebhookClient{verifyErr: errors.New("signature mismatch")}, uc: &fakeAlipayWebhookUsecase{}}
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, alipayWebhookRequest())
	if recorder.Code != http.StatusUnauthorized || recorder.Body.String() != "failure" {
		t.Fatalf("forged webhook code=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestAlipayWebhookAcknowledgesProcessedReplayWithoutQuery(t *testing.T) {
	client := &fakeAlipayWebhookClient{notification: alipay.Notification{NotifyID: "notify-replay", NotifyTime: "2026-07-13 12:00:00", AppID: "app-1", SellerID: "seller-1", OutTradeNo: "order-1", TradeNo: "trade-1", TradeStatus: "TRADE_SUCCESS", TotalAmount: "39.00", TotalCents: 3900}}
	uc := &fakeAlipayWebhookUsecase{receipt: data.AlipayWebhookReceipt{Processed: true}}
	handler := &alipayWebhook{enabled: true, client: client, uc: uc}
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, alipayWebhookRequest())
	if recorder.Code != http.StatusOK || client.queries != 0 || uc.confirmed != 0 {
		t.Fatalf("replay code=%d queries=%d confirmed=%d", recorder.Code, client.queries, uc.confirmed)
	}
}

func TestAlipayWebhookDoesNotActivateOnQueryMismatch(t *testing.T) {
	client := &fakeAlipayWebhookClient{
		notification: alipay.Notification{NotifyID: "notify-mismatch", NotifyTime: "2026-07-13 12:00:00", AppID: "app-1", SellerID: "seller-1", OutTradeNo: "order-1", TradeNo: "trade-1", TradeStatus: "TRADE_SUCCESS", TotalAmount: "39.00", TotalCents: 3900},
		queried:      alipay.Transaction{SellerID: "seller-1", OutTradeNo: "order-1", TradeNo: "other", TradeStatus: "TRADE_SUCCESS", TotalAmount: "39.00", TotalCents: 3900},
	}
	uc := &fakeAlipayWebhookUsecase{}
	handler := &alipayWebhook{enabled: true, client: client, uc: uc}
	recorder := httptest.NewRecorder()
	handler.Handle(recorder, alipayWebhookRequest())
	if recorder.Code != http.StatusConflict || uc.confirmed != 0 || uc.queryFailed != 1 {
		t.Fatalf("mismatch code=%d confirmed=%d failed=%d", recorder.Code, uc.confirmed, uc.queryFailed)
	}
}

func alipayWebhookRequest() *http.Request {
	values := url.Values{"sign": {"signature"}, "sign_type": {"RSA2"}, "notify_id": {"placeholder"}}
	return httptest.NewRequest(http.MethodPost, "/v1/webhooks/alipay", strings.NewReader(values.Encode()))
}

type fakeAlipayWebhookClient struct {
	verifyErr    error
	notification alipay.Notification
	queried      alipay.Transaction
	queryPayload []byte
	queries      int
}

func (f *fakeAlipayWebhookClient) VerifyNotification(url.Values) error {
	return f.verifyErr
}

func (f *fakeAlipayWebhookClient) ParseNotification(url.Values) (alipay.Notification, error) {
	return f.notification, nil
}

func (f *fakeAlipayWebhookClient) QueryTransaction(context.Context, string) (alipay.Transaction, []byte, error) {
	f.queries++
	return f.queried, f.queryPayload, nil
}

type fakeAlipayWebhookUsecase struct {
	receipt        data.AlipayWebhookReceipt
	recorded       data.AlipayWebhookEvent
	queryConfirmed int
	queryFailed    int
	confirmed      int
}

func (f *fakeAlipayWebhookUsecase) RecordAlipayWebhook(_ context.Context, event data.AlipayWebhookEvent) (data.AlipayWebhookReceipt, error) {
	f.recorded = event
	return f.receipt, nil
}

func (f *fakeAlipayWebhookUsecase) MarkAlipayWebhookQueryFailed(context.Context, string, string) error {
	f.queryFailed++
	return nil
}

func (f *fakeAlipayWebhookUsecase) MarkAlipayWebhookQueryConfirmed(context.Context, string, []byte) error {
	f.queryConfirmed++
	return nil
}

func (f *fakeAlipayWebhookUsecase) ConfirmAlipayPayment(context.Context, string, string, string, int64, string, []byte) (data.SimulatedPaymentResult, error) {
	f.confirmed++
	return data.SimulatedPaymentResult{}, nil
}
