package com.dramaip.platform.gateway;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.cors")
public record GatewayCorsProperties(List<String> allowedOrigins) {
    public GatewayCorsProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : allowedOrigins.stream()
                .map(String::trim).filter(origin -> !origin.isEmpty()).distinct().toList();
        if (allowedOrigins.isEmpty()) throw new IllegalArgumentException("dramaip.cors.allowed-origins must not be empty");
    }

    @Override
    public List<String> allowedOrigins() {
        return List.copyOf(allowedOrigins);
    }
}
