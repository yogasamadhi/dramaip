package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/billing/job/internal/data"
	billingsvc "github.com/dramaip/dramaip-platform/services/app/billing/job/internal/service"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/go-kratos/kratos/v2/middleware/recovery"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type JobServer struct {
	svc    *billingsvc.OutboxService
	cancel context.CancelFunc
}

func NewJobServer(svc *billingsvc.OutboxService) *JobServer {
	return &JobServer{svc: svc}
}

func (s *JobServer) Start(ctx context.Context) error {
	jobCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	return s.svc.Run(jobCtx)
}

func (s *JobServer) Stop(context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func NewHTTPServer(cfg *conf.Bootstrap, svc *billingsvc.OutboxService) *khttp.Server {
	server := khttp.NewServer(
		khttp.Address(cfg.Server.HTTP.Addr),
		khttp.Middleware(recovery.Recovery(), kratosx.TraceMiddleware("billing-job")),
	)
	kratosx.RegisterHealth(server, "billing-job", svc.Checks())
	operatorToken := strings.TrimSpace(kratosx.Env("RECONCILIATION_OPERATOR_TOKEN", ""))
	server.HandleFunc("/internal/reconciliation/runs", reconciliationRunsHandler(svc, operatorToken))
	server.HandleFunc("/internal/reconciliation/runs/latest", reconciliationLatestRunHandler(svc, operatorToken))
	server.HandleFunc("/internal/reconciliation/items", reconciliationItemsHandler(svc, operatorToken))
	server.HandleFunc("/internal/reconciliation/items/", reconciliationItemActionsHandler(svc, operatorToken))
	server.HandleFunc("/internal/reconciliation/metrics", reconciliationMetricsHandler(svc, operatorToken))
	return server
}

func reconciliationRunsHandler(svc *billingsvc.OutboxService, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorizeReconciliationOperator(w, r, token) {
			return
		}
		if r.Method != http.MethodPost {
			writeReconciliationError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var body struct {
			RequestedBy string `json:"requested_by"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
				writeReconciliationError(w, http.StatusBadRequest, "invalid_json")
				return
			}
		}
		body.RequestedBy = strings.TrimSpace(body.RequestedBy)
		if body.RequestedBy == "" {
			writeReconciliationError(w, http.StatusBadRequest, "requested_by_required")
			return
		}
		run, err := svc.Reconcile(r.Context(), body.RequestedBy)
		if err != nil {
			writeReconciliationGRPCError(w, err)
			return
		}
		writeReconciliationJSON(w, http.StatusAccepted, run)
	}
}

func reconciliationLatestRunHandler(svc *billingsvc.OutboxService, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorizeReconciliationOperator(w, r, token) {
			return
		}
		if r.Method != http.MethodGet {
			writeReconciliationError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		run, err := svc.LatestReconciliationRun(r.Context())
		if err != nil {
			writeReconciliationGRPCError(w, err)
			return
		}
		writeReconciliationJSON(w, http.StatusOK, run)
	}
}

func reconciliationItemsHandler(svc *billingsvc.OutboxService, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorizeReconciliationOperator(w, r, token) {
			return
		}
		if r.Method != http.MethodGet {
			writeReconciliationError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
		if err != nil && r.URL.Query().Get("limit") != "" {
			writeReconciliationError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		items, err := svc.ListReconciliationItems(r.Context(), r.URL.Query().Get("status"), limit)
		if err != nil {
			writeReconciliationGRPCError(w, err)
			return
		}
		writeReconciliationJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func reconciliationItemActionsHandler(svc *billingsvc.OutboxService, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorizeReconciliationOperator(w, r, token) {
			return
		}
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/actions") {
			writeReconciliationError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		itemID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/internal/reconciliation/items/"), "/actions")
		itemID = strings.Trim(itemID, "/")
		if itemID == "" || strings.Contains(itemID, "/") {
			writeReconciliationError(w, http.StatusBadRequest, "invalid_item_id")
			return
		}
		var body data.ReconciliationActionInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
			writeReconciliationError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		action, err := svc.ApplyReconciliationAction(r.Context(), itemID, body)
		if err != nil {
			writeReconciliationGRPCError(w, err)
			return
		}
		writeReconciliationJSON(w, http.StatusOK, action)
	}
}

func reconciliationMetricsHandler(svc *billingsvc.OutboxService, token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorizeReconciliationOperator(w, r, token) {
			return
		}
		if r.Method != http.MethodGet {
			writeReconciliationError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		runs, items, failures := svc.ReconciliationMetrics()
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = w.Write([]byte("# TYPE dramaip_billing_reconciliation_runs_total counter\n"))
		_, _ = w.Write([]byte("dramaip_billing_reconciliation_runs_total " + strconv.FormatUint(runs, 10) + "\n"))
		_, _ = w.Write([]byte("# TYPE dramaip_billing_reconciliation_items_detected_total counter\n"))
		_, _ = w.Write([]byte("dramaip_billing_reconciliation_items_detected_total " + strconv.FormatUint(items, 10) + "\n"))
		_, _ = w.Write([]byte("# TYPE dramaip_billing_reconciliation_failures_total counter\n"))
		_, _ = w.Write([]byte("dramaip_billing_reconciliation_failures_total " + strconv.FormatUint(failures, 10) + "\n"))
	}
}

func authorizeReconciliationOperator(w http.ResponseWriter, r *http.Request, token string) bool {
	if token == "" {
		writeReconciliationError(w, http.StatusServiceUnavailable, "reconciliation_operator_api_disabled")
		return false
	}
	prefix := "Bearer "
	provided := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), prefix))
	if !strings.HasPrefix(r.Header.Get("Authorization"), prefix) || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeReconciliationError(w, http.StatusUnauthorized, "operator_auth_required")
		return false
	}
	return true
}

func writeReconciliationJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(value)
}

func writeReconciliationError(w http.ResponseWriter, statusCode int, code string) {
	writeReconciliationJSON(w, statusCode, map[string]string{"error": code})
}

func writeReconciliationGRPCError(w http.ResponseWriter, err error) {
	switch status.Code(err) {
	case codes.InvalidArgument:
		writeReconciliationError(w, http.StatusBadRequest, "invalid_request")
	case codes.NotFound:
		writeReconciliationError(w, http.StatusNotFound, "not_found")
	case codes.AlreadyExists, codes.FailedPrecondition:
		writeReconciliationError(w, http.StatusConflict, "reconciliation_conflict")
	default:
		writeReconciliationError(w, http.StatusInternalServerError, "reconciliation_unavailable")
	}
}
