package platform

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type contextKey string

const requestIDKey contextKey = "dramaip_request_id"

var sensitivePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(sk-[a-z0-9_\-]{8,})`),
	regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9_\-\.]+`),
	regexp.MustCompile(`(?i)(refresh[_-]?token["':=\s]+)[^"',\s]+`),
	regexp.MustCompile(`(?i)(access[_-]?token["':=\s]+)[^"',\s]+`),
	regexp.MustCompile(`(?i)(password["':=\s]+)[^"',\s]+`),
}

func InitObservability(ctx context.Context, service string) func(context.Context) error {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	endpoint := Env("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	if endpoint == "" {
		otel.SetTracerProvider(trace.NewNoopTracerProvider())
		return func(context.Context) error { return nil }
	}
	exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpoint(strings.TrimPrefix(strings.TrimPrefix(endpoint, "http://"), "https://")), otlptracehttp.WithInsecure())
	if err != nil {
		StructuredLog(ctx, service, "warn", "observability_init_failed", map[string]any{"error": err.Error()})
		otel.SetTracerProvider(trace.NewNoopTracerProvider())
		return func(context.Context) error { return nil }
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes("",
			attribute.String("service.name", service),
			attribute.String("service.version", Env("SERVICE_VERSION", "0.4.0")),
			attribute.String("deployment.environment", Env("ENV", "dev")),
		)),
	)
	otel.SetTracerProvider(provider)
	return provider.Shutdown
}

func Tracer(service string) trace.Tracer {
	return otel.Tracer("github.com/dramaip/dramaip-platform/" + service)
}

func TraceID(ctx context.Context) string {
	span := trace.SpanContextFromContext(ctx)
	if span.HasTraceID() {
		return span.TraceID().String()
	}
	if id, _ := ctx.Value(requestIDKey).(string); id != "" {
		return id
	}
	return ""
}

func SpanID(ctx context.Context) string {
	span := trace.SpanContextFromContext(ctx)
	if span.HasSpanID() {
		return span.SpanID().String()
	}
	return ""
}

func RequestID(ctx context.Context) string {
	if id, _ := ctx.Value(requestIDKey).(string); id != "" {
		return id
	}
	return TraceID(ctx)
}

func WithRequestID(ctx context.Context, id string) context.Context {
	if id == "" {
		id = NewTraceLikeID()
	}
	return context.WithValue(ctx, requestIDKey, id)
}

func NewTraceLikeID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func TraceMiddleware(service string, next http.Handler) http.Handler {
	tracer := Tracer(service)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		requestID := r.Header.Get("X-Request-Id")
		ctx = WithRequestID(ctx, requestID)
		ctx, span := tracer.Start(ctx, r.Method+" "+r.URL.Path)
		defer span.End()
		traceID := TraceID(ctx)
		if traceID != "" {
			w.Header().Set("X-Trace-Id", traceID)
		}
		w.Header().Set("X-Request-Id", RequestID(ctx))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func UnaryClientTraceInterceptor(service string) grpc.UnaryClientInterceptor {
	tracer := Tracer(service)
	return func(ctx context.Context, method string, req any, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx, span := tracer.Start(ctx, "grpc.client "+method)
		defer span.End()
		md, _ := metadata.FromOutgoingContext(ctx)
		md = md.Copy()
		carrier := metadataCarrier(md)
		otel.GetTextMapPropagator().Inject(ctx, carrier)
		ctx = metadata.NewOutgoingContext(ctx, metadata.MD(carrier))
		err := invoker(ctx, method, req, reply, cc, opts...)
		if err != nil {
			span.RecordError(err)
		}
		return err
	}
}

func UnaryServerTraceInterceptor(service string) grpc.UnaryServerInterceptor {
	tracer := Tracer(service)
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		md, _ := metadata.FromIncomingContext(ctx)
		ctx = otel.GetTextMapPropagator().Extract(ctx, metadataCarrier(md.Copy()))
		ctx, span := tracer.Start(ctx, "grpc.server "+info.FullMethod)
		defer span.End()
		reply, err := handler(ctx, req)
		if err != nil {
			span.RecordError(err)
		}
		return reply, err
	}
}

func StructuredLog(ctx context.Context, service string, level string, operation string, fields map[string]any) {
	if fields == nil {
		fields = map[string]any{}
	}
	fields["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	fields["level"] = level
	fields["service"] = service
	fields["env"] = Env("ENV", "dev")
	fields["operation"] = operation
	if traceID := TraceID(ctx); traceID != "" {
		fields["trace_id"] = traceID
	}
	if spanID := SpanID(ctx); spanID != "" {
		fields["span_id"] = spanID
	}
	if requestID := RequestID(ctx); requestID != "" {
		fields["request_id"] = requestID
	}
	raw, err := json.Marshal(redactMap(fields))
	if err != nil {
		fmt.Fprintf(os.Stdout, `{"timestamp":%q,"level":"error","service":%q,"operation":"log_encode_failed","error":%q}`+"\n", time.Now().UTC().Format(time.RFC3339Nano), service, err.Error())
		return
	}
	fmt.Fprintln(os.Stdout, string(raw))
}

func Redact(value string) string {
	out := value
	for _, pattern := range sensitivePatterns {
		out = pattern.ReplaceAllString(out, "${1}[REDACTED]")
	}
	return out
}

func redactMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "api_key") {
			out[key] = "[REDACTED]"
			continue
		}
		if text, ok := value.(string); ok {
			out[key] = Redact(text)
			continue
		}
		out[key] = value
	}
	return out
}

type metadataCarrier metadata.MD

func (c metadataCarrier) Get(key string) string {
	values := metadata.MD(c).Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (c metadataCarrier) Set(key string, value string) {
	metadata.MD(c).Set(key, value)
}

func (c metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for key := range c {
		keys = append(keys, key)
	}
	return keys
}
