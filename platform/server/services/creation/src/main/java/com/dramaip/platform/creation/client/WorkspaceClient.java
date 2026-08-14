package com.dramaip.platform.creation.client;

import com.dramaip.platform.common.web.Result;
import java.time.Instant;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/** Creation owns this read model; identity only exposes the caller's own membership. */
@FeignClient(name = "identity", path = "/internal/v1/workspaces")
public interface WorkspaceClient {
    @GetMapping("/{workspaceId}/me")
    Result<Workspace> currentMembership(@PathVariable String workspaceId);

    record Workspace(String id, String name, String planCode, String currentUserRole,
                     int includedSeats, long reviewStorageBytes, int reviewRetentionDays, Instant createdAt) { }
}
