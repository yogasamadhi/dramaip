package com.dramaip.platform.billing.controller;

import com.dramaip.platform.billing.service.PlanService;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillingController {
    private final PlanService plans;
    public BillingController(PlanService plans) { this.plans = plans; }
    @GetMapping("/api/v1/plans") public Result<List<PlanService.Plan>> listPlans() { return Result.ok(plans.listPlans()); }
    @PostMapping("/api/v1/orders") public ResponseEntity<Result<PlanService.Order>> createOrder(Authentication authentication, @Valid @RequestBody CreateOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(plans.createOrder(CurrentUser.id(authentication), new PlanService.CreateOrder(request.planCode(), request.provider()))));
    }
    @GetMapping("/api/v1/orders") public Result<List<PlanService.Order>> orders(Authentication authentication) { return Result.ok(plans.orders(CurrentUser.id(authentication))); }
    @GetMapping("/api/v1/orders/{orderId}") public Result<PlanService.Order> order(Authentication authentication, @PathVariable String orderId) { return Result.ok(plans.order(orderId, CurrentUser.id(authentication))); }
    @PostMapping("/api/v1/payments/simulated/confirm") public Result<PlanService.Payment> confirmSimulated(Authentication authentication, @Valid @RequestBody ConfirmPaymentRequest request) { return Result.ok(plans.confirmSimulatedPayment(CurrentUser.id(authentication), request.orderId())); }
    @GetMapping("/api/v1/subscriptions/current") public Result<PlanService.Subscription> subscription(Authentication authentication) { return Result.ok(plans.currentSubscription(CurrentUser.id(authentication))); }
    @PostMapping("/api/v1/subscriptions/current/cancel") public Result<PlanService.Subscription> cancel(Authentication authentication, @RequestBody(required = false) CancelRequest request) { return Result.ok(plans.cancelSubscription(CurrentUser.id(authentication), request != null && request.immediate())); }
    @PostMapping("/api/v1/subscriptions/current/resume") public Result<PlanService.Subscription> resume(Authentication authentication) { return Result.ok(plans.resumeSubscription(CurrentUser.id(authentication))); }
    @PostMapping("/api/v1/subscriptions/current/plan") public Result<PlanService.Subscription> changePlan(Authentication authentication, @RequestHeader(value = "Idempotency-Key", required = false) String key, @Valid @RequestBody ChangePlanRequest request) { return Result.ok(plans.schedulePlanChange(CurrentUser.id(authentication), request.planCode(), key)); }
    @PostMapping("/api/v1/refunds") public ResponseEntity<Result<PlanService.Refund>> refund(Authentication authentication, @RequestHeader(value = "Idempotency-Key", required = false) String key, @Valid @RequestBody RefundRequest request) { return ResponseEntity.status(HttpStatus.ACCEPTED).body(Result.ok(plans.requestRefund(CurrentUser.id(authentication), request.reason(), key))); }
    @GetMapping("/api/v1/reconciliation") public Result<List<PlanService.Reconciliation>> reconciliation(Authentication authentication, @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int limit) { return Result.ok(plans.reconciliation(CurrentUser.id(authentication), limit)); }
    public record CreateOrderRequest(@NotBlank String planCode, @NotBlank String provider) { }
    public record ConfirmPaymentRequest(@NotBlank String orderId) { }
    public record CancelRequest(boolean immediate) { }
    public record ChangePlanRequest(@NotBlank String planCode) { }
    public record RefundRequest(@NotBlank String reason) { }
}
