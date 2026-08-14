package com.dramaip.platform.common.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Rejects public traffic that has not explicitly selected the breaking v2 contract. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class ContractVersionFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-DramaIP-Contract-Version";
    private final ObjectMapper objectMapper;

    public ContractVersionFilter(ObjectMapper objectMapper) { this.objectMapper = objectMapper; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/") && !"2".equals(request.getHeader(HEADER))) {
            response.setStatus(HttpServletResponse.SC_UPGRADE_REQUIRED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader(HEADER, "2");
            objectMapper.writeValue(response.getOutputStream(),
                    Result.failure("COMMON_CONTRACT_VERSION_UNSUPPORTED", "X-DramaIP-Contract-Version: 2 is required"));
            return;
        }
        chain.doFilter(request, response);
    }
}
