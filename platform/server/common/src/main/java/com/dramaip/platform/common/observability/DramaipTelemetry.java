package com.dramaip.platform.common.observability;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Creates safe, low-cardinality spans for work not described by automatic HTTP/JDBC instrumentation. */
@Component
public final class DramaipTelemetry {
    private static final String INSTRUMENTATION_SCOPE = "com.dramaip.platform";
    private final Tracer tracer;
    private final String deploymentEnvironment;
    private final String serviceVersion;

    @Autowired
    public DramaipTelemetry(
            @Value("${dramaip.observability.deployment-environment:${DRAMAIP_DEPLOYMENT_ENVIRONMENT:unknown}}")
            String deploymentEnvironment,
            @Value("${dramaip.observability.service-version:${DRAMAIP_SERVICE_VERSION:unknown}}") String serviceVersion) {
        this(GlobalOpenTelemetry.getTracer(INSTRUMENTATION_SCOPE), deploymentEnvironment, serviceVersion);
    }

    DramaipTelemetry(Tracer tracer, String deploymentEnvironment, String serviceVersion) {
        this.tracer = tracer;
        this.deploymentEnvironment = bounded(deploymentEnvironment, "unknown");
        this.serviceVersion = bounded(serviceVersion, "unknown");
    }

    public Operation start(String operation) {
        String safeOperation = bounded(operation, "unknown");
        Span span = tracer.spanBuilder(safeOperation).setSpanKind(SpanKind.INTERNAL).startSpan();
        span.setAttribute("dramaip.operation", safeOperation);
        span.setAttribute("deployment.environment.name", deploymentEnvironment);
        span.setAttribute("service.version", serviceVersion);
        return new Operation(span, span.makeCurrent());
    }

    static String bounded(String value, String fallback) {
        if (value == null || !value.matches("[A-Za-z0-9_.:-]{1,96}")) return fallback;
        return value.toLowerCase(Locale.ROOT);
    }

    public static final class Operation implements AutoCloseable {
        private final Span span;
        private final Scope scope;
        private boolean outcomeRecorded;

        private Operation(Span span, Scope scope) {
            this.span = span;
            this.scope = scope;
        }

        public void succeeded() {
            span.setAttribute("dramaip.outcome", "succeeded");
            outcomeRecorded = true;
        }

        public void failed(String category) {
            span.setAttribute("dramaip.outcome", "failed");
            span.setAttribute("error.type", bounded(category, "internal"));
            span.setStatus(StatusCode.ERROR);
            outcomeRecorded = true;
        }

        @Override
        public void close() {
            if (!outcomeRecorded) span.setAttribute("dramaip.outcome", "unknown");
            scope.close();
            span.end();
        }
    }
}
