package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const testTraceID = "0123456789abcdef0123456789abcdef"

func installTestTracer(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	t.Cleanup(func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})
	return recorder
}

func TestContextWithTraceIDRestoresAsyncTrace(t *testing.T) {
	installTestTracer(t)
	ctx := ContextWithTraceID(context.Background(), testTraceID)
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() || spanContext.TraceID().String() != testTraceID || !spanContext.IsRemote() {
		t.Fatalf("restored span context = %#v", spanContext)
	}
	if got := RequestID(ctx); got != testTraceID {
		t.Fatalf("request ID = %q, want %q", got, testTraceID)
	}

	invalid := ContextWithTraceID(context.Background(), "legacy-request-id")
	if trace.SpanContextFromContext(invalid).IsValid() {
		t.Fatal("invalid legacy ID must not become an OpenTelemetry trace ID")
	}
	if got := RequestID(invalid); got != "legacy-request-id" {
		t.Fatalf("legacy request ID = %q", got)
	}
}

func TestGRPCTraceInterceptorsPropagateTraceAndRequestID(t *testing.T) {
	installTestTracer(t)
	ctx := WithRequestID(ContextWithTraceID(context.Background(), testTraceID), "request-123")
	client := UnaryClientTraceInterceptor("client")
	server := UnaryServerTraceInterceptor("server")

	err := client(ctx, "/trace.Test/Call", nil, nil, nil, func(outgoing context.Context, _ string, _ any, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		md, ok := metadata.FromOutgoingContext(outgoing)
		if !ok || firstMetadataValue(md, "traceparent") == "" {
			t.Fatal("client did not inject traceparent metadata")
		}
		if got := firstMetadataValue(md, "x-request-id"); got != "request-123" {
			t.Fatalf("outgoing request ID = %q", got)
		}
		incoming := metadata.NewIncomingContext(context.Background(), md)
		_, err := server(incoming, nil, &grpc.UnaryServerInfo{FullMethod: "/trace.Test/Call"}, func(received context.Context, _ any) (any, error) {
			if got := TraceID(received); got != testTraceID {
				t.Fatalf("server trace ID = %q", got)
			}
			if got := RequestID(received); got != "request-123" {
				t.Fatalf("server request ID = %q", got)
			}
			return nil, nil
		})
		return err
	})
	if err != nil {
		t.Fatalf("trace interceptor chain failed: %v", err)
	}
}

func TestRabbitCarrierKeepsTraceContext(t *testing.T) {
	installTestTracer(t)
	ctx, span := Tracer("publisher").Start(ContextWithTraceID(context.Background(), testTraceID), "payment.saga")
	defer span.End()
	headers := amqp.Table{}
	otel.GetTextMapPropagator().Inject(ctx, amqpHeaderCarrier(headers))
	headers["trace_id"] = TraceID(ctx)
	consumed := otel.GetTextMapPropagator().Extract(context.Background(), amqpHeaderCarrier(headers))
	consumed = ContextWithTraceID(consumed, headerString(headers, "trace_id"))
	if got := TraceID(consumed); got != testTraceID {
		t.Fatalf("MQ trace ID = %q", got)
	}
	if headerString(headers, "traceparent") == "" {
		t.Fatal("MQ carrier has no traceparent")
	}
}

func TestPaymentSagaTraceSurvivesOutboxAndMQBoundary(t *testing.T) {
	recorder := installTestTracer(t)
	requestCtx, requestSpan := Tracer("billing").Start(ContextWithTraceID(context.Background(), testTraceID), "payment.confirm")
	persistedTraceID := TraceID(requestCtx)
	requestSpan.End()

	relayCtx := ContextWithTraceID(context.Background(), persistedTraceID)
	relayCtx, relaySpan := Tracer("billing-job").Start(relayCtx, "billing.outbox.relay")
	headers := amqp.Table{}
	otel.GetTextMapPropagator().Inject(relayCtx, amqpHeaderCarrier(headers))
	headers["trace_id"] = TraceID(relayCtx)
	relaySpan.End()

	consumerCtx := otel.GetTextMapPropagator().Extract(context.Background(), amqpHeaderCarrier(headers))
	consumerCtx = ContextWithTraceID(consumerCtx, headerString(headers, "trace_id"))
	_, consumerSpan := Tracer("notification-job").Start(consumerCtx, "rabbitmq.consume billing.payment.succeeded")
	consumerSpan.End()

	spans := recorder.Ended()
	if len(spans) < 3 {
		t.Fatalf("ended spans = %d, want at least 3", len(spans))
	}
	for _, span := range spans {
		if got := span.SpanContext().TraceID().String(); got != testTraceID {
			t.Fatalf("span %q trace ID = %q", span.Name(), got)
		}
	}
	if headerString(headers, "traceparent") == "" {
		t.Fatal("outbox relay did not retain a W3C traceparent for MQ")
	}
}

func TestProviderHTTPSpanPreservesAITrace(t *testing.T) {
	recorder := installTestTracer(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("traceparent") == "" {
			t.Error("provider request did not receive traceparent")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer provider.Close()

	ctx, root := Tracer("ai-gateway").Start(ContextWithTraceID(context.Background(), testTraceID), "ai.prepay")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.URL, nil)
	if err != nil {
		t.Fatalf("new provider request: %v", err)
	}
	response, err := (&http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}).Do(req)
	root.End()
	if err != nil {
		t.Fatalf("provider request: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("provider status = %d", response.StatusCode)
	}

	seenProviderSpan := false
	for _, span := range recorder.Ended() {
		if got := span.SpanContext().TraceID().String(); got != testTraceID {
			t.Fatalf("span %q trace ID = %q", span.Name(), got)
		}
		if span.Name() == "HTTP POST" {
			seenProviderSpan = true
		}
	}
	if !seenProviderSpan {
		t.Fatal("OTel HTTP transport did not emit the provider span")
	}
}

func TestStructuredLogRedactsCredentialsAndBodies(t *testing.T) {
	installTestTracer(t)
	structuredLogMu.Lock()
	previousWriter := structuredLogWriter
	var output bytes.Buffer
	structuredLogWriter = &output
	structuredLogMu.Unlock()
	t.Cleanup(func() {
		structuredLogMu.Lock()
		structuredLogWriter = previousWriter
		structuredLogMu.Unlock()
	})

	ctx, span := Tracer("logging").Start(ContextWithTraceID(context.Background(), testTraceID), "payment.saga")
	defer span.End()
	accessToken := "real-" + "access-" + "token"
	databasePassword := "db-" + "password"
	providerKey := "sk-" + "very-" + "secret-" + "key"
	StructuredLog(ctx, "billing-service", "error", "provider_failed", map[string]any{
		"authorization": "Bearer " + accessToken,
		"body":          "private request body",
		"error":         "upstream said Bearer " + accessToken + " using postgres://user:" + databasePassword + "@example/db",
		"nested": map[string]any{
			"api_key": providerKey,
			"payload": "private event payload",
		},
	})

	line := output.String()
	for _, forbidden := range []string{accessToken, "private request body", databasePassword, "very-" + "secret-" + "key", "private event payload"} {
		if bytes.Contains([]byte(line), []byte(forbidden)) {
			t.Fatalf("structured log leaked %q: %s", forbidden, line)
		}
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(line), &entry); err != nil {
		t.Fatalf("structured log is not JSON: %v (%s)", err, line)
	}
	if got := entry["service"]; got != "billing-service" {
		t.Fatalf("service = %#v", got)
	}
	if got := entry["trace_id"]; got != testTraceID {
		t.Fatalf("trace_id = %#v", got)
	}
	if got := entry["body"]; got != "[REDACTED]" {
		t.Fatalf("body redaction = %#v", got)
	}
}
