package com.dramaip.platform.ai.observability;

import com.dramaip.platform.common.observability.DramaipMetrics;
import io.micrometer.core.instrument.FunctionCounter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Durable aggregate used for the cost-alert counter; a restart does not reset the alert history. */
@Component
public final class ProviderCostAlertMetrics {
    public ProviderCostAlertMetrics(JdbcTemplate jdbc, MeterRegistry registry, DramaipMetrics metrics) {
        metrics.initializeProvider("openai-compatible");
        FunctionCounter.builder("dramaip.provider.cost.alerts", jdbc, this::highRequestCostCount)
                .tags("service", "ai", "event", "high_request_cost").register(registry);
    }

    private double highRequestCostCount(JdbcTemplate jdbc) {
        try {
            Long value = jdbc.queryForObject("select count(*) from ai_gateway.provider_cost_alerts where event_type = 'high_request_cost'", Long.class);
            return value == null ? 0 : value;
        } catch (RuntimeException ignored) {
            return 0;
        }
    }
}
