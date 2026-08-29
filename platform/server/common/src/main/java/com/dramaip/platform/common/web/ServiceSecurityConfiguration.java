package com.dramaip.platform.common.web;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/** Each service independently verifies JWTs when the production security switch is enabled. */
@Configuration
public class ServiceSecurityConfiguration {
    @Bean
    @ConditionalOnProperty(name = "dramaip.security.jwt.enabled", havingValue = "true")
    SecurityFilterChain jwtFilterChain(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.ignoringRequestMatchers("/api/v1/auth/**", "/api/v1/admin/auth/**", "/api/v1/payment-webhooks/**", "/api/v1/review-packages/public/**", "/internal/v1/quota/**"))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/**", "/.well-known/jwks.json", "/api/v1/auth/**", "/api/v1/admin/auth/**", "/api/v1/payment-webhooks/**", "/api/v1/review-packages/public/**", "/api/v1/creative-corpus/snapshots/latest", "/internal/v1/health", "/internal/v1/quota/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(resourceServer -> resourceServer.jwt(jwt -> { }))
                .build();
    }

    @Bean
    @ConditionalOnProperty(name = "dramaip.security.jwt.enabled", havingValue = "false", matchIfMissing = true)
    SecurityFilterChain lockedDownFilterChain(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/**", "/.well-known/jwks.json", "/api/v1/auth/**", "/api/v1/admin/auth/**", "/api/v1/payment-webhooks/**", "/api/v1/review-packages/public/**", "/api/v1/creative-corpus/snapshots/latest", "/internal/v1/health", "/internal/v1/quota/**").permitAll()
                        .anyRequest().denyAll())
                .build();
    }
}
