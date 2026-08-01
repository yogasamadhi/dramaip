package com.dramaip.platform.quota.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class QuotaMaintenanceJob {
    private final QuotaService quota;
    public QuotaMaintenanceJob(QuotaService quota) { this.quota = quota; }
    @Scheduled(fixedDelayString = "${dramaip.quota.reservation-reaper-ms:60000}")
    public void expireReservations() { quota.expireReservations(); }
}
