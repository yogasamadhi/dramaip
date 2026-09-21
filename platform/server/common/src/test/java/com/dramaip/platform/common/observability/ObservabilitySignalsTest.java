package com.dramaip.platform.common.observability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class ObservabilitySignalsTest {
    @Test
    void springSelectsTheConfiguredTelemetryConstructor() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.registerBean(DramaipTelemetry.class);
            context.refresh();

            assertNotNull(context.getBean(DramaipTelemetry.class));
        }
    }

    @Test
    void workflowMetricsKeepOnlyBoundedLowCardinalityTags() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        DramaipMetrics metrics = new DramaipMetrics(registry, "AI");

        metrics.workflow("inspiration_run", "succeeded");
        metrics.workflow("unsafe workflow value", "unexpected outcome");

        assertEquals(1, registry.get("dramaip.workflow.events")
                .tags("service", "ai", "workflow", "inspiration_run", "outcome", "succeeded")
                .counter().count());
        assertEquals(1, registry.get("dramaip.workflow.events")
                .tags("service", "ai", "workflow", "unknown", "outcome", "failed")
                .counter().count());
    }

    @Test
    void outboxSignalsCountSuccessAndFailureWithoutPayloadTags() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        DramaipMetrics metrics = new DramaipMetrics(registry, "billing");
        OutboxObservability outbox = new OutboxObservability(metrics, new DramaipTelemetry("test", "test"));

        outbox.stage("billing", "payment.succeeded.v1", () -> { });
        assertThrows(IllegalStateException.class,
                () -> outbox.stage("billing", "payment.succeeded.v1", () -> {
                    throw new IllegalStateException("private payload must not become telemetry");
                }));

        assertEquals(1, registry.get("dramaip.workflow.events")
                .tags("service", "billing", "workflow", "outbox_enqueue", "outcome", "succeeded")
                .counter().count());
        assertEquals(1, registry.get("dramaip.workflow.events")
                .tags("service", "billing", "workflow", "outbox_enqueue", "outcome", "failed")
                .counter().count());
        assertEquals(1, registry.get("dramaip.errors")
                .tags("service", "billing", "class", "persistence", "operation", "outbox_enqueue")
                .counter().count());
    }

    @Test
    void customSpanDimensionsRejectUnboundedValues() {
        assertEquals("production", DramaipTelemetry.bounded("Production", "unknown"));
        assertEquals("unknown", DramaipTelemetry.bounded("contains private material", "unknown"));
    }
}
