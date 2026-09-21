package com.dramaip.platform.common.web;

import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.util.Map;
import java.util.Objects;
import org.slf4j.MDC;

/**
 * Captures the safe request correlation state before work crosses an executor boundary.
 *
 * <p>Only the two validated correlation identifiers are copied from MDC. Arbitrary MDC
 * entries are deliberately excluded so a future caller cannot accidentally propagate a
 * credential, prompt, request body, or user identifier into background logs.</p>
 */
public final class CorrelationContextSnapshot {
    private final String requestId;
    private final String traceId;
    private final Context telemetryContext;

    private CorrelationContextSnapshot(String requestId, String traceId, Context telemetryContext) {
        this.requestId = requestId;
        this.traceId = traceId;
        this.telemetryContext = telemetryContext;
    }

    public static CorrelationContextSnapshot capture() {
        return new CorrelationContextSnapshot(RequestContext.requestId(), RequestContext.traceId(), Context.current());
    }

    public Runnable wrap(Runnable action) {
        Objects.requireNonNull(action, "action");
        return () -> run(action);
    }

    private void run(Runnable action) {
        String previousRequestId = RequestContext.requestId();
        String previousTraceId = RequestContext.traceId();
        Map<String, String> previousMdc = MDC.getCopyOfContextMap();
        MDC.clear();
        setCorrelation(requestId, traceId);
        try (Scope ignored = telemetryContext.makeCurrent()) {
            action.run();
        } finally {
            setCorrelation(previousRequestId, previousTraceId);
            MDC.clear();
            if (previousMdc != null) MDC.setContextMap(previousMdc);
        }
    }

    private static void setCorrelation(String requestId, String traceId) {
        if (requestId == null || requestId.isBlank()) {
            RequestContext.clear();
            MDC.remove("request_id");
            MDC.remove("trace_id");
            return;
        }
        RequestContext.set(requestId, traceId == null ? "" : traceId);
        MDC.put("request_id", requestId);
        if (traceId == null || traceId.isBlank()) MDC.remove("trace_id");
        else MDC.put("trace_id", traceId);
    }
}
