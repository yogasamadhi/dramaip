package kratosx

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	kratos "github.com/go-kratos/kratos/v2"
	"github.com/go-kratos/kratos/v2/log"
	"github.com/go-kratos/kratos/v2/middleware"
	"github.com/go-kratos/kratos/v2/transport"
	khttp "github.com/go-kratos/kratos/v2/transport/http"
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

func Logger(service string) log.Logger {
	return structuredLogger{service: service}
}

type structuredLogger struct{ service string }

func (l structuredLogger) Log(level log.Level, keyvals ...any) error {
	fields := map[string]any{"service_version": Version}
	for i := 0; i+1 < len(keyvals); i += 2 {
		key, ok := keyvals[i].(string)
		if !ok || key == "" {
			key = fmt.Sprintf("field_%d", i/2)
		}
		fields[key] = keyvals[i+1]
	}
	if len(keyvals)%2 != 0 {
		fields["malformed_keyvals"] = true
	}
	platform.StructuredLog(context.Background(), l.service, level.String(), "kratos", fields)
	return nil
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
		_, _ = fmt.Fprintf(w, "# HELP dramaip_service_up Service health gauge.\n# TYPE dramaip_service_up gauge\ndramaip_service_up{service=%q} 1\n", service)
	})
}
