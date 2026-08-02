package com.dramaip.platform.identity;

import com.dramaip.platform.identity.service.AuthService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Issues the Web Cookie session without exposing credentials to JavaScript. */
@Component
public class WebSessionCookies {
    public static final String ACCESS_COOKIE = "dramaip_web_access";
    public static final String REFRESH_COOKIE = "dramaip_web_refresh";
    public static final String CSRF_COOKIE = "dramaip_web_csrf";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final WebSessionProperties properties;

    public WebSessionCookies(WebSessionProperties properties) { this.properties = properties; }

    public WebSession open(HttpServletResponse response, AuthService.Session session) {
        long accessTtl = Math.max(1, session.expiresIn());
        Duration refreshTtl = properties.getRefreshTtl().isNegative() || properties.getRefreshTtl().isZero()
                ? Duration.ofDays(30) : properties.getRefreshTtl();
        add(response, cookie(ACCESS_COOKIE, session.accessToken(), "/api/v1", Duration.ofSeconds(accessTtl), true));
        add(response, cookie(REFRESH_COOKIE, session.refreshToken(), "/api/v1/auth", refreshTtl, true));
        add(response, cookie(CSRF_COOKIE, csrfToken(), "/", refreshTtl, false));
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        return new WebSession(new User(session.userId(), session.email(), session.name()));
    }

    public void clear(HttpServletResponse response) {
        add(response, cookie(ACCESS_COOKIE, "", "/api/v1", Duration.ZERO, true));
        add(response, cookie(REFRESH_COOKIE, "", "/api/v1/auth", Duration.ZERO, true));
        add(response, cookie(CSRF_COOKIE, "", "/", Duration.ZERO, false));
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    public String refreshToken(HttpServletRequest request) { return cookieValue(request, REFRESH_COOKIE); }

    private ResponseCookie cookie(String name, String value, String path, Duration ttl, boolean httpOnly) {
        var builder = ResponseCookie.from(name, value == null ? "" : value)
                .path(path).maxAge(ttl).httpOnly(httpOnly).secure(properties.isSecure()).sameSite("Lax");
        if (!properties.getCookieDomain().isBlank()) builder.domain(properties.getCookieDomain());
        return builder.build();
    }

    private void add(HttpServletResponse response, ResponseCookie cookie) { response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString()); }

    private String csrfToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String cookieValue(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return "";
        for (Cookie cookie : cookies) if (name.equals(cookie.getName())) return cookie.getValue();
        return "";
    }

    public record WebSession(User user) { }
    public record User(String id, String email, String name) { }
}
