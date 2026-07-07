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
	return log.With(log.NewStdLogger(os.Stdout),
		"ts", log.DefaultTimestamp,
		"caller", log.DefaultCaller,
		"service.id", service,
		"service.name", service,
		"service.version", Version,
	)
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
			ctx = platform.WithRequestID(ctx, platform.RequestID(ctx))
			ctx, span := tracer.Start(ctx, "kratos "+service)
			defer span.End()
			reply, err := handler(ctx, req)
			if err != nil {
				span.RecordError(err)
			}
			return reply, err
		}
	}
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
