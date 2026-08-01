package com.dramaip.platform.gateway;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/** Enforces double-submit CSRF and relays an already validated browser Cookie as Bearer. */
@Component
public class BrowserSessionFilter implements GlobalFilter, Ordered {
    public static final String ACCESS_COOKIE = "dramaip_web_access";
    private static final String REFRESH_COOKIE = "dramaip_web_refresh";
    private static final String CSRF_COOKIE = "dramaip_web_csrf";
    private static final String CSRF_HEADER = "X-CSRF-Token";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest original = exchange.getRequest();
        String authorization = original.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        String accessToken = cookieValue(exchange, ACCESS_COOKIE);
        boolean browserSession = (authorization == null || authorization.isBlank())
                && (!accessToken.isBlank() || !cookieValue(exchange, REFRESH_COOKIE).isBlank());
        boolean credentialEndpoint = credentialEndpoint(original);
        // A stale Cookie session must not prevent a visitor from signing in
        // again. Credential endpoints don't authenticate through the Cookie
        // session and therefore don't need its double-submit CSRF proof.
        if (browserSession && !credentialEndpoint && unsafe(original.getMethod()) && !csrfMatches(exchange)) return csrfRejected(exchange);
        if (!authorizationIsAbsent(authorization) || accessToken.isBlank() || credentialEndpoint) return chain.filter(exchange);

        ServerHttpRequest request = original.mutate().headers(headers -> headers.setBearerAuth(accessToken)).build();
        return chain.filter(exchange.mutate().request(request).build());
    }

    private boolean csrfMatches(ServerWebExchange exchange) {
        String cookie = cookieValue(exchange, CSRF_COOKIE);
        String header = exchange.getRequest().getHeaders().getFirst(CSRF_HEADER);
        return !cookie.isBlank() && header != null && MessageDigest.isEqual(
                cookie.getBytes(StandardCharsets.UTF_8), header.getBytes(StandardCharsets.UTF_8));
    }

    private Mono<Void> csrfRejected(ServerWebExchange exchange) {
        var response = exchange.getResponse();
        response.setStatusCode(HttpStatus.FORBIDDEN);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String requestId = response.getHeaders().getFirst(CorrelationAndContractFilter.REQUEST_ID);
        String traceId = response.getHeaders().getFirst(CorrelationAndContractFilter.TRACE_ID);
        String body = "{\"code\":\"COMMON_CSRF_REJECTED\",\"message\":\"CSRF token is invalid\",\"data\":null,\"requestId\":\""
                + safeIdentifier(requestId) + "\",\"traceId\":\"" + safeIdentifier(traceId) + "\"}";
        DataBuffer buffer = response.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(buffer));
    }

    private String safeIdentifier(String value) { return value != null && value.matches("[A-Za-z0-9._-]{1,128}") ? value : ""; }
    private String cookieValue(ServerWebExchange exchange, String name) {
        var cookie = exchange.getRequest().getCookies().getFirst(name);
        return cookie == null ? "" : cookie.getValue();
    }
    private boolean authorizationIsAbsent(String value) { return value == null || value.isBlank(); }
    private boolean credentialEndpoint(ServerHttpRequest request) {
        String path = request.getPath().value();
        return path.equals("/api/v1/auth/register") || path.equals("/api/v1/auth/token")
                || path.equals("/api/v1/auth/token/refresh") || path.equals("/api/v1/auth/token/revoke");
    }
    private boolean unsafe(HttpMethod method) { return method != HttpMethod.GET && method != HttpMethod.HEAD && method != HttpMethod.OPTIONS && method != HttpMethod.TRACE; }

    @Override
    public int getOrder() { return Ordered.HIGHEST_PRECEDENCE + 1; }
}
