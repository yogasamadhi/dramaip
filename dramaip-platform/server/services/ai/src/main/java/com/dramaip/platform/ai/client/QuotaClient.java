package com.dramaip.platform.ai.client;

import com.dramaip.platform.common.web.Result;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@FeignClient(name = "quota", path = "/api/v1/quota")
public interface QuotaClient {
    @PostMapping("/reservations") Result<Reservation> reserve(@RequestBody ReserveRequest request);
    @PostMapping("/reservations/{reservationId}/settlements") Result<Usage> settle(@PathVariable String reservationId, @RequestBody SettleRequest request);
    @PostMapping("/reservations/{reservationId}/cancel") Result<Reservation> cancel(@PathVariable String reservationId);
    record ReserveRequest(String requestId, long reservedTokens) { }
    record SettleRequest(String requestId, String model, long promptTokens, long completionTokens) { }
    record Reservation(String id, String accountId, String requestId, long reservedTokens, String status) { }
    record Usage(String id, String requestId, String model, long promptTokens, long completionTokens, long totalTokens, String status) { }
}
