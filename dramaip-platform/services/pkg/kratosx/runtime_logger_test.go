package kratosx

import (
	"context"
	"log/slog"
	"testing"

	klog "github.com/go-kratos/kratos/v3/log"
)

type capturedStructuredLog struct {
	ctx       context.Context
	service   string
	level     string
	operation string
	fields    map[string]any
}

func TestStructuredLogHandlerPreservesAttrsGroupsAndContext(t *testing.T) {
	contextKey := struct{}{}
	ctx := context.WithValue(context.Background(), contextKey, "request-context")
	var captured capturedStructuredLog
	handler := newStructuredLogHandler("billing-service", func(ctx context.Context, service, level, operation string, fields map[string]any) {
		captured = capturedStructuredLog{
			ctx:       ctx,
			service:   service,
			level:     level,
			operation: operation,
			fields:    fields,
		}
	})

	logger := slog.New(handler).
		With("component", "transport").
		WithGroup("request").
		With("method", "GET")
	logger.LogAttrs(ctx, klog.LevelFatal, "server stopped",
		slog.String("path", "/healthz"),
		slog.Group("peer", slog.String("id", "worker-a")),
		slog.Group("", slog.String("inlined", "yes")),
	)

	if captured.ctx != ctx {
		t.Fatal("handler did not preserve the log context")
	}
	if captured.service != "billing-service" || captured.level != "FATAL" || captured.operation != "kratos" {
		t.Fatalf("log envelope = service %q, level %q, operation %q", captured.service, captured.level, captured.operation)
	}
	if got := captured.fields["service_version"]; got != Version {
		t.Fatalf("service_version = %#v", got)
	}
	if got := captured.fields["msg"]; got != "server stopped" {
		t.Fatalf("msg = %#v", got)
	}
	if got := captured.fields["component"]; got != "transport" {
		t.Fatalf("component = %#v", got)
	}
	request, ok := captured.fields["request"].(map[string]any)
	if !ok {
		t.Fatalf("request group = %#v", captured.fields["request"])
	}
	if request["method"] != "GET" || request["path"] != "/healthz" || request["inlined"] != "yes" {
		t.Fatalf("request fields = %#v", request)
	}
	peer, ok := request["peer"].(map[string]any)
	if !ok || peer["id"] != "worker-a" {
		t.Fatalf("peer group = %#v", request["peer"])
	}
}

func TestStructuredLogHandlerMapsKratosLevels(t *testing.T) {
	tests := []struct {
		name string
		in   slog.Level
		want string
	}{
		{name: "debug", in: klog.LevelDebug, want: "DEBUG"},
		{name: "info", in: klog.LevelInfo, want: "INFO"},
		{name: "warn", in: klog.LevelWarn, want: "WARN"},
		{name: "error", in: klog.LevelError, want: "ERROR"},
		{name: "fatal", in: klog.LevelFatal, want: "FATAL"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got string
			handler := newStructuredLogHandler("test-service", func(_ context.Context, _, level, _ string, _ map[string]any) {
				got = level
			})
			if !handler.Enabled(context.Background(), tt.in) {
				t.Fatalf("level %s was unexpectedly disabled", tt.in)
			}
			slog.New(handler).Log(context.Background(), tt.in, "level test")
			if got != tt.want {
				t.Fatalf("level = %q, want %q", got, tt.want)
			}
		})
	}
}
