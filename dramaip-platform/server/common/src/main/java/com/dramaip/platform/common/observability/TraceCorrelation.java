package com.dramaip.platform.common.observability;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Resolves the one trace identifier shared by HTTP responses, logs and OTel spans. */
public final class TraceCorrelation {
    private static final Pattern TRACEPARENT = Pattern.compile(
            "^[0-9a-fA-F]{2}-([0-9a-fA-F]{32})-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}(?:-[0-9a-fA-F]+)?$");
    private static final Pattern TRACE_ID = Pattern.compile("^[0-9a-fA-F]{32}$");

    private TraceCorrelation() { }

    public static String resolve(String traceparent, String legacyTraceId) {
        SpanContext current = Span.current().getSpanContext();
        if (current.isValid() && valid(current.getTraceId())) return current.getTraceId().toLowerCase(Locale.ROOT);
        Matcher parsed = TRACEPARENT.matcher(nullToEmpty(traceparent));
        if (parsed.matches() && valid(parsed.group(1))) return parsed.group(1).toLowerCase(Locale.ROOT);
        if (valid(legacyTraceId)) return legacyTraceId.toLowerCase(Locale.ROOT);
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static boolean valid(String value) {
        return value != null && TRACE_ID.matcher(value).matches() && !"00000000000000000000000000000000".equals(value);
    }

    private static String nullToEmpty(String value) { return value == null ? "" : value; }
}
