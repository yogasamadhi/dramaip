package com.dramaip.platform.quota.observability;

import com.dramaip.platform.common.observability.DramaipMetrics;
import org.springframework.stereotype.Component;

/** Publishes the finite quota-outcome series even before the first reservation. */
@Component
public final class QuotaMetricRegistration {
    public QuotaMetricRegistration(DramaipMetrics metrics) {
        metrics.initializeQuotaReservations();
    }
}
