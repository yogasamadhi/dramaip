package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/internal/wechat"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
)

func TestWechatWebhookOnlyActivatesAfterMatchingServerConfirmation(t *testing.T) {
	client := &fakeWechatWebhookClient{
		notification: wechat.Notification{ID: "event-1"},
		callback:     wechat.Transaction{OutTradeNo: "wx-order-1", TransactionID: "tx-1", TradeState: "SUCCESS", Amount: wechat.Amount{Total: 3900, Currency: "CNY"}},
		queried:      wechat.Transaction{OutTradeNo: "wx-order-1", TransactionID: "tx-1", TradeState: "SUCCESS", Amount: wechat.Amount{Total: 3900, Currency: "CNY"}},
		queryPayload: []byte(`{"out_trade_no":"wx-order-1","transaction_id":"tx-1","trade_state":"SUCCESS"}`),
	}
	uc := &fakeWechatWebhookUsecase{}
	handler := &wechatWebhook{enabled: true, client: client, uc: uc, now: time.Now}
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/wechat-pay", http.NoBody)
	req.Header.Set("Wechatpay-Timestamp", "1700000000")
	req.Header.Set("Wechatpay-Nonce", "nonce")
	req.Header.Set("Wechatpay-Signature", "signature")
	req.Header.Set("Wechatpay-Serial", "serial")
	recorder := httptest.NewRecorder()

	handler.Handle(recorder, req)

	if recorder.Code != http.StatusOK || uc.confirmed != 1 || uc.recorded.ProviderEventID != "event-1" || client.queries != 1 {
		t.Fatalf("webhook result code=%d confirmed=%d recorded=%#v queries=%d", recorder.Code, uc.confirmed, uc.recorded, client.queries)
	}
	if uc.queryConfirmed != 1 || uc.queryFailed != 0 {
		t.Fatalf("reconciliation calls confirmed=%d failed=%d", uc.queryConfirmed, uc.queryFailed)
	}
}

func TestWechatWebhookRejectsForgedAndDoesNotWriteInbox(t *testing.T) {
	client := &fakeWechatWebhookClient{verifyErr: errors.New("signature mismatch")}
	uc := &fakeWechatWebhookUsecase{}
	handler := &wechatWebhook{enabled: true, client: client, uc: uc, now: time.Now}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/wechat-pay", http.NoBody)
	req.Header.Set("Wechatpay-Serial", "serial")
	handler.Handle(recorder, req)
	if recorder.Code != http.StatusUnauthorized || uc.recorded.ProviderEventID != "" {
		t.Fatalf("forged webhook code=%d inbox=%#v", recorder.Code, uc.recorded)
	}
}

func TestWechatWebhookAcknowledgesProcessedReplayWithoutQuery(t *testing.T) {
	client := &fakeWechatWebhookClient{
		notification: wechat.Notification{ID: "event-replay"},
		callback:     wechat.Transaction{OutTradeNo: "wx-order-1", TransactionID: "tx-1", TradeState: "SUCCESS", Amount: wechat.Amount{Total: 3900, Currency: "CNY"}},
	}
	uc := &fakeWechatWebhookUsecase{receipt: data.WechatWebhookReceipt{Processed: true}}
	handler := &wechatWebhook{enabled: true, client: client, uc: uc, now: time.Now}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/wechat-pay", http.NoBody)
	req.Header.Set("Wechatpay-Serial", "serial")
	handler.Handle(recorder, req)
	if recorder.Code != http.StatusOK || client.queries != 0 || uc.confirmed != 0 {
		t.Fatalf("replay code=%d queries=%d confirmed=%d", recorder.Code, client.queries, uc.confirmed)
	}
}

func TestWechatWebhookDoesNotActivateOnQueryMismatch(t *testing.T) {
	client := &fakeWechatWebhookClient{
		notification: wechat.Notification{ID: "event-mismatch"},
		callback:     wechat.Transaction{OutTradeNo: "wx-order-1", TransactionID: "tx-1", TradeState: "SUCCESS", Amount: wechat.Amount{Total: 3900, Currency: "CNY"}},
		queried:      wechat.Transaction{OutTradeNo: "wx-order-1", TransactionID: "other", TradeState: "SUCCESS", Amount: wechat.Amount{Total: 3900, Currency: "CNY"}},
	}
	uc := &fakeWechatWebhookUsecase{}
	handler := &wechatWebhook{enabled: true, client: client, uc: uc, now: time.Now}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/wechat-pay", http.NoBody)
	req.Header.Set("Wechatpay-Serial", "serial")
	handler.Handle(recorder, req)
	if recorder.Code != http.StatusConflict || uc.confirmed != 0 || uc.queryFailed != 1 {
		t.Fatalf("mismatch code=%d confirmed=%d failed=%d", recorder.Code, uc.confirmed, uc.queryFailed)
	}
}

type fakeWechatWebhookClient struct {
	verifyErr    error
	notification wechat.Notification
	callback     wechat.Transaction
	queried      wechat.Transaction
	queryPayload []byte
	queries      int
}

func (f *fakeWechatWebhookClient) VerifyNotification(string, string, string, []byte, time.Time) error {
	return f.verifyErr
}

func (f *fakeWechatWebhookClient) ParseNotification([]byte) (wechat.Notification, wechat.Transaction, error) {
	return f.notification, f.callback, nil
}

func (f *fakeWechatWebhookClient) QueryTransaction(context.Context, string) (wechat.Transaction, []byte, error) {
	f.queries++
	return f.queried, f.queryPayload, nil
}

type fakeWechatWebhookUsecase struct {
	receipt        data.WechatWebhookReceipt
	recorded       data.WechatWebhookEvent
	queryConfirmed int
	queryFailed    int
	confirmed      int
}

func (f *fakeWechatWebhookUsecase) RecordWechatWebhook(_ context.Context, event data.WechatWebhookEvent) (data.WechatWebhookReceipt, error) {
	f.recorded = event
	return f.receipt, nil
}

func (f *fakeWechatWebhookUsecase) MarkWechatWebhookQueryFailed(context.Context, string, string) error {
	f.queryFailed++
	return nil
}

func (f *fakeWechatWebhookUsecase) MarkWechatWebhookQueryConfirmed(context.Context, string, []byte) error {
	f.queryConfirmed++
	return nil
}

func (f *fakeWechatWebhookUsecase) ConfirmWechatPayment(context.Context, string, string, string, int64, string, []byte) (data.SimulatedPaymentResult, error) {
	f.confirmed++
	return data.SimulatedPaymentResult{}, nil
}
