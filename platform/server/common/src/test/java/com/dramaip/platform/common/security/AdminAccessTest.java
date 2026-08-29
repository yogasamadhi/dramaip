package com.dramaip.platform.common.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dramaip.platform.common.web.BusinessException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class AdminAccessTest {
    @Test
    void securityAdminCanReadAndOperateAcrossAdminDomains() {
        JwtAuthenticationToken authentication = admin(List.of("security_admin"));

        assertEquals("principal-1", AdminAccess.require(authentication, "audit.read"));
        assertEquals("principal-1", AdminAccess.require(authentication, "billing.write"));
        assertEquals("principal-1", AdminAccess.require(authentication, "notification.write"));
        assertEquals("principal-1", AdminAccess.require(authentication, "corpus.read"));
        assertEquals("principal-1", AdminAccess.require(authentication, "corpus.write"));
        assertEquals("principal-1", AdminAccess.require(authentication, "corpus.takedown"));
    }

    @Test
    void customerTokenAndInsufficientRoleAreRejected() {
        JwtAuthenticationToken customer = token("user", List.of("security_admin"));
        BusinessException customerError = assertThrows(BusinessException.class, () -> AdminAccess.require(customer, "audit.read"));
        assertEquals("IDENTITY_ADMIN_AUTH_REQUIRED", customerError.code());

        BusinessException permissionError = assertThrows(BusinessException.class,
                () -> AdminAccess.require(admin(List.of("viewer")), "billing.write"));
        assertEquals("IDENTITY_ADMIN_PERMISSION_DENIED", permissionError.code());

        assertEquals("principal-1", AdminAccess.require(admin(List.of("viewer")), "corpus.read"));
        BusinessException takedownError = assertThrows(BusinessException.class,
                () -> AdminAccess.require(admin(List.of("operator")), "corpus.takedown"));
        assertEquals("IDENTITY_ADMIN_PERMISSION_DENIED", takedownError.code());
    }

    private static JwtAuthenticationToken admin(List<String> roles) { return token("admin", roles); }

    private static JwtAuthenticationToken token(String actorType, List<String> roles) {
        Jwt jwt = Jwt.withTokenValue("test-token").header("alg", "none").subject("principal-1")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60))
                .claim("actorType", actorType).claim("roles", roles).build();
        return new JwtAuthenticationToken(jwt, List.of());
    }
}
