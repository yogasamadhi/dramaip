package com.dramaip.platform.gateway;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/** Establishes correlation IDs and enforces the v2 boundary before routes are selected. */
@Component
public class CorrelationAndContractFilter implements GlobalFilter, Ordered {
    static final String REQUEST_ID = "X-Request-Id";
    static final String TRACE_ID = "X-Trace-Id";
    static final String CONTRACT_VERSION = "X-DramaIP-Contract-Version";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String requestId = identifier(exchange.getRequest().getHeaders().getFirst(REQUEST_ID));
        String traceId = identifier(exchange.getRequest().getHeaders().getFirst(TRACE_ID));
        var request = exchange.getRequest().mutate().headers(headers -> {
            headers.set(REQUEST_ID, requestId);
            headers.set(TRACE_ID, traceId);
        }).build();
        var response = exchange.getResponse();
        response.getHeaders().set(REQUEST_ID, requestId);
        response.getHeaders().set(TRACE_ID, traceId);
        if (request.getPath().value().startsWith("/api/") && !"2".equals(request.getHeaders().getFirst(CONTRACT_VERSION))) {
            response.setStatusCode(HttpStatus.UPGRADE_REQUIRED);
            response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            response.getHeaders().set(CONTRACT_VERSION, "2");
            String body = "{\"code\":\"COMMON_CONTRACT_VERSION_UNSUPPORTED\",\"message\":\"X-DramaIP-Contract-Version: 2 is required\",\"data\":null,\"requestId\":\"" + requestId + "\",\"traceId\":\"" + traceId + "\"}";
            DataBuffer buffer = response.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
            return response.writeWith(Mono.just(buffer));
        }
        return chain.filter(exchange.mutate().request(request).build());
    }

    private String identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}") ? value : UUID.randomUUID().toString();
    }

    @Override
    public int getOrder() { return Ordered.HIGHEST_PRECEDENCE; }
}
