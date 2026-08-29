package com.dramaip.platform.identity.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.identity.IdentityJwtProperties;
import com.dramaip.platform.identity.WebSessionCookies;
import com.dramaip.platform.identity.WebSessionProperties;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class IdentitySecurityTest {
    @Test
    void registrationAndDesktopExchangeRejectMalformedInputBeforeDatabaseAccess() {
        AuthService service = new AuthService(mock(JdbcTemplate.class), mock(TokenService.class));

        assertEquals("IDENTITY_INVALID_EMAIL", assertThrows(
                BusinessException.class,
                () -> service.register("not-an-email", "password123", "Name", "device-123")
        ).code());
        assertEquals("IDENTITY_INVALID_REGISTRATION", assertThrows(
                BusinessException.class,
                () -> service.register("user@example.com", "short", "Name", "device-123")
        ).code());
        assertEquals("IDENTITY_INVALID_DESKTOP_AUTHORIZATION", assertThrows(
                BusinessException.class,
                () -> service.createDesktopAuthorizationCode("user", "short", "https://example.com/callback", "short")
        ).code());
        assertEquals("IDENTITY_INVALID_DESKTOP_EXCHANGE", assertThrows(
                BusinessException.class,
                () -> service.exchangeDesktopAuthorizationCode("short", "short", "http://127.0.0.1:3210/callback", "device-123")
        ).code());
        service.revoke("");
        service.revoke(null);
    }

    @Test
    void tokenServiceCreatesAudienceBoundUserAndAdminTokens() {
        IdentityJwtProperties properties = new IdentityJwtProperties();
        properties.setAllowEphemeralKey(true);
        properties.setKeyId("test-key");
        properties.setIssuer("test-issuer");
        properties.setAudience("test-audience");
        properties.setAccessTtlSeconds(60);
        properties.setRefreshTtlSeconds(120);
        TokenService tokens = new TokenService(properties);

        String access = tokens.accessToken("user-id", "user@example.com");
        TokenService.AdminAccessToken admin = tokens.adminAccessToken("admin-id", "admin@example.com", List.of("support"));

        assertEquals(3, access.split("\\.").length);
        assertEquals(3, admin.token().split("\\.").length);
        assertNotNull(admin.tokenId());
        assertTrue(admin.expiresAt().isAfter(java.time.Instant.now()));
        assertTrue(tokens.jwks().contains("test-key"));
        assertFalse(tokens.jwks().contains("\"d\""));
        assertEquals(120, properties.getRefreshTtlSeconds());
    }

    @Test
    void browserSessionUsesHttpOnlyCredentialCookiesAndReadableCsrfCookie() {
        WebSessionProperties properties = new WebSessionProperties();
        properties.setSecure(true);
        properties.setCookieDomain(" example.test ");
        properties.setRefreshTtl(Duration.ofHours(2));
        WebSessionCookies cookies = new WebSessionCookies(properties);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AuthService.Session session = new AuthService.Session(
                "access-secret", "refresh-secret", "Bearer", 60, "user-id", "user@example.com", "User"
        );

        WebSessionCookies.WebSession opened = cookies.open(response, session);
        List<String> setCookies = response.getHeaders("Set-Cookie");

        assertEquals("user-id", opened.user().id());
        assertEquals(3, setCookies.size());
        assertTrue(setCookies.stream().filter(value -> value.startsWith(WebSessionCookies.ACCESS_COOKIE)).allMatch(value -> value.contains("HttpOnly")));
        assertTrue(setCookies.stream().filter(value -> value.startsWith(WebSessionCookies.REFRESH_COOKIE)).allMatch(value -> value.contains("HttpOnly")));
        assertTrue(setCookies.stream().filter(value -> value.startsWith(WebSessionCookies.CSRF_COOKIE)).noneMatch(value -> value.contains("HttpOnly")));
        assertTrue(setCookies.stream().allMatch(value -> value.contains("Secure") && value.contains("Domain=example.test")));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(WebSessionCookies.REFRESH_COOKIE, "refresh-secret"));
        assertEquals("refresh-secret", cookies.refreshToken(request));
        assertEquals("", cookies.refreshToken(new MockHttpServletRequest()));

        MockHttpServletResponse cleared = new MockHttpServletResponse();
        cookies.clear(cleared);
        assertEquals(3, cleared.getHeaders("Set-Cookie").size());
    }
}
