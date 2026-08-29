package com.dramaip.platform.quota.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.quota.controller.QuotaRefundController;
import com.dramaip.platform.quota.controller.QuotaTccController;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

class QuotaServiceTest {
    @Test
    void readModelsBoundLimitsAndMissingBalanceIsExplicit() {
        FakeJdbcTemplate jdbc = new FakeJdbcTemplate();
        QuotaService service = new QuotaService(jdbc, mock(DramaipMetrics.class));

        assertNull(service.balance("user"));
        assertEquals(List.of(), service.usage("user", 0));
        assertEquals(1, jdbc.lastArguments[1]);
        assertEquals(List.of(), service.usage("user", 500));
        assertEquals(200, jdbc.lastArguments[1]);
        assertEquals(List.of(), service.usageTrend("user", 0));
        assertEquals(1, jdbc.lastArguments[1]);
        assertEquals(List.of(), service.usageTrend("user", 999));
        assertEquals(365, jdbc.lastArguments[1]);
    }

    @Test
    void reservationAndSettlementRejectInvalidTokenCounts() {
        QuotaService service = new QuotaService(new FakeJdbcTemplate(), mock(DramaipMetrics.class));

        assertEquals("QUOTA_INVALID_RESERVATION", assertThrows(
                BusinessException.class,
                () -> service.reserve("user", "", 1)
        ).code());
        assertEquals("QUOTA_INVALID_RESERVATION", assertThrows(
                BusinessException.class,
                () -> service.reserve("user", "request", 0)
        ).code());
        assertEquals("QUOTA_INVALID_USAGE", assertThrows(
                BusinessException.class,
                () -> service.settle("user", "reservation", "request", "model", -1, 0)
        ).code());
    }

    @Test
    void tccEmptyConfirmFailsAndEmptyRollbackInstallsFenceIdempotently() {
        FakeJdbcTemplate jdbc = new FakeJdbcTemplate();
        QuotaService service = new QuotaService(jdbc, mock(DramaipMetrics.class));
        Instant period = Instant.parse("2026-01-01T00:00:00Z");

        assertEquals("QUOTA_TCC_EMPTY_CONFIRM", assertThrows(
                BusinessException.class,
                () -> service.confirmProvision("subscription", period)
        ).code());
        service.cancelProvision("subscription", period);
        assertEquals(1, jdbc.updateCount);
        assertEquals("subscription:" + period, jdbc.lastArguments[0]);
    }

    @Test
    void internalQuotaParticipantsRejectMissingOrIncorrectCredentials() {
        QuotaService service = new QuotaService(new FakeJdbcTemplate(), mock(DramaipMetrics.class));

        assertEquals("INTERNAL_FORBIDDEN", assertThrows(
                BusinessException.class,
                () -> new QuotaTccController(service, "").confirm(
                        "anything", "subscription", new QuotaTccController.PeriodRequest(Instant.now()))
        ).code());
        assertEquals("INTERNAL_FORBIDDEN", assertThrows(
                BusinessException.class,
                () -> new QuotaRefundController(service, "secret").prepare(
                        "wrong", new QuotaRefundController.PrepareRequest("refund", "user", "subscription", "reason"))
        ).code());
    }

    private static final class FakeJdbcTemplate extends JdbcTemplate {
        private Object[] lastArguments = new Object[0];
        private int updateCount;

        @Override
        public int update(String sql, Object... args) {
            lastArguments = args;
            updateCount++;
            return 1;
        }

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
