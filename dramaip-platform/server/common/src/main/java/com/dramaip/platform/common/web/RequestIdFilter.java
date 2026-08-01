package com.dramaip.platform.common.web;

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

/** Propagates or creates stable request and trace identifiers for HTTP and Feign calls. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    public static final String REQUEST_ID = "X-Request-Id";
    public static final String TRACE_ID = "X-Trace-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = validOrGenerated(request.getHeader(REQUEST_ID));
        String traceId = validOrGenerated(request.getHeader(TRACE_ID));
        response.setHeader(REQUEST_ID, requestId);
        response.setHeader(TRACE_ID, traceId);
        RequestContext.set(requestId, traceId);
        try {
            chain.doFilter(request, response);
        } finally {
            RequestContext.clear();
        }
    }

    private String validOrGenerated(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}") ? value : UUID.randomUUID().toString();
    }
}
