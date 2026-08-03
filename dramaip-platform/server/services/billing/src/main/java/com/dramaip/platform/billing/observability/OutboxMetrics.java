package com.dramaip.platform.billing.observability;

import com.dramaip.platform.common.observability.DramaipMetrics;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Current unpublished outbox work; it is queried at scrape time so the value survives restarts. */
@Component
public final class OutboxMetrics {
    public OutboxMetrics(JdbcTemplate jdbc, MeterRegistry registry, DramaipMetrics metrics) {
        metrics.initializePaymentConfirmation();
        Gauge.builder("dramaip.outbox.pending.events", jdbc, this::pending)
                .tags("service", "billing").register(registry);
    }

    private double pending(JdbcTemplate jdbc) {
        try {
            Long value = jdbc.queryForObject("select count(*) from billing.outbox_events where published_at is null", Long.class);
            return value == null ? 0 : value;
        } catch (RuntimeException ignored) {
            return 0;
        }
    }
}
