package com.dramaip.platform.gateway;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.TraceCorrelation;
import io.micrometer.core.instrument.Timer;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import reactor.core.publisher.Mono;

/** Establishes correlation IDs and enforces the v2 boundary before routes are selected. */
@Component
public class CorrelationAndContractFilter implements WebFilter, Ordered {
    private static final Logger LOG = LoggerFactory.getLogger(CorrelationAndContractFilter.class);
    static final String REQUEST_ID = "X-Request-Id";
    static final String TRACE_ID = "X-Trace-Id";
    static final String CONTRACT_VERSION = "X-DramaIP-Contract-Version";
    private final DramaipMetrics metrics;

    public CorrelationAndContractFilter(DramaipMetrics metrics) { this.metrics = metrics; }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String requestId = identifier(exchange.getRequest().getHeaders().getFirst(REQUEST_ID));
        String traceId = TraceCorrelation.resolve(exchange.getRequest().getHeaders().getFirst("traceparent"),
                exchange.getRequest().getHeaders().getFirst(TRACE_ID));
        Timer.Sample sample = metrics.start();
        var request = exchange.getRequest().mutate().headers(headers -> {
            headers.set(REQUEST_ID, requestId);
            headers.set(TRACE_ID, traceId);
        }).build();
        var response = exchange.getResponse();
        // Downstream MVC services also return these headers. Set them at the
        // final Gateway commit point so proxying cannot produce duplicate
        // values such as "<trace>, <trace>" on the public response.
        response.beforeCommit(() -> {
            response.getHeaders().set(REQUEST_ID, requestId);
            response.getHeaders().set(TRACE_ID, traceId);
            return Mono.empty();
        });
        if (request.getPath().value().startsWith("/api/") && !"2".equals(request.getHeaders().getFirst(CONTRACT_VERSION))) {
            response.setStatusCode(HttpStatus.UPGRADE_REQUIRED);
            response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            response.getHeaders().set(CONTRACT_VERSION, "2");
            String body = "{\"code\":\"COMMON_CONTRACT_VERSION_UNSUPPORTED\",\"message\":\"X-DramaIP-Contract-Version: 2 is required\",\"data\":null,\"requestId\":\"" + requestId + "\",\"traceId\":\"" + traceId + "\"}";
            DataBuffer buffer = response.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
            return response.writeWith(Mono.just(buffer)).doFinally(ignored -> complete(sample, response.getStatusCode(), requestId, traceId));
        }
        return chain.filter(exchange.mutate().request(request).build())
                .doFinally(ignored -> complete(sample, response.getStatusCode(), requestId, traceId));
    }

    private void complete(Timer.Sample sample, HttpStatusCode status, String requestId, String traceId) {
        int code = status == null ? 500 : status.value();
        String outcome = code >= 400 ? "error" : "success";
        metrics.request(sample, "gateway", outcome, code / 100 + "xx");
        // Spring Boot's Logstash formatter also serializes MDC. Keeping the
        // correlation values there avoids duplicate JSON field names when the
        // OTel agent has already added the current trace context.
        MDC.put("request_id", requestId);
        MDC.put("trace_id", traceId);
        try {
            LOG.atInfo().addKeyValue("operation", "gateway").addKeyValue("status", code)
                    .log("http request completed");
        } finally {
            MDC.remove("request_id");
            MDC.remove("trace_id");
        }
    }

    private String identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}") ? value : UUID.randomUUID().toString();
    }

    @Override
    public int getOrder() { return Ordered.HIGHEST_PRECEDENCE; }
}
