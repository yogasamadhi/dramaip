package com.dramaip.platform.identity.service;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.RequestContext;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Privileged identity boundary: customer JWTs never grant access to admin principals or their immutable audit evidence. */
@Service
public class AdminService {
    private static final BCryptPasswordEncoder PASSWORDS = new BCryptPasswordEncoder();
    private static final Set<String> ACTIONS = Set.of("principal.suspend", "reporting.exception.resolve", "customer.status.set", "billing.refund.request", "billing.subscription.resume", "quota.adjust", "notification.send", "billing.reconciliation.start", "billing.reconciliation.action", "notification.delivery.retry", "corpus.source.block", "corpus.source.takedown");
    private final JdbcTemplate jdbc;
    private final TokenService tokens;

    public AdminService(JdbcTemplate jdbc, TokenService tokens) { this.jdbc = jdbc; this.tokens = tokens; }

    @Transactional
    public Login login(String email, String password) {
        String normalized = email == null ? "" : email.trim().toLowerCase();
        Principal principal = principalByEmail(normalized);
        if (principal == null || !"active".equals(principal.status()) || password == null || !PASSWORDS.matches(password, principal.passwordHash())) {
            throw new BusinessException("IDENTITY_ADMIN_INVALID_CREDENTIALS", "invalid admin credentials", HttpStatus.UNAUTHORIZED);
        }
        Principal publicPrincipal = publicPrincipal(principal);
        if (publicPrincipal.permissions().isEmpty()) throw new BusinessException("IDENTITY_ADMIN_ROLE_REQUIRED", "admin role is required", HttpStatus.FORBIDDEN);
        TokenService.AdminAccessToken issued = tokens.adminAccessToken(principal.id(), principal.email(), principal.roles());
        jdbc.update("insert into admin.sessions(id, principal_id, token_id_hash, expires_at) values (?::uuid, ?::uuid, ?, ?::timestamptz)", UUID.randomUUID().toString(), principal.id(), hash(issued.tokenId()), Timestamp.from(issued.expiresAt()));
        return new Login(issued.token(), Math.max(1, ChronoUnit.SECONDS.between(Instant.now(), issued.expiresAt())), publicPrincipal);
    }

    public Principal require(Authentication authentication, String permission) {
        if (!(authentication instanceof JwtAuthenticationToken jwt) || !jwt.isAuthenticated() || !"admin".equals(jwt.getToken().getClaimAsString("actorType"))) {
            throw new BusinessException("IDENTITY_ADMIN_AUTH_REQUIRED", "admin authentication is required", HttpStatus.UNAUTHORIZED);
        }
        String principalId = jwt.getToken().getSubject();
        String tokenId = jwt.getToken().getId();
        Integer active = jdbc.queryForObject("""
                select count(*) from admin.sessions session join admin.principals principal on principal.id = session.principal_id
                where session.principal_id = ?::uuid and session.token_id_hash = ? and session.revoked_at is null and session.expires_at > now() and principal.status = 'active'
                """, Integer.class, principalId, hash(tokenId));
        if (active == null || active != 1) throw new BusinessException("IDENTITY_ADMIN_SESSION_EXPIRED", "admin session is expired", HttpStatus.UNAUTHORIZED);
        Principal principal = principalById(principalId);
        Principal result = publicPrincipal(principal);
        if (permission != null && !permission.isBlank() && !result.permissions().contains(permission)) {
            throw new BusinessException("IDENTITY_ADMIN_PERMISSION_DENIED", "admin permission is denied", HttpStatus.FORBIDDEN);
        }
        return result;
    }

    @Transactional
    public Confirmation createConfirmation(Principal actor, String action, String targetId, String reason) {
        String normalizedAction = action == null ? "" : action.trim();
        String normalizedTarget = targetId == null ? "" : targetId.trim();
        String normalizedReason = reason == null ? "" : reason.trim();
        if (!ACTIONS.contains(normalizedAction) || !actor.permissions().contains(permissionFor(normalizedAction))) denied();
        try { UUID.fromString(normalizedTarget); } catch (IllegalArgumentException exception) { invalid("confirmation target must be a UUID"); }
        if (normalizedReason.length() < 4 || normalizedReason.length() > 300) invalid("confirmation reason must be 4 to 300 characters");
        String id = UUID.randomUUID().toString();
        Instant expiresAt = Instant.now().plus(5, ChronoUnit.MINUTES);
        jdbc.update("""
                insert into admin.confirmations(id, actor_id, action, target_id, reason, expires_at)
                values (?::uuid, ?::uuid, ?, ?::uuid, ?, ?::timestamptz)
                """, id, actor.id(), normalizedAction, normalizedTarget, normalizedReason, Timestamp.from(expiresAt));
        return new Confirmation(id, normalizedAction, normalizedTarget, expiresAt);
    }

    @Transactional
    public Principal suspend(Principal actor, String targetId, String confirmationId) {
        requirePermission(actor, "principal.write");
        ConfirmationRow confirmation = confirmation(actor.id(), "principal.suspend", targetId, confirmationId);
        Principal target = principalById(targetId);
        if (target == null) throw new BusinessException("IDENTITY_ADMIN_PRINCIPAL_NOT_FOUND", "admin principal not found", HttpStatus.NOT_FOUND);
        if (!"active".equals(target.status())) throw new BusinessException("IDENTITY_ADMIN_PRINCIPAL_STATE_INVALID", "admin principal is not active", HttpStatus.PRECONDITION_FAILED);
        jdbc.update("update admin.principals set status = 'suspended', updated_at = now() where id = ?::uuid", targetId);
        jdbc.update("update admin.confirmations set consumed_at = now() where id = ?::uuid", confirmation.id());
        appendAudit(actor.id(), "principal.suspend", "admin_principal", targetId, confirmation.reason(), "active", "suspended");
        return publicPrincipal(principalById(targetId));
    }

    @Transactional
    public ConsumedConfirmation consumeConfirmation(Principal actor, String confirmationId, String action, String targetId) {
        requirePermission(actor, permissionFor(action));
        ConfirmationRow confirmation = confirmation(actor.id(), action, targetId, confirmationId);
        jdbc.update("update admin.confirmations set consumed_at = now() where id = ?::uuid", confirmation.id());
        appendAudit(actor.id(), action, "creative_corpus_source", targetId, confirmation.reason(), "pending", "confirmed");
        return new ConsumedConfirmation(confirmation.id(), action, targetId, confirmation.reason());
    }

    public List<AuditLog> audit(Principal actor, int limit) {
        requirePermission(actor, "audit.read");
        int bounded = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                select id::text, actor_id::text, action, resource_type, resource_id, reason, before_state::text, after_state::text, trace_id, created_at
                from admin.audit_logs order by created_at desc, id desc limit ?
                """, (rs, row) -> audit(rs), bounded);
    }

    private ConfirmationRow confirmation(String actorId, String action, String targetId, String confirmationId) {
        List<ConfirmationRow> rows = jdbc.query("""
                select id::text, reason from admin.confirmations
                where id = ?::uuid and actor_id = ?::uuid and action = ? and target_id = ?::uuid and consumed_at is null and expires_at > now() for update
                """, (rs, row) -> new ConfirmationRow(rs.getString(1), rs.getString(2)), confirmationId, actorId, action, targetId);
        if (rows.isEmpty()) throw new BusinessException("IDENTITY_ADMIN_CONFIRMATION_INVALID", "admin confirmation is invalid", HttpStatus.PRECONDITION_FAILED);
        return rows.getFirst();
    }

    private void appendAudit(String actorId, String action, String resourceType, String resourceId, String reason, String before, String after) {
        jdbc.update("""
                insert into admin.audit_logs(id, actor_id, action, resource_type, resource_id, reason, before_state, after_state, trace_id)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, jsonb_build_object('status', ?), jsonb_build_object('status', ?), ?)
                """, UUID.randomUUID().toString(), actorId, action, resourceType, resourceId, reason, before, after, RequestContext.traceId());
    }

    private Principal principalByEmail(String email) {
        List<Principal> rows = jdbc.query(principalSelect("where principal.email = ?"), (rs, row) -> principal(rs), email);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    private Principal principalById(String id) {
        List<Principal> rows = jdbc.query(principalSelect("where principal.id = ?::uuid"), (rs, row) -> principal(rs), id);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    private String principalSelect(String where) { return """
            select principal.id::text, principal.email, principal.password_hash, principal.status, coalesce(array_agg(role.role) filter (where role.role is not null), '{}')
            from admin.principals principal left join admin.principal_roles role on role.principal_id = principal.id
            """ + where + " group by principal.id"; }
    private static Principal principal(ResultSet rs) throws SQLException {
        java.sql.Array values = rs.getArray(5);
        String[] roles = values == null ? new String[0] : (String[]) values.getArray();
        return new Principal(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), List.of(roles), permissions(List.of(roles)));
    }
    private static AuditLog audit(ResultSet rs) throws SQLException { return new AuditLog(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), instant(rs, 10)); }
    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException { var timestamp = rs.getTimestamp(index); return timestamp == null ? null : timestamp.toInstant(); }
    private static Principal publicPrincipal(Principal principal) { return new Principal(principal.id(), principal.email(), "", principal.status(), principal.roles(), permissions(principal.roles())); }
    private static List<String> permissions(List<String> roles) { return roles.stream().flatMap(role -> switch (role) {
        case "viewer" -> java.util.stream.Stream.of("audit.read", "corpus.read");
        case "operator" -> java.util.stream.Stream.of("audit.read", "reporting.write", "customer.write", "notification.write", "corpus.read", "corpus.write");
        case "finance_admin" -> java.util.stream.Stream.of("audit.read", "billing.write", "quota.write");
        case "security_admin" -> java.util.stream.Stream.of("audit.read", "principal.write", "reporting.write", "customer.write", "billing.write", "quota.write", "notification.write", "corpus.read", "corpus.write", "corpus.takedown");
        default -> java.util.stream.Stream.empty();
    }).distinct().sorted().toList(); }
    private static String permissionFor(String action) { return switch (action) {
        case "principal.suspend" -> "principal.write";
        case "reporting.exception.resolve" -> "reporting.write";
        case "customer.status.set" -> "customer.write";
        case "billing.refund.request", "billing.subscription.resume", "billing.reconciliation.start", "billing.reconciliation.action" -> "billing.write";
        case "quota.adjust" -> "quota.write";
        case "notification.send", "notification.delivery.retry" -> "notification.write";
        case "corpus.source.block", "corpus.source.takedown" -> "corpus.takedown";
        default -> "";
    }; }
    private static String hash(String value) { try { return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8))); } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); } }
    private static void requirePermission(Principal actor, String permission) { if (!actor.permissions().contains(permission)) denied(); }
    private static void denied() { throw new BusinessException("IDENTITY_ADMIN_PERMISSION_DENIED", "admin permission is denied", HttpStatus.FORBIDDEN); }
    private static void invalid(String message) { throw new BusinessException("IDENTITY_ADMIN_INVALID_REQUEST", message, HttpStatus.BAD_REQUEST); }
    private record ConfirmationRow(String id, String reason) { }
    public record Login(String accessToken, long expiresIn, Principal principal) { }
    public record Principal(String id, String email, @JsonIgnore String passwordHash, String status, List<String> roles, List<String> permissions) {
        public Principal {
            roles = List.copyOf(roles);
            permissions = List.copyOf(permissions);
        }
        @Override public List<String> roles() { return List.copyOf(roles); }
        @Override public List<String> permissions() { return List.copyOf(permissions); }
    }
    public record Confirmation(String id, String action, String targetId, Instant expiresAt) { }
    public record ConsumedConfirmation(String id, String action, String targetId, String reason) { }
    public record AuditLog(String id, String actorId, String action, String resourceType, String resourceId, String reason, String beforeState, String afterState, String traceId, Instant createdAt) { }
}
