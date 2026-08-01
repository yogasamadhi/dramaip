package com.dramaip.platform.gateway;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.security.jwt")
public record GatewayJwtProperties(String jwkSetUri) { }
