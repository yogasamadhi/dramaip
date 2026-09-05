package com.dramaip.platform.identity.service;

import com.dramaip.platform.common.web.BusinessException;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final JdbcTemplate jdbc;
    private final TokenService tokens;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();
    public AuthService(JdbcTemplate jdbc, TokenService tokens) { this.jdbc = jdbc; this.tokens = tokens; }

    @Transactional
    public Session register(String email, String password, String displayName, String deviceId) {
        String normalized = normalizeEmail(email);
        if (password == null || password.length() < 8) throw new BusinessException("IDENTITY_INVALID_REGISTRATION", "password must contain at least 8 characters", HttpStatus.BAD_REQUEST);
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("insert into auth.users(id, email, password_hash) values (?::uuid, ?, ?)", id, normalized, passwords.encode(password));
        } catch (DuplicateKeyException exception) {
            throw new BusinessException("IDENTITY_EMAIL_EXISTS", "email is already registered", HttpStatus.CONFLICT);
        }
        jdbc.update("insert into user_profile.profiles(user_id, display_name) values (?::uuid, ?)", id, displayName == null ? "" : displayName.trim());
        return issue(id, normalized, displayName, deviceId);
    }

    public Session login(String email, String password, String deviceId) {
        User user = jdbc.query("select id::text, email, password_hash, status from auth.users where lower(email) = lower(?)", rs -> rs.next() ? new User(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null, normalizeEmail(email));
        if (user == null || !"active".equals(user.status()) || !passwords.matches(password, user.passwordHash())) throw new BusinessException("IDENTITY_INVALID_CREDENTIALS", "invalid credentials", HttpStatus.UNAUTHORIZED);
        String name = jdbc.query("select coalesce(display_name, '') from user_profile.profiles where user_id = ?::uuid", rs -> rs.next() ? rs.getString(1) : "", user.id());
        return issue(user.id(), user.email(), name, deviceId);
    }

    public WebUser webUser(String userId) {
        return jdbc.query("""
                select users.id::text, users.email, coalesce(profiles.display_name, '')
                from auth.users users
                left join user_profile.profiles profiles on profiles.user_id = users.id
                where users.id = ?::uuid and users.status = 'active'
                """, rs -> rs.next() ? new WebUser(rs.getString(1), rs.getString(2), rs.getString(3)) : null, userId);
    }

    @Transactional
    public Session refresh(String refreshToken, String deviceId) {
        String hash = hash(refreshToken);
        User user = jdbc.query("""
                select users.id::text, users.email, users.password_hash, users.status from auth.refresh_tokens refresh
                join auth.users users on users.id = refresh.user_id
                where refresh.token_hash = ? and refresh.revoked_at is null and refresh.expires_at > now() for update
                """, rs -> rs.next() ? new User(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null, hash);
        if (user == null || !"active".equals(user.status())) throw new BusinessException("IDENTITY_REFRESH_INVALID", "refresh token is invalid", HttpStatus.UNAUTHORIZED);
        jdbc.update("update auth.refresh_tokens set revoked_at = now(), revoked_reason = 'rotated', last_used_at = now() where token_hash = ?", hash);
        String name = jdbc.query("select coalesce(display_name, '') from user_profile.profiles where user_id = ?::uuid", rs -> rs.next() ? rs.getString(1) : "", user.id());
        return issue(user.id(), user.email(), name, deviceId);
    }

    @Transactional
    public void revoke(String refreshToken) {
        if (refreshToken != null && !refreshToken.isBlank()) jdbc.update("update auth.refresh_tokens set revoked_at = coalesce(revoked_at, now()), revoked_reason = 'logout' where token_hash = ?", hash(refreshToken));
    }

    @Transactional
    public void requestEmailVerification(String userId) {
        EmailUser user = jdbc.query(
                "select id::text, email from auth.users where id = ?::uuid and status = 'active'",
                rs -> rs.next() ? new EmailUser(rs.getString(1), rs.getString(2)) : null,
                userId);
        if (user == null) return;
        String token = createEmailAction(user.id(), "verify_email", "24 hours");
        auditAndPublish(user, "identity.email-verification-requested.v1", "verify_email", token);
    }

    @Transactional
    public void confirmEmailVerification(String token) {
        EmailAction action = consumeEmailAction(null, token, "verify_email");
        jdbc.update("update auth.users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = ?::uuid", action.userId());
        audit(action.userId(), "identity.email-verified.v1", action.email());
        publish(action.userId(), "identity.email-verified.v1", action.email(), "verify_email", null);
    }

    @Transactional
    public void requestPasswordReset(String email) {
        String normalized;
        try {
            normalized = normalizeEmail(email);
        } catch (BusinessException exception) {
            audit(null, "identity.password-reset-requested.v1", String.valueOf(email));
            return;
        }
        EmailUser user = jdbc.query(
                "select id::text, email from auth.users where lower(email) = lower(?) and status = 'active'",
                rs -> rs.next() ? new EmailUser(rs.getString(1), rs.getString(2)) : null,
                normalized);
        if (user == null) {
            audit(null, "identity.password-reset-requested.v1", normalized);
            return;
        }
        String token = createEmailAction(user.id(), "reset_password", "30 minutes");
        auditAndPublish(user, "identity.password-reset-requested.v1", "reset_password", token);
    }

    @Transactional
    public void confirmPasswordReset(String email, String token, String password) {
        if (password == null || password.length() < 8) {
            throw new BusinessException("IDENTITY_INVALID_PASSWORD", "password must contain at least 8 characters", HttpStatus.BAD_REQUEST);
        }
        EmailAction action = consumeEmailAction(normalizeEmail(email), token, "reset_password");
        jdbc.update("update auth.users set password_hash = ?, session_invalidated_at = now(), updated_at = now() where id = ?::uuid",
                passwords.encode(password), action.userId());
        jdbc.update("""
                update auth.refresh_tokens
                set revoked_at = coalesce(revoked_at, now()), revoked_reason = 'password_reset'
                where user_id = ?::uuid
                """, action.userId());
        audit(action.userId(), "identity.password-reset-completed.v1", action.email());
        publish(action.userId(), "identity.password-reset-completed.v1", action.email(), "reset_password", null);
    }

    private String createEmailAction(String userId, String purpose, String lifetime) {
        jdbc.update("""
                update auth.email_actions set consumed_at = coalesce(consumed_at, now())
                where user_id = ?::uuid and purpose = ? and consumed_at is null
                """, userId, purpose);
        String token = randomToken();
        jdbc.update("""
                insert into auth.email_actions(id, user_id, purpose, token_hash, expires_at)
                values (?::uuid, ?::uuid, ?, ?, now() + cast(? as interval))
                """, UUID.randomUUID().toString(), userId, purpose, hash(token), lifetime);
        return token;
    }

    private EmailAction consumeEmailAction(String expectedEmail, String token, String purpose) {
        if (token == null || token.isBlank()) {
            throw new BusinessException("IDENTITY_EMAIL_ACTION_INVALID", "email action is invalid or expired", HttpStatus.BAD_REQUEST);
        }
        EmailAction action = jdbc.query("""
                select action.id::text, users.id::text, users.email
                from auth.email_actions action
                join auth.users users on users.id = action.user_id
                where action.token_hash = ? and action.purpose = ? and action.consumed_at is null
                  and action.expires_at > now() and users.status = 'active'
                for update of action
                """, rs -> rs.next() ? new EmailAction(rs.getString(1), rs.getString(2), rs.getString(3)) : null,
                hash(token), purpose);
        if (action == null || (expectedEmail != null && !expectedEmail.equalsIgnoreCase(action.email()))) {
            throw new BusinessException("IDENTITY_EMAIL_ACTION_INVALID", "email action is invalid or expired", HttpStatus.BAD_REQUEST);
        }
        jdbc.update("update auth.email_actions set consumed_at = now() where id = ?::uuid and consumed_at is null", action.id());
        return action;
    }

    private void auditAndPublish(EmailUser user, String eventType, String purpose, String token) {
        audit(user.id(), eventType, user.email());
        publish(user.id(), eventType, user.email(), purpose, token);
    }

    private void audit(String userId, String eventType, String subject) {
        jdbc.update("""
                insert into auth.security_audit_events(id, user_id, event_type, subject_hash)
                values (?::uuid, ?::uuid, ?, ?)
                """, UUID.randomUUID().toString(), userId, eventType, hash(subject == null ? "" : subject));
    }

    private void publish(String userId, String eventType, String email, String purpose, String deliveryToken) {
        jdbc.update("""
                insert into user_profile.identity_outbox_events(
                  id, aggregate_type, aggregate_id, event_type, payload
                ) values (?::uuid, 'user', ?::uuid, ?,
                  jsonb_build_object('userId', ?, 'email', ?, 'purpose', ?,
                    'deliveryToken', ?, 'sensitive', true))
                """, UUID.randomUUID().toString(), userId, eventType, userId, email, purpose, deliveryToken);
    }

    /** Issues a one-time OAuth 2.1 PKCE code while persisting only its digest. */
    @Transactional
    public DesktopAuthorizationCode createDesktopAuthorizationCode(String userId, String codeChallenge, String redirectUri, String deviceId) {
        if (!validChallenge(codeChallenge) || !validRedirectUri(redirectUri) || !validDeviceId(deviceId)) {
            throw new BusinessException("IDENTITY_INVALID_DESKTOP_AUTHORIZATION", "invalid desktop authorization request", HttpStatus.BAD_REQUEST);
        }
        var user = jdbc.query("select id::text from auth.users where id = ?::uuid and status = 'active'", rs -> rs.next() ? rs.getString(1) : null, userId);
        if (user == null) throw new BusinessException("IDENTITY_ACCOUNT_NOT_FOUND", "account not found", HttpStatus.NOT_FOUND);
        jdbc.update("""
                update auth.desktop_authorization_codes set consumed_at = now(), consumed_reason = 'superseded'
                where user_id = ?::uuid and device_id = ? and consumed_at is null and expires_at > now()
                """, userId, deviceId.trim());
        var code = randomAuthorizationCode();
        jdbc.update("""
                insert into auth.desktop_authorization_codes(id, user_id, code_hash, code_challenge, redirect_uri, device_id, expires_at)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, now() + interval '5 minutes')
                """, UUID.randomUUID().toString(), userId, hash(code), codeChallenge.trim(), redirectUri.trim(), deviceId.trim());
        return new DesktopAuthorizationCode(code, 300);
    }

    /** Atomically consumes a PKCE code; replay and challenge mismatches cannot create a session. */
    @Transactional
    public Session exchangeDesktopAuthorizationCode(String authorizationCode, String codeVerifier, String redirectUri, String deviceId) {
        if (!validAuthorizationCode(authorizationCode) || !validVerifier(codeVerifier) || !validRedirectUri(redirectUri) || !validDeviceId(deviceId)) {
            throw new BusinessException("IDENTITY_INVALID_DESKTOP_EXCHANGE", "invalid desktop authorization exchange", HttpStatus.BAD_REQUEST);
        }
        var user = jdbc.query("""
                update auth.desktop_authorization_codes code set consumed_at = now(), consumed_reason = 'exchanged'
                from auth.users user_record
                where code.user_id = user_record.id and code.code_hash = ? and code.code_challenge = ?
                  and code.redirect_uri = ? and code.device_id = ? and code.consumed_at is null and code.expires_at > now()
                  and user_record.status = 'active'
                returning user_record.id::text, user_record.email
                """, rs -> rs.next() ? new DesktopUser(rs.getString(1), rs.getString(2)) : null, hash(authorizationCode),
                challenge(codeVerifier), redirectUri.trim(), deviceId.trim());
        if (user == null) throw new BusinessException("IDENTITY_DESKTOP_CODE_INVALID", "authorization code is invalid or expired", HttpStatus.UNAUTHORIZED);
        var name = jdbc.query("select coalesce(display_name, '') from user_profile.profiles where user_id = ?::uuid", rs -> rs.next() ? rs.getString(1) : "", user.id());
        return issue(user.id(), user.email(), name, deviceId.trim());
    }

    private Session issue(String userId, String email, String name, String deviceId) {
        String refresh = randomToken();
        jdbc.update("insert into auth.refresh_tokens(id, user_id, token_hash, device_id, expires_at, family_id) values (?::uuid, ?::uuid, ?, ?, now() + interval '30 days', ?::uuid)", UUID.randomUUID().toString(), userId, hash(refresh), deviceId, UUID.randomUUID().toString());
        return new Session(tokens.accessToken(userId, email), refresh, "Bearer", 900, userId, email, name == null ? "" : name);
    }
    private String normalizeEmail(String email) {
        String value = email == null ? "" : email.trim().toLowerCase();
        if (!value.contains("@")) throw new BusinessException("IDENTITY_INVALID_EMAIL", "email is invalid", HttpStatus.BAD_REQUEST);
        return value;
    }
    private String randomToken() { byte[] bytes = new byte[48]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private String randomAuthorizationCode() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private String hash(String token) { try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); } catch (Exception exception) { throw new IllegalStateException(exception); } }
    private String challenge(String verifier) { return hash(verifier.trim()); }
    private static boolean validChallenge(String value) { return value != null && value.trim().matches("^[A-Za-z0-9_-]{43}$"); }
    private static boolean validAuthorizationCode(String value) { return value != null && value.trim().matches("^[A-Za-z0-9_-]{43}$"); }
    private static boolean validVerifier(String value) { return value != null && value.trim().matches("^[A-Za-z0-9\\-._~]{43,128}$"); }
    private static boolean validDeviceId(String value) { return value != null && value.trim().matches("^[A-Za-z0-9_:.\\-]{8,128}$"); }
    private static boolean validRedirectUri(String raw) {
        try {
            var uri = URI.create(raw.trim());
            return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() > 0
                    && uri.getPort() <= 65535 && "/callback".equals(uri.getPath()) && uri.getRawQuery() == null
                    && uri.getRawFragment() == null && uri.getUserInfo() == null;
        } catch (RuntimeException exception) { return false; }
    }
    private record User(String id, String email, String passwordHash, String status) { }
    private record DesktopUser(String id, String email) { }
    private record EmailUser(String id, String email) { }
    private record EmailAction(String id, String userId, String email) { }
    public record Session(String accessToken, String refreshToken, String tokenType, long expiresIn, String userId, String email, String name) { }
    public record WebUser(String id, String email, String name) { }
    public record DesktopAuthorizationCode(String authorizationCode, long expiresIn) { }
}
