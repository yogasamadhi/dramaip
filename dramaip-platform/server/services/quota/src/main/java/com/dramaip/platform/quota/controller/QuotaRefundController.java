package com.dramaip.platform.quota.controller;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.quota.service.QuotaService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Internal-only refund hold participant. It never accepts a browser credential. */
@RestController
@RequestMapping("/internal/v1/quota/refunds")
public class QuotaRefundController {
    private final QuotaService quota;
    private final byte[] token;

    public QuotaRefundController(QuotaService quota, @Value("${dramaip.internal.token:}") String token) {
        this.quota = quota;
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/prepare")
    public Result<QuotaService.RefundPreparation> prepare(@RequestHeader("X-DramaIP-Internal-Token") String provided, @Valid @RequestBody PrepareRequest request) {
        if (token.length == 0 || !MessageDigest.isEqual(token, provided.getBytes(StandardCharsets.UTF_8))) {
            throw new BusinessException("INTERNAL_FORBIDDEN", "internal caller is not authorized", HttpStatus.FORBIDDEN);
        }
        return Result.ok(quota.prepareRefund(request.refundId(), request.userId(), request.subscriptionId(), request.reason()));
    }

    public record PrepareRequest(@NotBlank String refundId, @NotBlank String userId, @NotBlank String subscriptionId, @NotBlank String reason) { }
}
