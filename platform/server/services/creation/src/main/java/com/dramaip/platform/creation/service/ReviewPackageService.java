package com.dramaip.platform.creation.service;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.creation.client.WorkspaceClient;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import feign.FeignException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owns review metadata while the encrypted media bytes remain in a private S3-compatible bucket. */
@Service
public class ReviewPackageService {
    private static final long MAX_PACKAGE_BYTES = 512L << 20;
    private static final int MAX_MEDIA = 500;
    private static final Pattern PACKAGE_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$");
    private static final Pattern CLIENT_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern PIN = Pattern.compile("^[0-9]{4,12}$");
    private static final BCryptPasswordEncoder BCRYPT = new BCryptPasswordEncoder();
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate jdbc;
    private final WorkspaceClient workspaces;
    private final ReviewObjectStore store;
    private final ObjectMapper json;

    public ReviewPackageService(JdbcTemplate jdbc, WorkspaceClient workspaces, ReviewObjectStore store, ObjectMapper json) {
        this.jdbc = jdbc;
        this.workspaces = workspaces;
        this.store = store;
        this.json = json;
    }

    @Transactional
    public Created create(String userId, CreateRequest request) {
        WorkspaceClient.Workspace workspace = currentWorkspace(request.workspaceId());
        validateWorkspace(workspace);
        ValidatedCreate valid = validateCreate(request);
        store.check();
        jdbc.query("select pg_advisory_xact_lock(hashtext(?))", (rs, row) -> 0, "review:" + workspace.id());
        Long activeBytes = jdbc.queryForObject("""
                select coalesce(sum(storage_bytes), 0) from review.packages
                where workspace_id = ?::uuid and status in ('uploading', 'published') and expires_at > now()
                """, Long.class, workspace.id());
        if (activeBytes == null || activeBytes + valid.totalBytes() > workspace.reviewStorageBytes()) {
            throw new BusinessException("CREATION_REVIEW_STORAGE_EXHAUSTED", "workspace review storage is exhausted", HttpStatus.TOO_MANY_REQUESTS);
        }
        Integer duplicates = jdbc.queryForObject("select count(*) from review.packages where workspace_id = ?::uuid and desktop_package_id = ?", Integer.class, workspace.id(), request.desktopPackageId());
        if (duplicates != null && duplicates > 0) conflict("CREATION_REVIEW_PACKAGE_EXISTS", "review package already exists for this workspace");
        byte[] rawToken = new byte[32];
        RANDOM.nextBytes(rawToken);
        String shareToken = Base64.getUrlEncoder().withoutPadding().encodeToString(rawToken);
        byte[] pinHash = request.pin() == null || request.pin().isBlank() ? null : BCRYPT.encode(request.pin().trim()).getBytes(StandardCharsets.UTF_8);
        String packageId = UUID.randomUUID().toString();
        Instant expiresAt = Instant.now().plus(workspace.reviewRetentionDays(), ChronoUnit.DAYS);
        jdbc.update("""
                insert into review.packages(id, workspace_id, owner_user_id, desktop_package_id, title, token_hash, pin_hash, status, manifest, storage_bytes, expires_at)
                values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?, 'uploading', ?::jsonb, ?, ?::timestamptz)
                """, packageId, workspace.id(), userId, request.desktopPackageId().trim(), request.title().trim(), digest(rawToken), pinHash, valid.manifest(), valid.totalBytes(), expiresAt);
        for (MediaDeclaration media : valid.media()) {
            String mediaId = UUID.randomUUID().toString();
            String objectKey = "review/" + workspace.id() + "/" + packageId + "/" + mediaId;
            jdbc.update("""
                    insert into review.media_objects(id, package_id, client_media_id, object_key, relative_path, mime_type, size_bytes, sha256)
                    values (?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?)
                    """, mediaId, packageId, media.id().trim(), objectKey, media.relativePath().trim(), media.mimeType().trim().toLowerCase(), media.sizeBytes(), media.sha256().trim().toLowerCase());
        }
        PackageRow packageRow = requiredPackage(packageId);
        List<UploadTarget> targets = media(packageId).stream().map(this::uploadTarget).toList();
        return new Created(view(packageRow, media(packageId), false), shareToken, targets);
    }

    public UploadTarget refreshUploadTarget(String userId, String packageId, String clientMediaId) {
        PackageRow packageRow = packageForMember(userId, packageId);
        requireUploading(packageRow);
        MediaRow media = requiredMedia(packageId, clientMediaId);
        return uploadTarget(media);
    }

    @Transactional
    public PackageView complete(String userId, String packageId) {
        PackageRow packageRow = packageForMember(userId, packageId);
        if ("published".equals(packageRow.status())) return view(packageRow, media(packageId), false);
        requireUploading(packageRow);
        List<MediaRow> media = media(packageId);
        for (MediaRow item : media) store.verify(item.objectKey(), item.sizeBytes(), item.sha256());
        int updated = jdbc.update("""
                update review.packages set status = 'published', updated_at = now()
                where id = ?::uuid and status = 'uploading' and expires_at > now()
                """, packageId);
        if (updated != 1) conflict("CREATION_REVIEW_PACKAGE_CHANGED", "review package changed while completing");
        jdbc.update("update review.media_objects set upload_status = 'complete' where package_id = ?::uuid", packageId);
        return view(requiredPackage(packageId), media(packageId), false);
    }

    public PackageView publicPackage(String token, String pin) {
        PackageRow packageRow = publicPackageRow(token, pin);
        return view(packageRow, media(packageRow.id()), true);
    }

    @Transactional
    public Comment submitComment(String token, PublicCommentRequest request) {
        PackageRow packageRow = publicPackageRow(token, request.pin());
        validateComment(request);
        Comment existing = commentByClientId(packageRow.id(), request.clientId());
        if (existing != null) {
            if (existing.shotId().equals(empty(request.shotId())) && Double.compare(existing.timecodeSeconds(), request.timecodeSeconds()) == 0
                    && existing.authorAlias().equals(empty(request.authorAlias())) && existing.body().equals(request.body().trim())) return existing;
            conflict("CREATION_REVIEW_COMMENT_IDEMPOTENCY_CONFLICT", "review comment idempotency key conflicts");
        }
        long cursor = nextCursor(packageRow.id());
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into review.comments(id, package_id, client_id, shot_id, timecode_seconds, author_alias, body, cursor)
                values (?::uuid, ?::uuid, ?, nullif(?, ''), ?, nullif(?, ''), ?, ?)
                """, id, packageRow.id(), request.clientId().trim(), empty(request.shotId()), request.timecodeSeconds(), empty(request.authorAlias()), request.body().trim(), cursor);
        return requiredComment(packageRow.id(), request.clientId());
    }

    @Transactional
    public Decision submitDecision(String token, PublicDecisionRequest request) {
        PackageRow packageRow = publicPackageRow(token, request.pin());
        validateDecision(request);
        Decision existing = decisionByClientId(packageRow.id(), request.clientId());
        if (existing != null) {
            if (existing.shotId().equals(empty(request.shotId())) && existing.decision().equals(request.decision())
                    && existing.authorAlias().equals(empty(request.authorAlias())) && existing.note().equals(empty(request.note()))) return existing;
            conflict("CREATION_REVIEW_DECISION_IDEMPOTENCY_CONFLICT", "review decision idempotency key conflicts");
        }
        long cursor = nextCursor(packageRow.id());
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into review.decisions(id, package_id, client_id, shot_id, decision, author_alias, note, cursor)
                values (?::uuid, ?::uuid, ?, nullif(?, ''), ?, nullif(?, ''), nullif(?, ''), ?)
                """, id, packageRow.id(), request.clientId().trim(), empty(request.shotId()), request.decision(), empty(request.authorAlias()), empty(request.note()), cursor);
        return requiredDecision(packageRow.id(), request.clientId());
    }

    public Sync sync(String userId, String packageId, long afterCursor) {
        if (afterCursor < 0) invalid("invalid review sync cursor");
        PackageRow packageRow = packageForMember(userId, packageId);
        return new Sync(packageRow.syncCursor(), jdbc.query("""
                select id::text, package_id::text, client_id, coalesce(shot_id, ''), coalesce(timecode_seconds, 0)::float8,
                  coalesce(author_alias, ''), body, resolved, cursor, created_at, updated_at
                from review.comments where package_id = ?::uuid and cursor > ? order by cursor
                """, (rs, row) -> comment(rs), packageId, afterCursor), jdbc.query("""
                select id::text, package_id::text, client_id, coalesce(shot_id, ''), decision, coalesce(author_alias, ''),
                  coalesce(note, ''), cursor, created_at from review.decisions where package_id = ?::uuid and cursor > ? order by cursor
                """, (rs, row) -> decision(rs), packageId, afterCursor));
    }

    /** Deletion first revokes public access; an object-store error leaves a visible deleting state for the scheduled compensator. */
    @Transactional
    public Deleted delete(String userId, String packageId) {
        PackageRow packageRow = packageForMember(userId, packageId);
        if ("deleted".equals(packageRow.status())) return new Deleted(packageId, "deleted");
        jdbc.update("""
                update review.packages set status = 'deleting', revoked_at = coalesce(revoked_at, now()), updated_at = now()
                where id = ?::uuid and status <> 'deleted'
                """, packageId);
        for (MediaRow item : media(packageId)) store.delete(item.objectKey());
        redact(packageId);
        return new Deleted(packageId, "deleted");
    }

    @Transactional
    public int purgeExpired() {
        List<String> ids = jdbc.query("""
                select id::text from review.packages
                where expires_at <= now() and status in ('uploading', 'published', 'revoked', 'failed') order by expires_at limit 100
                """, (rs, row) -> rs.getString(1));
        int cleared = 0;
        for (String id : ids) {
            jdbc.update("update review.packages set status = 'deleting', revoked_at = coalesce(revoked_at, now()), updated_at = now() where id = ?::uuid", id);
            try {
                for (MediaRow item : media(id)) store.delete(item.objectKey());
                redact(id);
                cleared++;
            } catch (BusinessException ignored) {
                // Keep the deleting state. The next job run retries object-store compensation.
            }
        }
        return cleared;
    }

    private void redact(String packageId) {
        byte[] replacement = digest(UUID.randomUUID() + UUID.randomUUID().toString());
        jdbc.update("delete from review.media_objects where package_id = ?::uuid", packageId);
        jdbc.update("""
                update review.packages set status = 'deleted', title = 'deleted', manifest = '{}'::jsonb, pin_hash = null,
                  token_hash = ?, desktop_package_id = 'deleted:' || id::text, storage_bytes = 0, deleted_at = now(), updated_at = now()
                where id = ?::uuid
                """, replacement, packageId);
    }

    private WorkspaceClient.Workspace currentWorkspace(String workspaceId) {
        if (workspaceId == null || workspaceId.isBlank()) invalid("workspace is required");
        try {
            Result<WorkspaceClient.Workspace> result = workspaces.currentMembership(workspaceId);
            if (result == null || result.data() == null) throw new BusinessException("CREATION_WORKSPACE_UNAVAILABLE", "workspace membership lookup returned no result", HttpStatus.SERVICE_UNAVAILABLE);
            return result.data();
        } catch (FeignException.Forbidden exception) {
            throw new BusinessException("CREATION_WORKSPACE_ACCESS_DENIED", "workspace membership is required", HttpStatus.FORBIDDEN);
        } catch (FeignException exception) {
            throw new BusinessException("CREATION_WORKSPACE_UNAVAILABLE", "workspace membership lookup is unavailable", HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private PackageRow packageForMember(String userId, String packageId) {
        PackageRow packageRow = requiredPackage(packageId);
        currentWorkspace(packageRow.workspaceId());
        return packageRow;
    }

    private PackageRow publicPackageRow(String token, String pin) {
        byte[] rawToken;
        try { rawToken = Base64.getUrlDecoder().decode(token == null ? "" : token.trim()); }
        catch (IllegalArgumentException exception) { throw new BusinessException("CREATION_REVIEW_NOT_FOUND", "review package not found", HttpStatus.NOT_FOUND); }
        if (rawToken.length != 32) throw new BusinessException("CREATION_REVIEW_NOT_FOUND", "review package not found", HttpStatus.NOT_FOUND);
        List<PackageRow> rows = jdbc.query(packageSelect("where token_hash = ?"), (rs, row) -> packageRow(rs), digest(rawToken));
        if (rows.isEmpty() || !"published".equals(rows.getFirst().status()) || !rows.getFirst().expiresAt().isAfter(Instant.now())) {
            throw new BusinessException("CREATION_REVIEW_NOT_FOUND", "review package not found", HttpStatus.NOT_FOUND);
        }
        PackageRow packageRow = rows.getFirst();
        if (packageRow.pinHash() != null && packageRow.pinHash().length > 0 && !BCRYPT.matches(empty(pin), new String(packageRow.pinHash(), StandardCharsets.UTF_8))) {
            throw new BusinessException("CREATION_REVIEW_PIN_INVALID", "review PIN is invalid", HttpStatus.UNAUTHORIZED);
        }
        Integer attempts = jdbc.queryForObject("select count(*) from review.access_audit where package_id = ?::uuid and occurred_at > now() - interval '1 minute'", Integer.class, packageRow.id());
        if (attempts != null && attempts >= 120) throw new BusinessException("CREATION_REVIEW_RATE_LIMITED", "review access rate limit reached", HttpStatus.TOO_MANY_REQUESTS);
        jdbc.update("insert into review.access_audit(id, package_id, action, result) values (?::uuid, ?::uuid, 'public_access', 'allowed')", UUID.randomUUID().toString(), packageRow.id());
        return packageRow;
    }

    private ValidatedCreate validateCreate(CreateRequest request) {
        if (request == null || request.desktopPackageId() == null || !PACKAGE_ID.matcher(request.desktopPackageId().trim()).matches()
                || request.title() == null || request.title().trim().isEmpty() || request.title().trim().length() > 200) invalid("invalid review package");
        if (request.pin() != null && !request.pin().isBlank() && !PIN.matcher(request.pin().trim()).matches()) invalid("review PIN must be 4 to 12 digits");
        if (request.media() == null || request.media().isEmpty() || request.media().size() > MAX_MEDIA) invalid("invalid review media declaration");
        long total = 0;
        Map<String, MediaDeclaration> byPath = new java.util.HashMap<>();
        Map<String, MediaDeclaration> byId = new java.util.HashMap<>();
        for (MediaDeclaration media : request.media()) {
            if (media == null || media.id() == null || !CLIENT_ID.matcher(media.id().trim()).matches() || media.relativePath() == null || !safePath(media.relativePath().trim())
                    || media.mimeType() == null || !allowedMime(media.mimeType().trim().toLowerCase()) || media.sizeBytes() <= 0 || !validSha(media.sha256())) invalid("invalid review media declaration");
            if (media.sizeBytes() > MAX_PACKAGE_BYTES - total || byPath.put(media.relativePath().trim(), media) != null || byId.put(media.id().trim(), media) != null) invalid("duplicate or oversized review media declaration");
            total += media.sizeBytes();
        }
        if (total <= 0 || total > MAX_PACKAGE_BYTES) invalid("review package exceeds 512 MiB");
        try {
            JsonNode manifest = json.readTree(request.manifestJson());
            if (!manifest.isObject() || !"dramaip-review".equals(manifest.path("format").asText()) || manifest.path("version").asInt() != 1
                    || !request.desktopPackageId().trim().equals(manifest.path("packageId").asText()) || !request.title().trim().equals(manifest.path("title").asText())
                    || manifest.path("projectId").asText().isBlank() || manifest.path("adaptationProjectId").asText().isBlank() || manifest.path("episodeId").asText().isBlank()
                    || !manifest.path("media").isArray() || manifest.path("media").size() != request.media().size()) invalid("review manifest contract mismatch");
            for (JsonNode item : manifest.path("media")) {
                MediaDeclaration declared = byPath.get(item.path("relativePath").asText());
                if (declared == null || item.path("id").asText().isBlank() || item.path("shotId").asText().isBlank() || item.path("orderIndex").asInt(-1) < 0
                        || item.path("label").asText().length() > 200 || !declared.mimeType().trim().equalsIgnoreCase(item.path("mimeType").asText())
                        || !declared.sha256().trim().equalsIgnoreCase(item.path("sha256").asText()) || item.path("sizeBytes").asLong(-1) != declared.sizeBytes()) invalid("review manifest media mismatch");
            }
            return new ValidatedCreate(json.writeValueAsString(manifest), List.copyOf(request.media()), total);
        } catch (BusinessException exception) { throw exception; }
        catch (Exception exception) { invalid("invalid review manifest"); return null; }
    }

    private void validateWorkspace(WorkspaceClient.Workspace workspace) {
        if (!("studio".equals(workspace.planCode()) || "enterprise".equals(workspace.planCode()))) {
            throw new BusinessException("CREATION_REVIEW_ENTITLEMENT_REQUIRED", "cloud review entitlement is required", HttpStatus.FORBIDDEN);
        }
        if (workspace.reviewStorageBytes() <= 0 || workspace.reviewRetentionDays() <= 0 || workspace.reviewRetentionDays() > 30) {
            throw new BusinessException("CREATION_REVIEW_ENTITLEMENT_INVALID", "cloud review entitlement is not configured", HttpStatus.PRECONDITION_FAILED);
        }
    }

    private void validateComment(PublicCommentRequest request) {
        if (request == null || request.clientId() == null || !CLIENT_ID.matcher(request.clientId().trim()).matches() || request.timecodeSeconds() < 0
                || length(request.shotId()) > 128 || length(request.authorAlias()) > 80 || request.body() == null || request.body().trim().isEmpty() || request.body().trim().length() > 4000) invalid("invalid review comment");
    }

    private void validateDecision(PublicDecisionRequest request) {
        if (request == null || request.clientId() == null || !CLIENT_ID.matcher(request.clientId().trim()).matches() || length(request.shotId()) > 128
                || length(request.authorAlias()) > 80 || length(request.note()) > 4000 || !("approve".equals(request.decision()) || "return".equals(request.decision()) || "request_changes".equals(request.decision()) || "note".equals(request.decision()))) invalid("invalid review decision");
    }

    private PackageRow requiredPackage(String packageId) {
        List<PackageRow> rows = jdbc.query(packageSelect("where id = ?::uuid"), (rs, row) -> packageRow(rs), packageId);
        if (rows.isEmpty()) throw new BusinessException("CREATION_REVIEW_NOT_FOUND", "review package not found", HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }

    private MediaRow requiredMedia(String packageId, String clientMediaId) {
        List<MediaRow> rows = jdbc.query(mediaSelect("and client_media_id = ?"), (rs, row) -> mediaRow(rs), packageId, clientMediaId);
        if (rows.isEmpty()) throw new BusinessException("CREATION_REVIEW_MEDIA_NOT_FOUND", "review media not found", HttpStatus.NOT_FOUND);
        return rows.getFirst();
    }

    private List<MediaRow> media(String packageId) { return jdbc.query(mediaSelect(""), (rs, row) -> mediaRow(rs), packageId); }
    private String packageSelect(String where) { return "select id::text, workspace_id::text, owner_user_id::text, desktop_package_id, title, status, manifest::text, storage_bytes, sync_cursor, expires_at, created_at, pin_hash from review.packages " + where; }
    private String mediaSelect(String tail) { return "select id::text, client_media_id, object_key, relative_path, mime_type, size_bytes, sha256, upload_status from review.media_objects where package_id = ?::uuid " + tail + " order by relative_path"; }
    private static PackageRow packageRow(ResultSet rs) throws SQLException { return new PackageRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getLong(8), rs.getLong(9), instant(rs, 10), instant(rs, 11), rs.getBytes(12)); }
    private static MediaRow mediaRow(ResultSet rs) throws SQLException { return new MediaRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getLong(6), rs.getString(7), rs.getString(8)); }
    private static Comment comment(ResultSet rs) throws SQLException { return new Comment(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getDouble(5), rs.getString(6), rs.getString(7), rs.getBoolean(8), rs.getLong(9), instant(rs, 10), instant(rs, 11)); }
    private static Decision decision(ResultSet rs) throws SQLException { return new Decision(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getLong(8), instant(rs, 9)); }
    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException { var timestamp = rs.getTimestamp(index); return timestamp == null ? null : timestamp.toInstant(); }

    private Comment commentByClientId(String packageId, String clientId) { List<Comment> rows = jdbc.query("select id::text, package_id::text, client_id, coalesce(shot_id, ''), coalesce(timecode_seconds, 0)::float8, coalesce(author_alias, ''), body, resolved, cursor, created_at, updated_at from review.comments where package_id = ?::uuid and client_id = ?", (rs, row) -> comment(rs), packageId, clientId.trim()); return rows.isEmpty() ? null : rows.getFirst(); }
    private Comment requiredComment(String packageId, String clientId) { Comment value = commentByClientId(packageId, clientId); if (value == null) throw new IllegalStateException("review comment was not stored"); return value; }
    private Decision decisionByClientId(String packageId, String clientId) { List<Decision> rows = jdbc.query("select id::text, package_id::text, client_id, coalesce(shot_id, ''), decision, coalesce(author_alias, ''), coalesce(note, ''), cursor, created_at from review.decisions where package_id = ?::uuid and client_id = ?", (rs, row) -> decision(rs), packageId, clientId.trim()); return rows.isEmpty() ? null : rows.getFirst(); }
    private Decision requiredDecision(String packageId, String clientId) { Decision value = decisionByClientId(packageId, clientId); if (value == null) throw new IllegalStateException("review decision was not stored"); return value; }
    private long nextCursor(String packageId) { return jdbc.queryForObject("update review.packages set sync_cursor = sync_cursor + 1, updated_at = now() where id = ?::uuid returning sync_cursor", Long.class, packageId); }

    private PackageView view(PackageRow packageRow, List<MediaRow> media, boolean includeDownloads) {
        List<MediaView> items = new ArrayList<>();
        for (MediaRow item : media) {
            ReviewObjectStore.SignedUrl signed = includeDownloads ? store.presignGet(item.objectKey()) : null;
            items.add(new MediaView(item.clientMediaId(), item.relativePath(), item.mimeType(), item.sizeBytes(), item.sha256(), item.status(), signed == null ? null : signed.url().toString(), signed == null ? null : signed.expiresAt()));
        }
        return new PackageView(packageRow.id(), packageRow.workspaceId(), packageRow.desktopPackageId(), packageRow.title(), packageRow.status(), packageRow.manifest(), packageRow.storageBytes(), packageRow.syncCursor(), packageRow.expiresAt(), packageRow.createdAt(), items);
    }

    private UploadTarget uploadTarget(MediaRow media) {
        ReviewObjectStore.SignedUrl signed = store.presignPut(media.objectKey(), media.mimeType(), media.sha256());
        return new UploadTarget(media.clientMediaId(), "PUT", signed.url().toString(), signed.headers().entrySet().stream().map(entry -> new Header(entry.getKey(), entry.getValue())).toList(), signed.expiresAt());
    }

    private static void requireUploading(PackageRow packageRow) {
        if (!"uploading".equals(packageRow.status()) || !packageRow.expiresAt().isAfter(Instant.now())) throw new BusinessException("CREATION_REVIEW_UPLOAD_CLOSED", "review package is not accepting uploads", HttpStatus.PRECONDITION_FAILED);
    }
    private static boolean safePath(String value) { return !value.isBlank() && value.length() <= 240 && !value.startsWith("/") && !value.contains("\\") && !value.contains("\u0000") && !value.equals(".") && !value.equals("..") && !value.startsWith("../") && !value.contains("/../"); }
    private static boolean allowedMime(String value) { return "image/jpeg".equals(value) || "image/png".equals(value) || "image/webp".equals(value) || "video/mp4".equals(value) || "audio/mpeg".equals(value) || "audio/wav".equals(value) || "text/vtt".equals(value); }
    private static boolean validSha(String value) { return value != null && SHA256.matcher(value.trim().toLowerCase()).matches(); }
    private static int length(String value) { return value == null ? 0 : value.trim().length(); }
    private static String empty(String value) { return value == null ? "" : value.trim(); }
    private static byte[] digest(String value) { return digest(value.getBytes(StandardCharsets.UTF_8)); }
    private static byte[] digest(byte[] value) { try { return MessageDigest.getInstance("SHA-256").digest(value); } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); } }
    private static void invalid(String message) { throw new BusinessException("CREATION_INVALID_REVIEW_PACKAGE", message, HttpStatus.BAD_REQUEST); }
    private static void conflict(String code, String message) { throw new BusinessException(code, message, HttpStatus.CONFLICT); }

    private record ValidatedCreate(String manifest, List<MediaDeclaration> media, long totalBytes) { }
    private record PackageRow(String id, String workspaceId, String ownerUserId, String desktopPackageId, String title, String status, String manifest, long storageBytes, long syncCursor, Instant expiresAt, Instant createdAt, byte[] pinHash) { }
    private record MediaRow(String id, String clientMediaId, String objectKey, String relativePath, String mimeType, long sizeBytes, String sha256, String status) { }
    public record MediaDeclaration(String id, String relativePath, String mimeType, long sizeBytes, String sha256) { }
    public record CreateRequest(String workspaceId, String desktopPackageId, String title, String manifestJson, String pin, List<MediaDeclaration> media) { }
    public record Header(String name, String value) { }
    public record UploadTarget(String mediaId, String method, String url, List<Header> requiredHeaders, Instant expiresAt) { }
    public record MediaView(String id, String relativePath, String mimeType, long sizeBytes, String sha256, String status, String downloadUrl, Instant downloadUrlExpiresAt) { }
    public record PackageView(String id, String workspaceId, String desktopPackageId, String title, String status, String manifestJson, long storageBytes, long syncCursor, Instant expiresAt, Instant createdAt, List<MediaView> media) { }
    public record Created(@JsonProperty("package") PackageView packageView, String shareToken, List<UploadTarget> uploadTargets) { }
    public record PublicCommentRequest(String pin, String clientId, String shotId, double timecodeSeconds, String authorAlias, String body) { }
    public record Comment(String id, String packageId, String clientId, String shotId, double timecodeSeconds, String authorAlias, String body, boolean resolved, long cursor, Instant createdAt, Instant updatedAt) { }
    public record PublicDecisionRequest(String pin, String clientId, String shotId, String decision, String authorAlias, String note) { }
    public record Decision(String id, String packageId, String clientId, String shotId, String decision, String authorAlias, String note, long cursor, Instant createdAt) { }
    public record Sync(long nextCursor, List<Comment> comments, List<Decision> decisions) { }
    public record Deleted(String packageId, String status) { }
}
