package com.dramaip.platform.common.security;

import com.dramaip.platform.common.web.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

public final class CurrentUser {
    private CurrentUser() { }

    public static String id(Authentication authentication) {
        if (authentication instanceof JwtAuthenticationToken jwt && jwt.isAuthenticated() && jwt.getToken().getSubject() != null) {
            return jwt.getToken().getSubject();
        }
        throw new BusinessException("IDENTITY_UNAUTHENTICATED", "authentication is required", HttpStatus.UNAUTHORIZED);
    }
}
