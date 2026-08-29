package com.dramaip.platform.notification.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dramaip.platform.common.web.BusinessException;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

class NotificationServiceTest {
    @Test
    void listBoundsLimitsAndMarkReadEnforcesOwnership() {
        FakeJdbcTemplate jdbc = new FakeJdbcTemplate();
        NotificationService service = new NotificationService(jdbc);

        assertEquals(List.of(), service.list("user", 0));
        assertEquals(1, jdbc.lastArguments[1]);
        assertEquals(List.of(), service.list("user", 500));
        assertEquals(100, jdbc.lastArguments[1]);

        BusinessException missing = assertThrows(BusinessException.class, () -> service.markRead("other-user", "notification"));
        assertEquals("SUPPORT_NOTIFICATION_NOT_FOUND", missing.code());
    }

    @Test
    void deliveryAttemptStatusIsValidatedAndBounded() {
        FakeJdbcTemplate jdbc = new FakeJdbcTemplate();
        NotificationService service = new NotificationService(jdbc);

        assertEquals("SUPPORT_DELIVERY_STATUS_INVALID", assertThrows(
                BusinessException.class,
                () -> service.deliveryAttempts("queued", 20)
        ).code());
        assertEquals(List.of(), service.deliveryAttempts(" failed ", 500));
        assertEquals("failed", jdbc.lastArguments[0]);
        assertEquals(100, jdbc.lastArguments[2]);
    }

    private static final class FakeJdbcTemplate extends JdbcTemplate {
        private Object[] lastArguments = new Object[0];

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            lastArguments = args;
            return Collections.emptyList();
        }

        @Override
        public <T> T query(String sql, ResultSetExtractor<T> resultSetExtractor, Object... args) {
            lastArguments = args;
            return null;
        }
    }
}
