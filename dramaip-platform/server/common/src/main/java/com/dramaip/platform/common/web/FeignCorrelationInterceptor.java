package com.dramaip.platform.common.web;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.springframework.stereotype.Component;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** Propagates request correlation and the Seata XID header without sharing service DTOs or clients. */
@Component
public class FeignCorrelationInterceptor implements RequestInterceptor {
    @Override
    public void apply(RequestTemplate template) {
        template.header(RequestIdFilter.REQUEST_ID, RequestContext.requestId());
        template.header(RequestIdFilter.TRACE_ID, RequestContext.traceId());
        String xid = org.apache.seata.core.context.RootContext.getXID();
        if (xid != null && !xid.isBlank()) template.header(org.apache.seata.core.context.RootContext.KEY_XID, xid);
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken jwt) {
            template.header("Authorization", "Bearer " + jwt.getToken().getTokenValue());
        }
    }
}
