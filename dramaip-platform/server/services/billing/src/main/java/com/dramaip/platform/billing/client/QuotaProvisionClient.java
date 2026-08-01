package com.dramaip.platform.billing.client;

import com.dramaip.platform.common.web.Result;
import java.time.Instant;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

/** Billing owns this client and its DTOs; quota never leaks a shared Java contract module. */
@FeignClient(contextId = "quotaProvision", name = "quota", path = "/internal/v1/quota/tcc/provisions")
public interface QuotaProvisionClient {
    @PostMapping("/try") Result<Provision> tryProvision(@RequestHeader("X-DramaIP-Internal-Token") String token, @RequestBody ProvisionRequest request);
    @PostMapping("/{subscriptionId}/confirm") Result<Provision> confirm(@RequestHeader("X-DramaIP-Internal-Token") String token, @PathVariable String subscriptionId, @RequestBody PeriodRequest request);
    @PostMapping("/{subscriptionId}/cancel") Result<Void> cancel(@RequestHeader("X-DramaIP-Internal-Token") String token, @PathVariable String subscriptionId, @RequestBody PeriodRequest request);
    record ProvisionRequest(String userId, String subscriptionId, String planCode, String planName, String billingPeriod, long planAmountMinor, String currency, long quotaTokens, int maxRpm, long maxContextTokens, String modelLevel, Instant periodStart, Instant periodEnd) { }
    record PeriodRequest(Instant periodStart) { }
    record Provision(String accountId, String status, long quotaTokens, Instant periodStart, Instant periodEnd) { }
}
