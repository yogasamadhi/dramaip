package com.dramaip.platform.common.observability;

import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Adds a safe signal when a transaction stages an outbox event without exposing its payload or identifiers. */
@Component
public final class OutboxObservability {
    private static final Logger LOG = LoggerFactory.getLogger(OutboxObservability.class);
    private final DramaipMetrics metrics;
    private final DramaipTelemetry telemetry;

    public OutboxObservability(DramaipMetrics metrics, DramaipTelemetry telemetry) {
        this.metrics = metrics;
        this.telemetry = telemetry;
    }

    public void stage(String owner, String eventType, Runnable writer) {
        String safeOwner = bounded(owner, "unknown");
        String safeEventType = bounded(eventType, "unknown");
        try (DramaipTelemetry.Operation operation = telemetry.start(safeOwner + ".outbox.enqueue")) {
            try {
                writer.run();
                operation.succeeded();
                metrics.workflow("outbox_enqueue", "succeeded");
                LOG.atInfo().addKeyValue("operation", "outbox_enqueue").addKeyValue("outcome", "succeeded")
                        .addKeyValue("owner", safeOwner).addKeyValue("event_type", safeEventType)
                        .log("Outbox event staged");
            } catch (RuntimeException exception) {
                operation.failed("persistence");
                metrics.workflow("outbox_enqueue", "failed");
                metrics.error("persistence", "outbox_enqueue");
                LOG.atWarn().addKeyValue("operation", "outbox_enqueue").addKeyValue("outcome", "failed")
                        .addKeyValue("owner", safeOwner).addKeyValue("event_type", safeEventType)
                        .addKeyValue("failure_class", "persistence").log("Outbox event staging failed");
                throw exception;
            }
        }
    }

    private static String bounded(String value, String fallback) {
        if (value == null || !value.matches("[A-Za-z0-9_.:-]{1,96}")) return fallback;
        return value.toLowerCase(Locale.ROOT);
    }
}
