package com.dramaip.platform.common.web;

import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class InternalHealthController {
    private final String service;

    public InternalHealthController(@Value("${spring.application.name}") String service) { this.service = service; }

    @GetMapping("/internal/v1/health")
    public Result<Map<String, Object>> health() {
        return Result.ok(Map.of("service", service, "status", "UP", "checkedAt", Instant.now()));
    }
}
