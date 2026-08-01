package com.dramaip.platform.quota.controller;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.quota.service.QuotaService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Internal-only HTTP façade for the quota TCC participant. It accepts no user-controlled public route. */
@RestController
@RequestMapping("/internal/v1/quota/tcc/provisions")
public class QuotaTccController {
    private final QuotaService quota;
    private final byte[] token;
    public QuotaTccController(QuotaService quota, @Value("${dramaip.internal.token:}") String token) { this.quota = quota; this.token = token.getBytes(StandardCharsets.UTF_8); }

    @PostMapping("/try") public Result<QuotaService.Provision> tryProvision(@RequestHeader("X-DramaIP-Internal-Token") String provided, @Valid @RequestBody ProvisionRequest request) {
        authorize(provided); return Result.ok(quota.tryProvision(new QuotaService.ProvisionRequest(request.userId(), request.subscriptionId(), request.planCode(), request.planName(), request.billingPeriod(), request.planAmountMinor(), request.currency(), request.quotaTokens(), request.maxRpm(), request.maxContextTokens(), request.modelLevel(), request.periodStart(), request.periodEnd())));
    }
    @PostMapping("/{subscriptionId}/confirm") public Result<QuotaService.Provision> confirm(@RequestHeader("X-DramaIP-Internal-Token") String provided, @PathVariable String subscriptionId, @RequestBody PeriodRequest request) { authorize(provided); return Result.ok(quota.confirmProvision(subscriptionId, request.periodStart())); }
    @PostMapping("/{subscriptionId}/cancel") public Result<Void> cancel(@RequestHeader("X-DramaIP-Internal-Token") String provided, @PathVariable String subscriptionId, @RequestBody PeriodRequest request) { authorize(provided); quota.cancelProvision(subscriptionId, request.periodStart()); return Result.ok(null); }
    private void authorize(String provided) { if (token.length == 0 || !MessageDigest.isEqual(token, provided.getBytes(StandardCharsets.UTF_8))) throw new BusinessException("INTERNAL_FORBIDDEN", "internal caller is not authorized", HttpStatus.FORBIDDEN); }
    public record ProvisionRequest(@NotBlank String userId, @NotBlank String subscriptionId, @NotBlank String planCode, @NotBlank String planName, @NotBlank String billingPeriod, long planAmountMinor, @NotBlank String currency, long quotaTokens, int maxRpm, long maxContextTokens, @NotBlank String modelLevel, Instant periodStart, Instant periodEnd) { }
    public record PeriodRequest(Instant periodStart) { }
}
