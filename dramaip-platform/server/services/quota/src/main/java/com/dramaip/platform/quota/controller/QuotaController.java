package com.dramaip.platform.quota.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.quota.service.QuotaService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/quota")
public class QuotaController {
    private final QuotaService quota;
    public QuotaController(QuotaService quota) { this.quota = quota; }

    @GetMapping("/balance")
    public Result<QuotaService.Balance> balance(Authentication authentication) {
        return Result.ok(quota.balance(CurrentUser.id(authentication)));
    }

    @GetMapping("/usage")
    public Result<List<QuotaService.Usage>> usage(Authentication authentication, @RequestParam(defaultValue = "50") int limit) {
        return Result.ok(quota.usage(CurrentUser.id(authentication), limit));
    }

    @GetMapping("/usage/trend")
    public Result<List<QuotaService.UsageTrendPoint>> usageTrend(Authentication authentication, @RequestParam(defaultValue = "30") int days) {
        return Result.ok(quota.usageTrend(CurrentUser.id(authentication), days));
    }

    @PostMapping("/reservations")
    public ResponseEntity<Result<QuotaService.Reservation>> reserve(Authentication authentication, @Valid @RequestBody ReserveRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(quota.reserve(CurrentUser.id(authentication), request.requestId(), request.reservedTokens())));
    }

    @PostMapping("/reservations/{reservationId}/settlements")
    public Result<QuotaService.Usage> settle(Authentication authentication, @PathVariable String reservationId, @Valid @RequestBody SettleRequest request) {
        return Result.ok(quota.settle(CurrentUser.id(authentication), reservationId, request.requestId(), request.model(), request.promptTokens(), request.completionTokens()));
    }

    @PostMapping("/reservations/{reservationId}/cancel")
    public Result<QuotaService.Reservation> cancel(Authentication authentication, @PathVariable String reservationId) {
        return Result.ok(quota.cancel(CurrentUser.id(authentication), reservationId));
    }

    public record ReserveRequest(@NotBlank String requestId, @Positive long reservedTokens) { }
    public record SettleRequest(@NotBlank String requestId, @NotBlank String model, long promptTokens, long completionTokens) { }
}
