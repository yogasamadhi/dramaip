package com.dramaip.platform.ai.client;

import com.dramaip.platform.common.web.Result;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@FeignClient(name = "identity", path = "/api/v1/admin/confirmations")
public interface AdminConfirmationClient {
    @PostMapping("/{confirmationId}/consume")
    Result<ConsumedConfirmation> consume(@PathVariable String confirmationId, @RequestBody ConsumeRequest request);
    record ConsumeRequest(String action, String targetId) { }
    record ConsumedConfirmation(String id, String action, String targetId, String reason) { }
}
