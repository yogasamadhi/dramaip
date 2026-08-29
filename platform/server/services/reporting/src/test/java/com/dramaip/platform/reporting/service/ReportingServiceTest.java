package com.dramaip.platform.reporting.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class ReportingServiceTest {
    @Test
    void userReportUsesAnEmptySummaryAndBoundsRequestedRows() {
        EmptyJdbcTemplate jdbc = new EmptyJdbcTemplate();
        ReportingService service = new ReportingService(jdbc);

        ReportingService.UserReport report = service.reportFor("user", 500);

        assertEquals(0, report.usage().totalTokens());
        assertNull(report.usage().firstSeenAt());
        assertEquals(List.of(), report.orders());
        assertEquals(List.of(), report.subscriptions());
        assertEquals(100, jdbc.lastArguments[1]);
    }

    @Test
    void adminPaginationSanitizesLimitsCursorsAndQueries() {
        EmptyJdbcTemplate jdbc = new EmptyJdbcTemplate();
        ReportingService service = new ReportingService(jdbc);

        assertEquals("", service.adminUsers(0, "not-a-number", " query ").nextCursor());
        assertEquals(51, jdbc.lastArguments[3]);
        assertEquals(0, jdbc.lastArguments[4]);
        assertEquals("", service.adminOrders(101, "-2", null).nextCursor());
        assertEquals(0, jdbc.lastArguments[5]);
        assertEquals("", service.adminSubscriptions(10, "100001", "").nextCursor());
        assertEquals(100000, jdbc.lastArguments[5]);
        assertEquals("", service.adminExceptions(2, false, "5", " event ").nextCursor());
        assertEquals(5, jdbc.lastArguments[6]);
    }

    private static final class EmptyJdbcTemplate extends JdbcTemplate {
        private Object[] lastArguments = new Object[0];

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            lastArguments = args;
            return Collections.emptyList();
        }
    }
}
