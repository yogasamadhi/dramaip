package com.dramaip.platform.quota.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.quota.service.QuotaService;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class QuotaInternalUsageControllerTest {
    @Test
    void chargesTheExplicitOwnerOnlyForAnAuthorizedInternalCaller() {
        QuotaService quota = mock(QuotaService.class);
        QuotaInternalUsageController controller = new QuotaInternalUsageController(quota, "internal-token");
        var reservation = new QuotaService.Reservation("reservation", "account", "request", 100, "reserved", Instant.now());
        when(quota.reserve("user", "request", 100)).thenReturn(reservation);

        var result = controller.reserve("internal-token",
                new QuotaInternalUsageController.ReserveRequest("user", "request", 100));

        assertEquals(reservation, result.data());
        verify(quota).reserve("user", "request", 100);
        assertEquals("INTERNAL_FORBIDDEN", assertThrows(BusinessException.class,
                () -> controller.reserve("wrong",
                        new QuotaInternalUsageController.ReserveRequest("user", "request", 100))).code());
    }
}
