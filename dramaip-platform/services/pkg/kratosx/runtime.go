package kratosx

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	kratos "github.com/go-kratos/kratos/v3"
	klog "github.com/go-kratos/kratos/v3/log"
	"github.com/go-kratos/kratos/v3/middleware"
	"github.com/go-kratos/kratos/v3/transport"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
	"go.opentelemetry.io/otel"
)

const Version = "0.4.0"

func Env(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func EnvInt(key string, fallback int) int {
	value, err := strconv.Atoi(Env(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func EnvDurationSeconds(key string, fallbackSeconds int) time.Duration {
	return time.Duration(EnvInt(key, fallbackSeconds)) * time.Second
}

func Logger(service string) *slog.Logger {
	return klog.NewLogger(newStructuredLogHandler(service, platform.StructuredLog))
}

type structuredLogWriter func(context.Context, string, string, string, map[string]any)

type scopedLogAttrs struct {
	groups []string
	attrs  []slog.Attr
}

// structuredLogHandler adapts Kratos v3's slog records to the platform log
// envelope. Instances are immutable after construction, so WithAttrs and
// WithGroup can safely be used concurrently by derived loggers.
type structuredLogHandler struct {
	service string
	write   structuredLogWriter
	groups  []string
	bound   []scopedLogAttrs
}

func newStructuredLogHandler(service string, write structuredLogWriter) *structuredLogHandler {
	return &structuredLogHandler{service: service, write: write}
}

func (*structuredLogHandler) Enabled(context.Context, slog.Level) bool {
	return true
}

func (h *structuredLogHandler) Handle(ctx context.Context, record slog.Record) error {
	fields := map[string]any{
		"service_version": Version,
		"msg":             record.Message,
	}
	for _, scoped := range h.bound {
		appendStructuredLogAttrs(fields, scoped.groups, scoped.attrs)
	}
	record.Attrs(func(attr slog.Attr) bool {
		appendStructuredLogAttrs(fields, h.groups, []slog.Attr{attr})
		return true
	})
	h.write(ctx, h.service, structuredLogLevel(record.Level), "kratos", fields)
	return nil
}

func (h *structuredLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	clone := h.clone()
	clone.bound = append(clone.bound, scopedLogAttrs{
		groups: append([]string(nil), h.groups...),
		attrs:  append([]slog.Attr(nil), attrs...),
	})
	return clone
}

func (h *structuredLogHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := h.clone()
	clone.groups = append(clone.groups, name)
	return clone
}

func (h *structuredLogHandler) clone() *structuredLogHandler {
	return &structuredLogHandler{
		service: h.service,
		write:   h.write,
		groups:  append([]string(nil), h.groups...),
		bound:   append([]scopedLogAttrs(nil), h.bound...),
	}
}

func appendStructuredLogAttrs(fields map[string]any, groups []string, attrs []slog.Attr) {
	target := fields
	for _, group := range groups {
		nested, ok := target[group].(map[string]any)
		if !ok {
			nested = map[string]any{}
			target[group] = nested
		}
		target = nested
	}
	for _, attr := range attrs {
		appendStructuredLogAttr(target, attr)
	}
}

func appendStructuredLogAttr(target map[string]any, attr slog.Attr) {
	if attr.Equal(slog.Attr{}) {
		return
	}
	attr.Value = attr.Value.Resolve()
	if attr.Value.Kind() != slog.KindGroup {
		target[attr.Key] = attr.Value.Any()
		return
	}
	if attr.Key == "" {
		for _, child := range attr.Value.Group() {
			appendStructuredLogAttr(target, child)
		}
		return
	}
	nested, ok := target[attr.Key].(map[string]any)
	if !ok {
		nested = map[string]any{}
	}
	for _, child := range attr.Value.Group() {
		appendStructuredLogAttr(nested, child)
	}
	if len(nested) > 0 {
		target[attr.Key] = nested
	}
}

func structuredLogLevel(level slog.Level) string {
	switch {
	case level >= klog.LevelFatal:
		return "FATAL"
	case level >= slog.LevelError:
		return "ERROR"
	case level >= slog.LevelWarn:
		return "WARN"
	case level >= slog.LevelInfo:
		return "INFO"
	default:
		return "DEBUG"
	}
}

func NewApp(name string, servers ...transport.Server) *kratos.App {
	shutdown := platform.InitObservability(context.Background(), name)
	return kratos.New(
		kratos.Name(name),
		kratos.Version(Version),
		kratos.Logger(Logger(name)),
		kratos.Server(servers...),
		kratos.BeforeStop(func(ctx context.Context) error { return shutdown(ctx) }),
	)
}

func TraceMiddleware(service string) middleware.Middleware {
	tracer := platform.Tracer(service)
	return func(handler middleware.Handler) middleware.Handler {
		return func(ctx context.Context, req any) (any, error) {
			ctx, operation := extractServerTrace(ctx, service)
			ctx, span := tracer.Start(ctx, operation)
			defer span.End()
			writeTraceHeaders(ctx)
			started := time.Now()
			reply, err := handler(ctx, req)
			if err != nil {
				span.RecordError(err)
				platform.ReportError(ctx, operation, err)
			}
			fields := map[string]any{
				"route":       operation,
				"outcome":     "ok",
				"duration_ms": time.Since(started).Milliseconds(),
			}
			if err != nil {
				fields["outcome"] = "error"
			}
			if userID := platform.UserIdentity(ctx); userID != "" {
				fields["user_id"] = userID
			}
			platform.StructuredLog(ctx, service, logLevel(err), "request_completed", fields)
			transportKind := "internal"
			if tr, ok := transport.FromServerContext(ctx); ok {
				transportKind = tr.Kind().String()
			}
			outcome := "success"
			if err != nil {
				outcome = "error"
			}
			platform.ObserveRequest(transportKind, operation, outcome, time.Since(started))
			return reply, err
		}
	}
}

func extractServerTrace(ctx context.Context, service string) (context.Context, string) {
	operation := "kratos " + service
	if tr, ok := transport.FromServerContext(ctx); ok {
		ctx = otel.GetTextMapPropagator().Extract(ctx, tr.RequestHeader())
		ctx = platform.WithRequestID(ctx, tr.RequestHeader().Get("X-Request-Id"))
		if tr.Operation() != "" {
			operation = tr.Operation()
		}
		return ctx, operation
	}
	return platform.WithRequestID(ctx, platform.RequestID(ctx)), operation
}

func writeTraceHeaders(ctx context.Context) {
	tr, ok := transport.FromServerContext(ctx)
	if !ok {
		return
	}
	if traceID := platform.TraceID(ctx); traceID != "" {
		tr.ReplyHeader().Set("X-Trace-Id", traceID)
	}
	tr.ReplyHeader().Set("X-Request-Id", platform.RequestID(ctx))
}

func logLevel(err error) string {
	if err != nil {
		return "error"
	}
	return "info"
}

func RegisterHealth(server *khttp.Server, service string, checks map[string]func(context.Context) error) {
	server.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		ok := true
		deps := map[string]string{}
		for name, check := range checks {
			if err := check(ctx); err != nil {
				ok = false
				deps[name] = err.Error()
			} else {
				deps[name] = "ok"
			}
		}
		status := http.StatusOK
		if !ok {
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"ok":%t,"service":%q,"version":%q}`+"\n", ok, service, Version)
	})
	server.HandleFunc("/metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		platform.WritePrometheus(w, service)
	})
}
