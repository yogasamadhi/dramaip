package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/billing/internal/wechat"
	billingbiz "github.com/dramaip/dramaip-platform/services/app/billing/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/service/internal/data"
)

const maxWechatWebhookBody = 1 << 20

type wechatWebhookClient interface {
	VerifyNotification(timestamp, nonce, signature string, rawBody []byte, now time.Time) error
	ParseNotification(rawBody []byte) (wechat.Notification, wechat.Transaction, error)
	QueryTransaction(ctx context.Context, outTradeNo string) (wechat.Transaction, []byte, error)
}

type wechatWebhookUsecase interface {
	RecordWechatWebhook(context.Context, data.WechatWebhookEvent) (data.WechatWebhookReceipt, error)
	MarkWechatWebhookQueryFailed(context.Context, string, string) error
	MarkWechatWebhookQueryConfirmed(context.Context, string, []byte) error
	ConfirmWechatPayment(context.Context, string, string, string, int64, string, []byte) (data.SimulatedPaymentResult, error)
}

type wechatWebhook struct {
	enabled bool
	client  wechatWebhookClient
	uc      wechatWebhookUsecase
	now     func() time.Time
}

func newWechatWebhook(cfg conf.WechatPayConfig, uc *billingbiz.BillingUsecase) (*wechatWebhook, error) {
	webhook := &wechatWebhook{enabled: cfg.Enabled, uc: uc, now: time.Now}
	if !cfg.Enabled {
		return webhook, nil
	}
	client, err := wechat.NewClient(wechat.Config{
		AppID: cfg.AppID, MchID: cfg.MchID, APIV3Key: cfg.APIV3Key,
		MerchantCertificateSerial: cfg.MerchantCertificateSerial,
		MerchantPrivateKeyPath:    cfg.MerchantPrivateKeyPath,
		PlatformCertificatePath:   cfg.PlatformCertificatePath,
		APIBaseURL:                cfg.APIBaseURL,
	})
	if err != nil {
		return nil, err
	}
	webhook.client = client
	return webhook, nil
}

func (h *wechatWebhook) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeWechatReply(w, http.StatusMethodNotAllowed, "FAIL", "method not allowed")
		return
	}
	if !h.enabled || h.client == nil {
		writeWechatReply(w, http.StatusNotFound, "FAIL", "webhook disabled")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxWechatWebhookBody)
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeWechatReply(w, http.StatusRequestEntityTooLarge, "FAIL", "payload too large")
		return
	}
	timestamp := r.Header.Get("Wechatpay-Timestamp")
	nonce := r.Header.Get("Wechatpay-Nonce")
	signature := r.Header.Get("Wechatpay-Signature")
	serial := r.Header.Get("Wechatpay-Serial")
	if serial == "" {
		writeWechatReply(w, http.StatusUnauthorized, "FAIL", "invalid signature")
		return
	}
	if err := h.client.VerifyNotification(timestamp, nonce, signature, rawBody, h.now().UTC()); err != nil {
		writeWechatReply(w, http.StatusUnauthorized, "FAIL", "invalid signature")
		return
	}
	notification, callbackTransaction, err := h.client.ParseNotification(rawBody)
	if err != nil {
		writeWechatReply(w, http.StatusBadRequest, "FAIL", "invalid notification")
		return
	}
	receipt, err := h.uc.RecordWechatWebhook(r.Context(), data.WechatWebhookEvent{
		ProviderEventID: notification.ID, ProviderOrderID: callbackTransaction.OutTradeNo,
		ProviderTransactionID: callbackTransaction.TransactionID, RawBody: rawBody,
		SignatureTimestamp: timestamp, SignatureNonce: nonce, SignatureSerial: serial,
	})
	if err != nil {
		writeWechatReply(w, http.StatusInternalServerError, "FAIL", "event inbox unavailable")
		return
	}
	if receipt.Processed {
		writeWechatReply(w, http.StatusOK, "SUCCESS", "success")
		return
	}
	confirmedTransaction, _, err := h.client.QueryTransaction(r.Context(), callbackTransaction.OutTradeNo)
	if err != nil {
		_ = h.uc.MarkWechatWebhookQueryFailed(r.Context(), notification.ID, "provider transaction query failed")
		writeWechatReply(w, http.StatusInternalServerError, "FAIL", "provider confirmation pending")
		return
	}
	if confirmedTransaction.TransactionID != callbackTransaction.TransactionID || confirmedTransaction.OutTradeNo != callbackTransaction.OutTradeNo || confirmedTransaction.TradeState != "SUCCESS" {
		_ = h.uc.MarkWechatWebhookQueryFailed(r.Context(), notification.ID, "provider query does not match callback transaction")
		writeWechatReply(w, http.StatusConflict, "FAIL", "provider confirmation mismatch")
		return
	}
	queryAuditPayload, err := json.Marshal(map[string]any{
		"appid": confirmedTransaction.AppID, "mchid": confirmedTransaction.MchID,
		"out_trade_no": confirmedTransaction.OutTradeNo, "transaction_id": confirmedTransaction.TransactionID,
		"trade_state": confirmedTransaction.TradeState,
		"amount":      confirmedTransaction.Amount,
	})
	if err != nil {
		writeWechatReply(w, http.StatusInternalServerError, "FAIL", "event inbox unavailable")
		return
	}
	if err := h.uc.MarkWechatWebhookQueryConfirmed(r.Context(), notification.ID, queryAuditPayload); err != nil {
		writeWechatReply(w, http.StatusInternalServerError, "FAIL", "event inbox unavailable")
		return
	}
	if _, err := h.uc.ConfirmWechatPayment(r.Context(), confirmedTransaction.OutTradeNo, notification.ID, confirmedTransaction.TransactionID, confirmedTransaction.Amount.Total, confirmedTransaction.Amount.Currency, rawBody); err != nil {
		writeWechatReply(w, http.StatusInternalServerError, "FAIL", "payment activation pending")
		return
	}
	writeWechatReply(w, http.StatusOK, "SUCCESS", "success")
}

func writeWechatReply(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "message": message})
}
