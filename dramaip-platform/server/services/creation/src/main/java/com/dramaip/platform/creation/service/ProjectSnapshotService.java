package com.dramaip.platform.creation.service;

import com.dramaip.platform.common.web.BusinessException;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owns opaque client-encrypted snapshot envelopes; it never interprets plaintext. */
@Service
public class ProjectSnapshotService {
    private static final int MAX_INLINE_BYTES = 8 << 20;
    private static final int MAX_BYTES = 64 << 20;
    private static final int CHUNK_BYTES = 1 << 20;
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private final JdbcTemplate jdbc;

    public ProjectSnapshotService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public Snapshot create(String userId, String idempotencyKey, byte[] encryptedEnvelope) {
        validateKey(idempotencyKey);
        if (encryptedEnvelope == null || encryptedEnvelope.length == 0 || encryptedEnvelope.length > MAX_INLINE_BYTES) {
            invalid("invalid project snapshot envelope");
        }
        purgeExpired(userId);
        var digest = sha256(encryptedEnvelope);
        var existing = snapshotByKey(userId, idempotencyKey);
        if (existing != null) {
            if (!existing.encryptedSha256().equals(digest) || existing.encryptedBytes() != encryptedEnvelope.length) {
                conflict("CREATION_SNAPSHOT_IDEMPOTENCY_CONFLICT", "idempotency key names a different snapshot");
            }
            return existing;
        }
        var active = jdbc.queryForObject("""
                select count(*) from snapshot.project_snapshots where user_id = ?::uuid
                  and deleted_at is null and purged_at is null and expires_at > now()
                """, Long.class, userId);
        if (active != null && active >= 10) {
            throw new BusinessException("CREATION_SNAPSHOT_LIMIT_REACHED", "project snapshot limit reached", HttpStatus.TOO_MANY_REQUESTS);
        }
        return jdbc.query("""
                insert into snapshot.project_snapshots
                  (id, user_id, idempotency_key, encrypted_envelope, encrypted_bytes, encrypted_sha256, expires_at)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, now() + interval '30 days')
                returning id::text, encrypted_bytes, encrypted_sha256, created_at, expires_at
                """, rs -> { rs.next(); return snapshot(rs); }, UUID.randomUUID().toString(), userId, idempotencyKey,
                encryptedEnvelope, encryptedEnvelope.length, digest);
    }

    public List<Snapshot> list(String userId) {
        purgeExpired(userId);
        return jdbc.query("""
                select id::text, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshots where user_id = ?::uuid and deleted_at is null and purged_at is null
                  and expires_at > now() order by created_at desc, id desc
                """, (rs, row) -> snapshot(rs), userId);
    }

    public DownloadedSnapshot get(String userId, String snapshotId) {
        purgeExpired(userId);
        var rows = jdbc.query("""
                select id::text, encrypted_envelope, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshots where user_id = ?::uuid and id = ?::uuid and deleted_at is null
                  and purged_at is null and expires_at > now()
                """, (rs, row) -> new DownloadedSnapshot(new Snapshot(rs.getString(1), rs.getLong(3), rs.getString(4),
                        rs.getObject(5, Instant.class), rs.getObject(6, Instant.class)), rs.getBytes(2)), userId, snapshotId);
        if (rows.isEmpty()) notFound("CREATION_SNAPSHOT_NOT_FOUND", "project snapshot not found");
        return rows.getFirst();
    }

    @Transactional
    public DeletedSnapshot delete(String userId, String snapshotId) {
        var rows = jdbc.query("""
                update snapshot.project_snapshots set encrypted_envelope = null, deleted_at = now()
                where user_id = ?::uuid and id = ?::uuid and deleted_at is null and purged_at is null
                returning id::text, deleted_at
                """, (rs, row) -> new DeletedSnapshot(rs.getString(1), rs.getObject(2, Instant.class)), userId, snapshotId);
        if (rows.isEmpty()) notFound("CREATION_SNAPSHOT_NOT_FOUND", "project snapshot not found");
        return rows.getFirst();
    }

    @Transactional
    public UploadStart startUpload(String userId, String idempotencyKey, long encryptedBytes, String encryptedSha256) {
        validateKey(idempotencyKey);
        validateUpload(encryptedBytes, encryptedSha256);
        purgeExpired(userId);
        var completed = snapshotByKey(userId, idempotencyKey);
        if (completed != null) {
            if (completed.encryptedBytes() != encryptedBytes || !completed.encryptedSha256().equals(encryptedSha256)) {
                conflict("CREATION_SNAPSHOT_IDEMPOTENCY_CONFLICT", "idempotency key names a different snapshot");
            }
            return new UploadStart(completed, null);
        }
        var existing = uploadByKey(userId, idempotencyKey);
        if (existing != null) {
            if (existing.encryptedBytes() != encryptedBytes || !existing.encryptedSha256().equals(encryptedSha256)) {
                conflict("CREATION_SNAPSHOT_IDEMPOTENCY_CONFLICT", "idempotency key names a different upload");
            }
            return new UploadStart(null, existing);
        }
        var active = jdbc.queryForObject("select count(*) from snapshot.project_snapshot_uploads where user_id = ?::uuid and expires_at > now()", Long.class, userId);
        if (active != null && active >= 2) {
            throw new BusinessException("CREATION_UPLOAD_LIMIT_REACHED", "project snapshot upload limit reached", HttpStatus.TOO_MANY_REQUESTS);
        }
        var id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into snapshot.project_snapshot_uploads(id, user_id, idempotency_key, encrypted_bytes, encrypted_sha256, expires_at)
                values (?::uuid, ?::uuid, ?, ?, ?, now() + interval '24 hours')
                """, id, userId, idempotencyKey, encryptedBytes, encryptedSha256);
        return new UploadStart(null, requiredUpload(userId, id));
    }

    @Transactional
    public Upload uploadChunk(String userId, String uploadId, int chunkIndex, String encryptedChunkSha256, byte[] encryptedChunk) {
        if (encryptedChunk == null || encryptedChunk.length == 0 || encryptedChunk.length > CHUNK_BYTES || !validSha(encryptedChunkSha256)) {
            invalid("invalid project snapshot upload chunk");
        }
        var upload = requiredUploadForUpdate(userId, uploadId);
        var expectedChunks = chunksFor(upload.encryptedBytes());
        if (chunkIndex < 0 || chunkIndex >= expectedChunks || encryptedChunk.length != expectedChunkBytes(upload.encryptedBytes(), chunkIndex)) {
            invalid("project snapshot upload chunk has unexpected size");
        }
        if (!sha256(encryptedChunk).equals(encryptedChunkSha256)) invalid("project snapshot upload chunk checksum mismatch");
        var current = jdbc.query("""
                select encrypted_chunk_sha256 from snapshot.project_snapshot_upload_chunks
                where upload_id = ?::uuid and chunk_index = ?
                """, (rs, row) -> rs.getString(1), uploadId, chunkIndex);
        if (!current.isEmpty()) {
            if (!current.getFirst().equals(encryptedChunkSha256)) conflict("CREATION_UPLOAD_CHUNK_CONFLICT", "chunk already uploaded with a different checksum");
            return requiredUpload(userId, uploadId);
        }
        jdbc.update("""
                insert into snapshot.project_snapshot_upload_chunks(upload_id, chunk_index, encrypted_chunk, encrypted_chunk_sha256)
                values (?::uuid, ?, ?, ?)
                """, uploadId, chunkIndex, encryptedChunk, encryptedChunkSha256);
        return requiredUpload(userId, uploadId);
    }

    @Transactional
    public Snapshot completeUpload(String userId, String uploadId) {
        var upload = requiredUploadForUpdate(userId, uploadId);
        var chunks = jdbc.query("""
                select chunk_index, encrypted_chunk, encrypted_chunk_sha256
                from snapshot.project_snapshot_upload_chunks where upload_id = ?::uuid order by chunk_index
                """, (rs, row) -> new Chunk(rs.getInt(1), rs.getBytes(2), rs.getString(3)), uploadId);
        if (chunks.size() != chunksFor(upload.encryptedBytes())) incomplete();
        var joined = new ByteArrayOutputStream((int) upload.encryptedBytes());
        for (var index = 0; index < chunks.size(); index++) {
            var chunk = chunks.get(index);
            if (chunk.index() != index || chunk.bytes().length != expectedChunkBytes(upload.encryptedBytes(), index)
                    || !sha256(chunk.bytes()).equals(chunk.sha256())) incomplete();
            joined.writeBytes(chunk.bytes());
        }
        var envelope = joined.toByteArray();
        if (!sha256(envelope).equals(upload.encryptedSha256())) incomplete();
        var snapshot = createFromUpload(userId, upload, envelope);
        jdbc.update("delete from snapshot.project_snapshot_uploads where id = ?::uuid", uploadId);
        return snapshot;
    }

    @Transactional
    public int purgeExpired() {
        var snapshots = jdbc.update("""
                update snapshot.project_snapshots set encrypted_envelope = null, purged_at = now()
                where encrypted_envelope is not null and expires_at <= now()
                """);
        jdbc.update("delete from snapshot.project_snapshot_uploads where expires_at <= now()");
        return snapshots;
    }

    private Snapshot createFromUpload(String userId, Upload upload, byte[] envelope) {
        var existing = snapshotByKey(userId, upload.idempotencyKey());
        if (existing != null) return existing;
        var active = jdbc.queryForObject("""
                select count(*) from snapshot.project_snapshots where user_id = ?::uuid and deleted_at is null
                  and purged_at is null and expires_at > now()
                """, Long.class, userId);
        if (active != null && active >= 10) throw new BusinessException("CREATION_SNAPSHOT_LIMIT_REACHED", "project snapshot limit reached", HttpStatus.TOO_MANY_REQUESTS);
        return jdbc.query("""
                insert into snapshot.project_snapshots
                  (id, user_id, idempotency_key, encrypted_envelope, encrypted_bytes, encrypted_sha256, expires_at)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, now() + interval '30 days')
                returning id::text, encrypted_bytes, encrypted_sha256, created_at, expires_at
                """, rs -> { rs.next(); return snapshot(rs); }, UUID.randomUUID().toString(), userId, upload.idempotencyKey(), envelope,
                upload.encryptedBytes(), upload.encryptedSha256());
    }

    private void purgeExpired(String userId) {
        jdbc.update("""
                update snapshot.project_snapshots set encrypted_envelope = null, purged_at = now()
                where user_id = ?::uuid and encrypted_envelope is not null and expires_at <= now()
                """, userId);
        jdbc.update("delete from snapshot.project_snapshot_uploads where user_id = ?::uuid and expires_at <= now()", userId);
    }

    private Upload requiredUploadForUpdate(String userId, String uploadId) {
        var upload = jdbc.query("""
                select id::text, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshot_uploads where user_id = ?::uuid and id = ?::uuid and expires_at > now() for update
                """, (rs, row) -> upload(rs, userId), userId, uploadId);
        if (upload.isEmpty()) notFound("CREATION_UPLOAD_NOT_FOUND", "project snapshot upload not found");
        return upload.getFirst();
    }

    private Upload requiredUpload(String userId, String uploadId) {
        var upload = jdbc.query("""
                select id::text, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshot_uploads where user_id = ?::uuid and id = ?::uuid and expires_at > now()
                """, (rs, row) -> upload(rs, userId), userId, uploadId);
        if (upload.isEmpty()) notFound("CREATION_UPLOAD_NOT_FOUND", "project snapshot upload not found");
        return upload.getFirst();
    }

    private Upload uploadByKey(String userId, String idempotencyKey) {
        var rows = jdbc.query("""
                select id::text, idempotency_key, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshot_uploads where user_id = ?::uuid and idempotency_key = ? and expires_at > now()
                """, (rs, row) -> upload(rs, userId), userId, idempotencyKey);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Snapshot snapshotByKey(String userId, String idempotencyKey) {
        var rows = jdbc.query("""
                select id::text, encrypted_bytes, encrypted_sha256, created_at, expires_at
                from snapshot.project_snapshots where user_id = ?::uuid and idempotency_key = ? and deleted_at is null
                  and purged_at is null and expires_at > now()
                """, (rs, row) -> snapshot(rs), userId, idempotencyKey);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Upload upload(ResultSet rs, String userId) throws SQLException {
        var id = rs.getString(1);
        var indexes = jdbc.query("select chunk_index from snapshot.project_snapshot_upload_chunks where upload_id = ?::uuid order by chunk_index",
                (chunkRs, row) -> chunkRs.getInt(1), id);
        return new Upload(id, rs.getString(2), rs.getLong(3), rs.getString(4), rs.getObject(5, Instant.class), rs.getObject(6, Instant.class), indexes);
    }

    private static Snapshot snapshot(ResultSet rs) throws SQLException {
        return new Snapshot(rs.getString(1), rs.getLong(2), rs.getString(3), rs.getObject(4, Instant.class), rs.getObject(5, Instant.class));
    }
    private static int chunksFor(long bytes) { return Math.toIntExact((bytes + CHUNK_BYTES - 1) / CHUNK_BYTES); }
    private static int expectedChunkBytes(long bytes, int index) { return (int) Math.min(CHUNK_BYTES, bytes - (long) index * CHUNK_BYTES); }
    private static String sha256(byte[] value) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private static boolean validSha(String value) { return value != null && SHA256.matcher(value).matches(); }
    private static void validateKey(String key) { if (key == null || !IDEMPOTENCY_KEY.matcher(key).matches()) invalid("invalid project snapshot idempotency key"); }
    private static void validateUpload(long bytes, String digest) { if (bytes <= MAX_INLINE_BYTES || bytes > MAX_BYTES || !validSha(digest)) invalid("invalid project snapshot upload"); }
    private static void invalid(String message) { throw new BusinessException("CREATION_INVALID_SNAPSHOT", message, HttpStatus.BAD_REQUEST); }
    private static void incomplete() { throw new BusinessException("CREATION_UPLOAD_INCOMPLETE", "project snapshot upload is incomplete", HttpStatus.PRECONDITION_FAILED); }
    private static void notFound(String code, String message) { throw new BusinessException(code, message, HttpStatus.NOT_FOUND); }
    private static void conflict(String code, String message) { throw new BusinessException(code, message, HttpStatus.CONFLICT); }

    private record Chunk(int index, byte[] bytes, String sha256) { }
    public record Snapshot(String id, long encryptedBytes, String encryptedSha256, Instant createdAt, Instant expiresAt) { }
    public record DownloadedSnapshot(Snapshot snapshot, byte[] encryptedEnvelope) { }
    public record DeletedSnapshot(String snapshotId, Instant deletedAt) { }
    public record Upload(String id, String idempotencyKey, long encryptedBytes, String encryptedSha256, Instant createdAt, Instant expiresAt, List<Integer> receivedChunkIndexes) { }
    public record UploadStart(Snapshot snapshot, Upload upload) { }
}
