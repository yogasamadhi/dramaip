package com.dramaip.platform.billing.controller;

import com.dramaip.platform.billing.service.PlanService;
import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** This controller bean does not exist outside an explicitly active dev/test profile. */
@RestController
@Profile({"dev", "test"})
public class SimulatedPaymentController {
    private final PlanService plans;
    private final DramaipMetrics metrics;

    public SimulatedPaymentController(PlanService plans, DramaipMetrics metrics) {
        this.plans = plans;
        this.metrics = metrics;
    }

    @PostMapping("/api/v1/orders/{orderId}/simulated-confirm")
    public Result<PlanService.Payment> confirm(Authentication authentication, @PathVariable String orderId) {
        try {
            PlanService.Payment payment = plans.confirmSimulatedPayment(CurrentUser.id(authentication), orderId);
            metrics.paymentConfirmation("succeeded");
            return Result.ok(payment);
        } catch (RuntimeException exception) {
            metrics.paymentConfirmation("failed");
            throw exception;
        }
    }
}
