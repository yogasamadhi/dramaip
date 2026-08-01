package platform

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
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

type sensitivePattern struct {
	pattern     *regexp.Regexp
	replacement string
}

var sensitivePatterns = []sensitivePattern{
	{regexp.MustCompile(`(?i)sk-[a-z0-9_\-]{8,}`), "[REDACTED]"},
	{regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9_\-\.]+`), "${1}[REDACTED]"},
	{regexp.MustCompile(`(?i)(refresh[_-]?token["':=\s]+)[^"',\s]+`), "${1}[REDACTED]"},
	{regexp.MustCompile(`(?i)(access[_-]?token["':=\s]+)[^"',\s]+`), "${1}[REDACTED]"},
	{regexp.MustCompile(`(?i)(password["':=\s]+)[^"',\s]+`), "${1}[REDACTED]"},
	{regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://[^:/\s]+:)[^@/\s]+@`), "${1}[REDACTED]@"},
}

var (
	structuredLogMu     sync.Mutex
	structuredLogWriter io.Writer = os.Stdout
)

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

// ContextWithTraceID restores an asynchronous trace from the durable trace_id
// stored by the outbox. A stored trace_id has no parent span ID, so the
// generated remote span ID is deliberately synthetic; all following spans
// still remain in the original trace instead of being split into a new one.
// Invalid legacy IDs remain request IDs only and never become a fake OTel ID.
func ContextWithTraceID(ctx context.Context, id string) context.Context {
	if trace.SpanContextFromContext(ctx).IsValid() {
		return ctx
	}
	ctx = WithRequestID(ctx, id)
	traceID, err := trace.TraceIDFromHex(id)
	if err != nil {
		return ctx
	}
	var rawSpanID [8]byte
	if _, err := rand.Read(rawSpanID[:]); err != nil {
		return ctx
	}
	spanID := trace.SpanID(rawSpanID)
	if !spanID.IsValid() {
		return ctx
	}
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	return trace.ContextWithRemoteSpanContext(ctx, spanContext)
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
		started := time.Now()
		traceID := TraceID(ctx)
		if traceID != "" {
			w.Header().Set("X-Trace-Id", traceID)
		}
		w.Header().Set("X-Request-Id", RequestID(ctx))
		next.ServeHTTP(w, r.WithContext(ctx))
		fields := map[string]any{
			"http_method": r.Method,
			"http_route":  r.URL.Path,
			"duration_ms": time.Since(started).Milliseconds(),
		}
		if userID := UserIdentity(ctx); userID != "" {
			fields["user_id"] = userID
		}
		StructuredLog(ctx, service, "info", "request_completed", fields)
	})
}

func UnaryClientTraceInterceptor(service string) grpc.UnaryClientInterceptor {
	tracer := Tracer(service)
	return func(ctx context.Context, method string, req any, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = WithRequestID(ctx, RequestID(ctx))
		ctx, span := tracer.Start(ctx, "grpc.client "+method)
		defer span.End()
		md, _ := metadata.FromOutgoingContext(ctx)
		md = md.Copy()
		md.Set("x-request-id", RequestID(ctx))
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
		ctx = WithRequestID(ctx, firstMetadataValue(md, "x-request-id"))
		ctx, span := tracer.Start(ctx, "grpc.server "+info.FullMethod)
		defer span.End()
		reply, err := handler(ctx, req)
		if err != nil {
			span.RecordError(err)
		}
		return reply, err
	}
}

func firstMetadataValue(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func StructuredLog(ctx context.Context, service string, level string, operation string, fields map[string]any) {
	entry := redactMap(fields)
	entry["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	entry["level"] = level
	entry["service"] = service
	entry["env"] = Env("ENV", "dev")
	entry["operation"] = operation
	if traceID := TraceID(ctx); traceID != "" {
		entry["trace_id"] = traceID
	}
	if spanID := SpanID(ctx); spanID != "" {
		entry["span_id"] = spanID
	}
	if requestID := RequestID(ctx); requestID != "" {
		entry["request_id"] = requestID
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		writeStructuredLog(fmt.Sprintf(`{"timestamp":%q,"level":"error","service":%q,"operation":"log_encode_failed","error":%q}`, time.Now().UTC().Format(time.RFC3339Nano), service, Redact(err.Error())))
		return
	}
	writeStructuredLog(string(raw))
}

func writeStructuredLog(line string) {
	structuredLogMu.Lock()
	defer structuredLogMu.Unlock()
	_, _ = fmt.Fprintln(structuredLogWriter, line)
}

func Redact(value string) string {
	out := value
	for _, rule := range sensitivePatterns {
		out = rule.pattern.ReplaceAllString(out, rule.replacement)
	}
	return out
}

func redactMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = redactValue(key, value)
	}
	return out
}

func redactValue(key string, value any) any {
	if sensitiveLogKey(key) {
		return "[REDACTED]"
	}
	switch typed := value.(type) {
	case string:
		return Redact(typed)
	case error:
		return Redact(typed.Error())
	case map[string]any:
		return redactMap(typed)
	case map[string]string:
		out := make(map[string]string, len(typed))
		for nestedKey, nestedValue := range typed {
			redacted := redactValue(nestedKey, nestedValue)
			out[nestedKey], _ = redacted.(string)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, nestedValue := range typed {
			out[i] = redactValue(key, nestedValue)
		}
		return out
	case []string:
		out := make([]string, len(typed))
		for i, nestedValue := range typed {
			out[i] = Redact(nestedValue)
		}
		return out
	default:
		return value
	}
}

func sensitiveLogKey(key string) bool {
	lower := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	for _, fragment := range []string{
		"token", "password", "secret", "api_key", "apikey", "authorization", "cookie", "credential", "private_key",
		"body", "payload", "content", "prompt", "message", "messages", "input", "output", "response",
	} {
		if strings.Contains(lower, fragment) {
			return true
		}
	}
	return false
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
