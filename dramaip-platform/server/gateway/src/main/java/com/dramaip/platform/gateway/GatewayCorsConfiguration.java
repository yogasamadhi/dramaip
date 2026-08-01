package com.dramaip.platform.gateway;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

@Configuration(proxyBeanMethods = false)
class GatewayCorsConfiguration {
    @Bean
    CorsConfigurationSource gatewayCorsConfigurationSource(GatewayCorsProperties properties) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(properties.allowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Device-Id",
                "X-DramaIP-Web-Session", "X-DramaIP-Contract-Version", "X-Request-Id", "X-Trace-Id"));
        configuration.setExposedHeaders(List.of("X-DramaIP-Contract-Version", "X-Request-Id", "X-Trace-Id"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    CorsWebFilter gatewayCorsWebFilter(CorsConfigurationSource gatewayCorsConfigurationSource) {
        return new CorsWebFilter(gatewayCorsConfigurationSource);
    }
}
