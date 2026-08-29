package com.dramaip.platform.quota.controller;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.quota.service.QuotaService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Lets durable server-side jobs charge their owner without persisting or impersonating a user's JWT. */
@RestController
@RequestMapping("/internal/v1/quota/usage")
public class QuotaInternalUsageController {
    private static final String TOKEN_HEADER = "X-DramaIP-Internal-Token";
    private final QuotaService quota;
    private final byte[] token;

    public QuotaInternalUsageController(QuotaService quota, @Value("${dramaip.internal.token:}") String token) {
        this.quota = quota;
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/reservations")
    public Result<QuotaService.Reservation> reserve(@RequestHeader(TOKEN_HEADER) String provided,
            @Valid @RequestBody ReserveRequest request) {
        authorize(provided);
        return Result.ok(quota.reserve(request.userId(), request.requestId(), request.reservedTokens()));
    }

    @PostMapping("/reservations/{reservationId}/settlements")
    public Result<QuotaService.Usage> settle(@RequestHeader(TOKEN_HEADER) String provided,
            @PathVariable String reservationId, @Valid @RequestBody SettleRequest request) {
        authorize(provided);
        return Result.ok(quota.settle(request.userId(), reservationId, request.requestId(), request.model(),
                request.promptTokens(), request.completionTokens()));
    }

    @PostMapping("/reservations/{reservationId}/cancel")
    public Result<QuotaService.Reservation> cancel(@RequestHeader(TOKEN_HEADER) String provided,
            @PathVariable String reservationId, @Valid @RequestBody CancelRequest request) {
        authorize(provided);
        return Result.ok(quota.cancel(request.userId(), reservationId));
    }

    private void authorize(String provided) {
        if (token.length == 0 || !MessageDigest.isEqual(token, provided.getBytes(StandardCharsets.UTF_8))) {
            throw new BusinessException("INTERNAL_FORBIDDEN", "internal caller is not authorized", HttpStatus.FORBIDDEN);
        }
    }

    public record ReserveRequest(@NotBlank String userId, @NotBlank String requestId, @Positive long reservedTokens) { }
    public record SettleRequest(@NotBlank String userId, @NotBlank String requestId, @NotBlank String model,
            long promptTokens, long completionTokens) { }
    public record CancelRequest(@NotBlank String userId) { }
}
