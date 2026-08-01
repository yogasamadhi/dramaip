package com.dramaip.platform.billing.client;

import com.dramaip.platform.common.web.Result;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

/** Billing owns its quota refund DTO instead of sharing a cross-service contract jar. */
@FeignClient(contextId = "quotaRefund", name = "quota", path = "/internal/v1/quota/refunds")
public interface QuotaRefundClient {
    @PostMapping("/prepare")
    Result<RefundPreparation> prepare(@RequestHeader("X-DramaIP-Internal-Token") String token, @RequestBody PrepareRequest request);

    record PrepareRequest(String refundId, String userId, String subscriptionId, String reason) { }
    record RefundPreparation(String refundId, String tokenAccountId, String status, long usedTokens, String reason) { }
}
