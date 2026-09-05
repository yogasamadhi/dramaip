package com.dramaip.platform.identity.controller;

import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.identity.WebSessionCookies;
import com.dramaip.platform.identity.service.AuthService;
import com.dramaip.platform.identity.service.TokenService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    private final AuthService auth;
    private final TokenService tokens;
    private final WebSessionCookies webSessions;
    public AuthController(AuthService auth, TokenService tokens, WebSessionCookies webSessions) { this.auth = auth; this.tokens = tokens; this.webSessions = webSessions; }

    @PostMapping("/api/v1/auth/register")
    public Result<?> register(@Valid @RequestBody RegisterRequest request, @RequestHeader(value = "X-Device-Id", required = false) String deviceId,
            @RequestHeader(value = "X-DramaIP-Web-Session", defaultValue = "false") boolean webSession, HttpServletResponse response) {
        return session(auth.register(request.email(), request.password(), request.displayName(), deviceId), webSession, response);
    }

    @PostMapping("/api/v1/auth/token")
    public Result<?> login(@Valid @RequestBody LoginRequest request, @RequestHeader(value = "X-Device-Id", required = false) String deviceId,
            @RequestHeader(value = "X-DramaIP-Web-Session", defaultValue = "false") boolean webSession, HttpServletResponse response) {
        return session(auth.login(request.email(), request.password(), deviceId), webSession, response);
    }

    @PostMapping(value = "/api/v1/auth/token/refresh", headers = "X-DramaIP-Web-Session=1")
    public Result<WebSessionCookies.WebSession> refreshWeb(@RequestHeader(value = "X-Device-Id", required = false) String deviceId,
            HttpServletRequest servletRequest, HttpServletResponse response) {
        String refreshToken = webSessions.refreshToken(servletRequest);
        if (refreshToken.isBlank()) throw new BusinessException("IDENTITY_REFRESH_INVALID", "refresh token is required", HttpStatus.UNAUTHORIZED);
        return Result.ok(webSessions.open(response, auth.refresh(refreshToken, deviceId)));
    }

    @PostMapping("/api/v1/auth/token/refresh")
    public Result<AuthService.Session> refreshNative(@Valid @RequestBody RefreshRequest request, @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        return Result.ok(auth.refresh(request.refreshToken(), deviceId));
    }

    @PostMapping(value = "/api/v1/auth/token/revoke", headers = "X-DramaIP-Web-Session=1")
    public Result<LogoutResponse> revokeWeb(HttpServletRequest servletRequest, HttpServletResponse response) {
        String refreshToken = webSessions.refreshToken(servletRequest);
        webSessions.clear(response);
        auth.revoke(refreshToken);
        return Result.ok(new LogoutResponse(true));
    }

    @PostMapping("/api/v1/auth/token/revoke")
    public Result<Void> revokeNative(@RequestBody RevokeRequest request) {
        auth.revoke(request.refreshToken());
        return Result.ok(null);
    }

    @PostMapping("/api/v1/auth/email-verification/request")
    public Result<EmailActionResponse> requestEmailVerification(Authentication authentication) {
        auth.requestEmailVerification(CurrentUser.id(authentication));
        return Result.ok(new EmailActionResponse(true));
    }

    @PostMapping("/api/v1/auth/email-verification/confirm")
    public Result<EmailActionResponse> confirmEmailVerification(
            @Valid @RequestBody EmailVerificationConfirmRequest request) {
        auth.confirmEmailVerification(request.code());
        return Result.ok(new EmailActionResponse(true));
    }

    @PostMapping("/api/v1/auth/password-reset/request")
    public Result<EmailActionResponse> requestPasswordReset(
            @Valid @RequestBody PasswordResetRequest request) {
        auth.requestPasswordReset(request.email());
        return Result.ok(new EmailActionResponse(true));
    }

    @PostMapping("/api/v1/auth/password-reset/confirm")
    public Result<EmailActionResponse> confirmPasswordReset(
            @Valid @RequestBody PasswordResetConfirmRequest request) {
        auth.confirmPasswordReset(request.email(), request.code(), request.password());
        return Result.ok(new EmailActionResponse(true));
    }

    /** Browser session lookup has a deliberately smaller response than the mobile token API. */
    @GetMapping("/api/v1/auth/session")
    public Result<WebSessionCookies.WebSession> session(Authentication authentication) {
        var user = auth.webUser(CurrentUser.id(authentication));
        if (user == null) throw new BusinessException("IDENTITY_UNAUTHENTICATED", "authentication is required", HttpStatus.UNAUTHORIZED);
        return Result.ok(new WebSessionCookies.WebSession(new WebSessionCookies.User(user.id(), user.email(), user.name())));
    }

    private Result<?> session(AuthService.Session issued, boolean webSession, HttpServletResponse response) {
        return webSession ? Result.ok(webSessions.open(response, issued)) : Result.ok(issued);
    }
    @PostMapping("/api/v1/auth/desktop/authorization-codes")
    public Result<AuthService.DesktopAuthorizationCode> createDesktopAuthorizationCode(Authentication authentication, @Valid @RequestBody DesktopAuthorizationRequest request) {
        return Result.ok(auth.createDesktopAuthorizationCode(CurrentUser.id(authentication), request.codeChallenge(), request.redirectUri(), request.deviceId()));
    }
    @PostMapping("/api/v1/auth/desktop/token")
    public Result<AuthService.Session> exchangeDesktopAuthorizationCode(@Valid @RequestBody DesktopTokenRequest request) {
        return Result.ok(auth.exchangeDesktopAuthorizationCode(request.authorizationCode(), request.codeVerifier(), request.redirectUri(), request.deviceId()));
    }
    @GetMapping(value = "/.well-known/jwks.json", produces = MediaType.APPLICATION_JSON_VALUE) public ResponseEntity<String> jwks() { return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").body(tokens.jwks()); }
    public record RegisterRequest(@NotBlank String email, @NotBlank String password, String displayName) { }
    public record LoginRequest(@NotBlank String email, @NotBlank String password) { }
    public record RefreshRequest(@NotBlank String refreshToken) { }
    public record RevokeRequest(String refreshToken) { }
    public record LogoutResponse(boolean ok) { }
    public record DesktopAuthorizationRequest(@NotBlank String codeChallenge, @NotBlank String redirectUri, @NotBlank String deviceId) { }
    public record DesktopTokenRequest(@NotBlank String authorizationCode, @NotBlank String codeVerifier, @NotBlank String redirectUri, @NotBlank String deviceId) { }
    public record EmailVerificationConfirmRequest(@NotBlank String code) { }
    public record PasswordResetRequest(@NotBlank @Email String email) { }
    public record PasswordResetConfirmRequest(@NotBlank @Email String email,
            @NotBlank String code, @NotBlank @Size(min = 8, max = 200) String password) { }
    public record EmailActionResponse(boolean accepted) { }
}
