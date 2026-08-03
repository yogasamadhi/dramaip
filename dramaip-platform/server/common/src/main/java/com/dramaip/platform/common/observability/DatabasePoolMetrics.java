package com.dramaip.platform.common.observability;

import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Component;

/** Exposes stable aliases for the Hikari pool values used by the reliability dashboard. */
@Component
@ConditionalOnBean(DataSource.class)
public final class DatabasePoolMetrics {
    public DatabasePoolMetrics(DataSource dataSource, MeterRegistry registry,
            @Value("${spring.application.name:unknown}") String service) {
        if (!(dataSource instanceof HikariDataSource hikari)) return;
        Gauge.builder("dramaip.db.connections", hikari, value -> active(value))
                .tags("service", service, "state", "in_use").register(registry);
        Gauge.builder("dramaip.db.connections", hikari, value -> idle(value))
                .tags("service", service, "state", "idle").register(registry);
        Gauge.builder("dramaip.db.max.open.connections", hikari, value -> maximum(value))
                .tags("service", service).register(registry);
        Gauge.builder("dramaip.db.wait.count", hikari, value -> waiting(value))
                .tags("service", service).register(registry);
    }

    private static double active(HikariDataSource value) { return mx(value, 0); }
    private static double idle(HikariDataSource value) { return mx(value, 1); }
    private static double waiting(HikariDataSource value) { return mx(value, 2); }
    private static double maximum(HikariDataSource value) { return value.getMaximumPoolSize(); }

    private static double mx(HikariDataSource value, int kind) {
        var bean = value.getHikariPoolMXBean();
        if (bean == null) return 0;
        return switch (kind) {
            case 0 -> bean.getActiveConnections();
            case 1 -> bean.getIdleConnections();
            default -> bean.getThreadsAwaitingConnection();
        };
    }
}
