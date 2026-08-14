package com.dramaip.platform.common.security;

import com.dramaip.platform.common.web.BusinessException;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/** Verifies the signed admin actor and its role-derived permission at a domain boundary. */
public final class AdminAccess {
    private AdminAccess() { }

    public static String require(Authentication authentication, String permission) {
        if (!(authentication instanceof JwtAuthenticationToken jwt) || !jwt.isAuthenticated()
                || !"admin".equals(jwt.getToken().getClaimAsString("actorType"))
                || jwt.getToken().getSubject() == null) {
            throw new BusinessException("IDENTITY_ADMIN_AUTH_REQUIRED", "admin authentication is required", HttpStatus.UNAUTHORIZED);
        }
        if (permission != null && !permission.isBlank() && !permissions(jwt.getToken().getClaimAsStringList("roles")).contains(permission)) {
            throw new BusinessException("IDENTITY_ADMIN_PERMISSION_DENIED", "admin permission is denied", HttpStatus.FORBIDDEN);
        }
        return jwt.getToken().getSubject();
    }

    private static Set<String> permissions(List<String> roles) {
        if (roles == null) return Set.of();
        java.util.HashSet<String> permissions = new java.util.HashSet<>();
        for (String role : roles) {
            if (role == null) continue;
            switch (role) {
                case "viewer" -> permissions.add("audit.read");
                case "operator" -> permissions.addAll(Set.of("audit.read", "reporting.write", "customer.write", "notification.write"));
                case "finance_admin" -> permissions.addAll(Set.of("audit.read", "billing.write", "quota.write"));
                case "security_admin" -> permissions.addAll(Set.of("audit.read", "principal.write", "reporting.write", "customer.write", "billing.write", "quota.write", "notification.write"));
                default -> { }
            }
        }
        return Set.copyOf(permissions);
    }
}
