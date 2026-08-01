package com.dramaip.platform.gateway;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.BearerTokenAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.server.authentication.ServerBearerTokenAuthenticationConverter;
import org.springframework.security.web.server.authentication.ServerAuthenticationConverter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/** JWT signature validation is enabled when the deployment provides the shared JWKS URI. */
@Configuration
@EnableWebFluxSecurity
@ConditionalOnProperty(name = "dramaip.security.jwt.enabled", havingValue = "true")
class GatewaySecurityConfiguration {
    @Bean
    ReactiveJwtDecoder jwtDecoder(GatewayJwtProperties properties) {
        return NimbusReactiveJwtDecoder.withJwkSetUri(properties.jwkSetUri()).build();
    }

    @Bean
    SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http, ServerAuthenticationConverter browserBearerTokenConverter) {
        return http.csrf(ServerHttpSecurity.CsrfSpec::disable)
                .authorizeExchange(exchange -> exchange
                        .pathMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .pathMatchers("/actuator/**", "/api/v1/auth/**", "/api/v1/admin/auth/**", "/api/v1/payment-webhooks/**").permitAll()
                        .anyExchange().authenticated())
                .oauth2ResourceServer(resourceServer -> resourceServer.bearerTokenConverter(browserBearerTokenConverter).jwt(jwt -> { }))
                .build();
    }

    /** Accept the HttpOnly access Cookie at the browser edge; downstream sees a normal Bearer header. */
    @Bean
    ServerAuthenticationConverter browserBearerTokenConverter() {
        var authorizationHeader = new ServerBearerTokenAuthenticationConverter();
        return exchange -> authorizationHeader.convert(exchange).switchIfEmpty(cookieToken(exchange));
    }

    private Mono<Authentication> cookieToken(ServerWebExchange exchange) {
        if (isCredentialEndpoint(exchange)) return Mono.empty();
        var cookie = exchange.getRequest().getCookies().getFirst(BrowserSessionFilter.ACCESS_COOKIE);
        if (cookie == null || cookie.getValue().isBlank()) return Mono.empty();
        return Mono.just(new BearerTokenAuthenticationToken(cookie.getValue()));
    }

    private boolean isCredentialEndpoint(ServerWebExchange exchange) {
        String path = exchange.getRequest().getPath().value();
        return path.equals("/api/v1/auth/register") || path.equals("/api/v1/auth/token")
                || path.equals("/api/v1/auth/token/refresh") || path.equals("/api/v1/auth/token/revoke");
    }
}
