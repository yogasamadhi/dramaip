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

    private final boolean secure;
    private final String cookieDomain;
    private final Duration refreshTtl;

    public WebSessionCookies(WebSessionProperties properties) {
        this.secure = properties.isSecure();
        this.cookieDomain = properties.getCookieDomain();
        this.refreshTtl = properties.getRefreshTtl();
    }

    public WebSession open(HttpServletResponse response, AuthService.Session session) {
        long accessTtl = Math.max(1, session.expiresIn());
        Duration effectiveRefreshTtl = refreshTtl.isNegative() || refreshTtl.isZero() ? Duration.ofDays(30) : refreshTtl;
        add(response, cookie(ACCESS_COOKIE, session.accessToken(), "/api/v1", Duration.ofSeconds(accessTtl), true));
        add(response, cookie(REFRESH_COOKIE, session.refreshToken(), "/api/v1/auth", effectiveRefreshTtl, true));
        add(response, cookie(CSRF_COOKIE, csrfToken(), "/", effectiveRefreshTtl, false));
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
                .path(path).maxAge(ttl).httpOnly(httpOnly).secure(secure).sameSite("Lax");
        if (!cookieDomain.isBlank()) builder.domain(cookieDomain);
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
