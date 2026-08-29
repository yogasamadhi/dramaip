package com.dramaip.platform.ai.client;

import com.dramaip.platform.common.web.Result;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

@FeignClient(name = "quota", path = "/internal/v1/quota/usage")
public interface QuotaClient {
    String TOKEN_HEADER = "X-DramaIP-Internal-Token";
    @PostMapping("/reservations") Result<Reservation> reserve(@RequestHeader(TOKEN_HEADER) String token, @RequestBody ReserveRequest request);
    @PostMapping("/reservations/{reservationId}/settlements") Result<Usage> settle(@RequestHeader(TOKEN_HEADER) String token, @PathVariable String reservationId, @RequestBody SettleRequest request);
    @PostMapping("/reservations/{reservationId}/cancel") Result<Reservation> cancel(@RequestHeader(TOKEN_HEADER) String token, @PathVariable String reservationId, @RequestBody CancelRequest request);
    record ReserveRequest(String userId, String requestId, long reservedTokens) { }
    record SettleRequest(String userId, String requestId, String model, long promptTokens, long completionTokens) { }
    record CancelRequest(String userId) { }
    record Reservation(String id, String accountId, String requestId, long reservedTokens, String status) { }
    record Usage(String id, String requestId, String model, long promptTokens, long completionTokens, long totalTokens, String status) { }
}
