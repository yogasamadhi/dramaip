package kratosx

import (
	"context"
	"testing"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"github.com/go-kratos/kratos/v2/transport"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const middlewareTraceID = "fedcba9876543210fedcba9876543210"

type testHeader map[string]string

func (h testHeader) Get(key string) string { return h[key] }
func (h testHeader) Set(key, value string) { h[key] = value }
func (h testHeader) Add(key, value string) { h[key] = value }
func (h testHeader) Keys() []string {
	keys := make([]string, 0, len(h))
	for key := range h {
		keys = append(keys, key)
	}
	return keys
}
func (h testHeader) Values(key string) []string {
	if value := h[key]; value != "" {
		return []string{value}
	}
	return nil
}

type testTransport struct {
	request testHeader
	reply   testHeader
}

func (t testTransport) Kind() transport.Kind            { return transport.KindHTTP }
func (t testTransport) Endpoint() string                { return "http://trace.test" }
func (t testTransport) Operation() string               { return "POST /v1/checkout" }
func (t testTransport) RequestHeader() transport.Header { return t.request }
func (t testTransport) ReplyHeader() transport.Header   { return t.reply }

func TestTraceMiddlewareExtractsHTTPContextAndWritesHeaders(t *testing.T) {
	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	provider := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	t.Cleanup(func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	request := testHeader{"X-Request-Id": "request-456"}
	parent, span := platform.Tracer("gateway").Start(platform.ContextWithTraceID(context.Background(), middlewareTraceID), "kong.request")
	otel.GetTextMapPropagator().Inject(parent, request)
	span.End()
	reply := testHeader{}
	ctx := transport.NewServerContext(context.Background(), testTransport{request: request, reply: reply})

	_, err := TraceMiddleware("billing-service")(func(ctx context.Context, _ any) (any, error) {
		if got := platform.TraceID(ctx); got != middlewareTraceID {
			t.Fatalf("trace ID = %q", got)
		}
		if got := platform.RequestID(ctx); got != "request-456" {
			t.Fatalf("request ID = %q", got)
		}
		return "ok", nil
	})(ctx, nil)
	if err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	if got := reply.Get("X-Trace-Id"); got != middlewareTraceID {
		t.Fatalf("reply trace ID = %q", got)
	}
	if got := reply.Get("X-Request-Id"); got != "request-456" {
		t.Fatalf("reply request ID = %q", got)
	}
}
