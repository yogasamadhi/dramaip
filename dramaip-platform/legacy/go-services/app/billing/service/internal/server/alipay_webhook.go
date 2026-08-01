package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"

	"github.com/dramaip/dramaip-platform/services/app/billing/internal/alipay"
	billingbiz "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
)

const maxAlipayWebhookBody = 1 << 20

type alipayWebhookClient interface {
	VerifyNotification(url.Values) error
	ParseNotification(url.Values) (alipay.Notification, error)
	QueryTransaction(context.Context, string) (alipay.Transaction, []byte, error)
}

type alipayWebhookUsecase interface {
	RecordAlipayWebhook(context.Context, data.AlipayWebhookEvent) (data.AlipayWebhookReceipt, error)
	MarkAlipayWebhookQueryFailed(context.Context, string, string) error
	MarkAlipayWebhookQueryConfirmed(context.Context, string, []byte) error
	ConfirmAlipayPayment(context.Context, string, string, string, int64, string, []byte) (data.SimulatedPaymentResult, error)
}

type alipayWebhook struct {
	enabled bool
	client  alipayWebhookClient
	uc      alipayWebhookUsecase
}

func newAlipayWebhook(cfg conf.AlipayConfig, uc *billingbiz.BillingUsecase) (*alipayWebhook, error) {
	webhook := &alipayWebhook{enabled: cfg.Enabled, uc: uc}
	if !cfg.Enabled {
		return webhook, nil
	}
	client, err := alipay.NewClient(alipay.Config{
		AppID: cfg.AppID, SellerID: cfg.SellerID,
		MerchantPrivateKeyPath: cfg.MerchantPrivateKeyPath,
		AlipayPublicKeyPath:    cfg.AlipayPublicKeyPath,
		NotifyURL:              cfg.NotifyURL,
		Gateway:                cfg.Gateway,
	})
	if err != nil {
		return nil, err
	}
	webhook.client = client
	return webhook, nil
}

func (h *alipayWebhook) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeAlipayReply(w, http.StatusMethodNotAllowed, "failure")
		return
	}
	if !h.enabled || h.client == nil {
		writeAlipayReply(w, http.StatusNotFound, "failure")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAlipayWebhookBody)
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeAlipayReply(w, http.StatusRequestEntityTooLarge, "failure")
		return
	}
	values, err := alipay.ParseNotificationForm(rawBody)
	if err != nil {
		writeAlipayReply(w, http.StatusBadRequest, "failure")
		return
	}
	if err := h.client.VerifyNotification(values); err != nil {
		writeAlipayReply(w, http.StatusUnauthorized, "failure")
		return
	}
	notification, err := h.client.ParseNotification(values)
	if err != nil {
		writeAlipayReply(w, http.StatusBadRequest, "failure")
		return
	}
	callbackAuditPayload, err := json.Marshal(map[string]string{
		"notify_id": notification.NotifyID, "notify_time": notification.NotifyTime,
		"app_id": notification.AppID, "seller_id": notification.SellerID,
		"out_trade_no": notification.OutTradeNo, "trade_no": notification.TradeNo,
		"trade_status": notification.TradeStatus, "total_amount": notification.TotalAmount,
	})
	if err != nil {
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	receipt, err := h.uc.RecordAlipayWebhook(r.Context(), data.AlipayWebhookEvent{
		ProviderEventID: notification.NotifyID, ProviderOrderID: notification.OutTradeNo,
		ProviderTransactionID: notification.TradeNo, RawBody: rawBody,
		AuditPayload: callbackAuditPayload, NotifyTime: notification.NotifyTime,
		SignType: values.Get("sign_type"),
	})
	if err != nil {
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	if receipt.Processed {
		writeAlipayReply(w, http.StatusOK, "success")
		return
	}
	confirmed, _, err := h.client.QueryTransaction(r.Context(), notification.OutTradeNo)
	if err != nil {
		_ = h.uc.MarkAlipayWebhookQueryFailed(r.Context(), notification.NotifyID, "provider transaction query failed")
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	if confirmed.OutTradeNo != notification.OutTradeNo || confirmed.TradeNo != notification.TradeNo || confirmed.TradeStatus != "TRADE_SUCCESS" || confirmed.TotalCents != notification.TotalCents {
		_ = h.uc.MarkAlipayWebhookQueryFailed(r.Context(), notification.NotifyID, "provider query does not match callback transaction")
		writeAlipayReply(w, http.StatusConflict, "failure")
		return
	}
	queryAuditPayload, err := json.Marshal(map[string]any{
		"app_id": notification.AppID, "seller_id": confirmed.SellerID,
		"out_trade_no": confirmed.OutTradeNo, "trade_no": confirmed.TradeNo,
		"trade_status": confirmed.TradeStatus, "total_amount": confirmed.TotalAmount,
	})
	if err != nil {
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	if err := h.uc.MarkAlipayWebhookQueryConfirmed(r.Context(), notification.NotifyID, queryAuditPayload); err != nil {
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	if _, err := h.uc.ConfirmAlipayPayment(r.Context(), confirmed.OutTradeNo, notification.NotifyID, confirmed.TradeNo, confirmed.TotalCents, "CNY", callbackAuditPayload); err != nil {
		writeAlipayReply(w, http.StatusInternalServerError, "failure")
		return
	}
	writeAlipayReply(w, http.StatusOK, "success")
}

func writeAlipayReply(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}
