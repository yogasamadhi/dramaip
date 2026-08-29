package com.dramaip.platform.creation.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dramaip.platform.common.web.BusinessException;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class CreationBoundaryTest {
    @Test
    void draftsValidateKindsAndAlwaysScopeDeletionToTheOwner() {
        FakeJdbcTemplate jdbc = new FakeJdbcTemplate();
        DraftService service = new DraftService(jdbc);

        assertEquals(List.of(), service.list("user"));
        assertEquals("CREATION_INVALID_DRAFT", assertThrows(
                BusinessException.class,
                () -> service.upsert("user", new DraftService.CreateDraft("client", "unsupported", "text", "title", "content"))
        ).code());
        assertEquals("CREATION_INVALID_DRAFT", assertThrows(
                BusinessException.class,
                () -> service.upsert("user", new DraftService.CreateDraft("client", "project", "video", "title", "content"))
        ).code());
        assertEquals("CREATION_DRAFT_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.delete("other-user", "draft")
        ).code());
        assertEquals("draft", jdbc.lastArguments[0]);
        assertEquals("other-user", jdbc.lastArguments[1]);
    }

    @Test
    void encryptedSnapshotsRejectInvalidKeysSizesDigestsAndChunks() {
        ProjectSnapshotService service = new ProjectSnapshotService(new FakeJdbcTemplate());
        String digest = "a".repeat(64);

        assertEquals(List.of(), service.list("user"));
        assertEquals(0, service.purgeExpired());
        assertEquals("CREATION_INVALID_SNAPSHOT", assertThrows(
                BusinessException.class,
                () -> service.create("user", "short", new byte[] {1})
        ).code());
        assertEquals("CREATION_INVALID_SNAPSHOT", assertThrows(
                BusinessException.class,
                () -> service.create("user", "snapshot-key", new byte[0])
        ).code());
        assertEquals("CREATION_INVALID_SNAPSHOT", assertThrows(
                BusinessException.class,
                () -> service.startUpload("user", "snapshot-key", 1024, digest)
        ).code());
        assertEquals("CREATION_INVALID_SNAPSHOT", assertThrows(
                BusinessException.class,
                () -> service.startUpload("user", "snapshot-key", (65L << 20), digest)
        ).code());
        assertEquals("CREATION_INVALID_SNAPSHOT", assertThrows(
                BusinessException.class,
                () -> service.uploadChunk("user", "upload", 0, "invalid", new byte[] {1})
        ).code());
    }

    private static final class FakeJdbcTemplate extends JdbcTemplate {
        private Object[] lastArguments = new Object[0];

        @Override
        public int update(String sql, Object... args) {
            lastArguments = args;
            return 0;
        }

        @Override
        public int update(String sql) {
            lastArguments = new Object[0];
            return 0;
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            lastArguments = args;
            return Collections.emptyList();
        }
    }
}
