package com.dramaip.platform.common.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Low-cardinality metric contract retained across the Go-to-Java migration. */
@Component
public final class DramaipMetrics {
    private final MeterRegistry registry;
    private final String service;

    public DramaipMetrics(MeterRegistry registry, @Value("${spring.application.name:unknown}") String service) {
        this.registry = registry;
        this.service = bounded(service, "unknown");
    }

    public Timer.Sample start() { return Timer.start(registry); }

    public void request(Timer.Sample sample, String operation, String outcome, String statusClass) {
        String safeOperation = bounded(operation, "unknown");
        String safeOutcome = bounded(outcome, "error");
        Counter.builder("dramaip.requests")
                .tags("service", service, "outcome", safeOutcome, "status_class", bounded(statusClass, "5xx"))
                .register(registry).increment();
        sample.stop(Timer.builder("dramaip.request.duration")
                .tags("service", service, "operation", safeOperation, "outcome", safeOutcome)
                .publishPercentileHistogram()
                .register(registry));
    }

    public void error(String category, String operation) {
        Counter.builder("dramaip.errors")
                .tags("service", service, "class", bounded(category, "internal"), "operation", bounded(operation, "unknown"))
                .register(registry).increment();
    }

    public void paymentConfirmation(String outcome) {
        paymentCounter(outcome).increment();
    }

    public void initializePaymentConfirmation() {
        paymentCounter("succeeded");
        paymentCounter("failed");
    }

    public void quotaReservation(String outcome) {
        quotaReservationCounter(outcome).increment();
    }

    public void initializeQuotaReservations() {
        quotaReservationCounter("accepted");
        quotaReservationCounter("rejected");
        quotaReservationCounter("replayed");
    }

    public Timer.Sample startProvider() { return Timer.start(registry); }

    public void provider(Timer.Sample sample, String provider, String outcome) {
        String safeProvider = bounded(provider, "unknown");
        String safeOutcome = bounded(outcome, "failed");
        providerCounter(safeProvider, safeOutcome).increment();
        sample.stop(providerTimer(safeProvider));
    }

    public void initializeProvider(String provider) {
        String safeProvider = bounded(provider, "unknown");
        providerCounter(safeProvider, "succeeded");
        providerCounter(safeProvider, "failed");
        providerTimer(safeProvider);
    }

    public String service() { return service; }

    private Counter paymentCounter(String outcome) {
        return Counter.builder("dramaip.business.events")
                .tags("service", service, "event", "payment_confirmation", "outcome", bounded(outcome, "failed"))
                .register(registry);
    }

    private Counter quotaReservationCounter(String outcome) {
        return Counter.builder("dramaip.quota.reservations")
                .tags("service", service, "outcome", bounded(outcome, "rejected"))
                .register(registry);
    }

    private Counter providerCounter(String provider, String outcome) {
        return Counter.builder("dramaip.provider.requests")
                .tags("service", service, "provider", provider, "outcome", outcome).register(registry);
    }

    private Timer providerTimer(String provider) {
        return Timer.builder("dramaip.provider.request.duration")
                .tags("service", service, "provider", provider).publishPercentileHistogram().register(registry);
    }

    private static String bounded(String value, String fallback) {
        if (value == null || !value.matches("[A-Za-z0-9_.:-]{1,96}")) return fallback;
        return value.toLowerCase(Locale.ROOT);
    }
}
