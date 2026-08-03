package com.dramaip.platform.common.web;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.TraceCorrelation;
import io.micrometer.core.instrument.Timer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/** Propagates or creates stable request and trace identifiers for HTTP and Feign calls. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(RequestIdFilter.class);
    public static final String REQUEST_ID = "X-Request-Id";
    public static final String TRACE_ID = "X-Trace-Id";
    private final DramaipMetrics metrics;

    public RequestIdFilter(DramaipMetrics metrics) { this.metrics = metrics; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = validOrGenerated(request.getHeader(REQUEST_ID));
        String traceId = TraceCorrelation.resolve(request.getHeader("traceparent"), request.getHeader(TRACE_ID));
        response.setHeader(REQUEST_ID, requestId);
        response.setHeader(TRACE_ID, traceId);
        RequestContext.set(requestId, traceId);
        MDC.put("request_id", requestId);
        MDC.put("trace_id", traceId);
        Timer.Sample sample = metrics.start();
        try {
            chain.doFilter(request, response);
        } finally {
            String operation = operation(request);
            String statusClass = response.getStatus() / 100 + "xx";
            String outcome = response.getStatus() >= 400 ? "error" : "success";
            metrics.request(sample, operation, outcome, statusClass);
            // request_id and trace_id are emitted from MDC. Repeating them as
            // fluent key-values makes Spring Boot's strict JSON writer reject
            // the whole access event for duplicate field names.
            LOG.atInfo().addKeyValue("operation", operation).addKeyValue("status", response.getStatus())
                    .log("http request completed");
            MDC.remove("request_id");
            MDC.remove("trace_id");
            RequestContext.clear();
        }
    }

    private static String operation(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String value = pattern == null ? "unmatched" : pattern.toString();
        return value.matches("/[A-Za-z0-9_{}./-]{1,80}") ? request.getMethod() + ":" + value : "unmatched";
    }

    private String validOrGenerated(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}") ? value : UUID.randomUUID().toString();
    }
}
