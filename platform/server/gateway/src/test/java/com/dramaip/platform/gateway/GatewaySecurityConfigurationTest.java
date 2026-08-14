package com.dramaip.platform.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.config.EnableWebFlux;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@SpringJUnitConfig(GatewaySecurityConfigurationTest.TestApplication.class)
@TestPropertySource(properties = {
        "dramaip.security.jwt.enabled=true",
        "dramaip.security.jwt.jwk-set-uri=http://localhost:9999/.well-known/jwks.json",
        "dramaip.cors.allowed-origins=http://localhost:3010"
})
class GatewaySecurityConfigurationTest {
    private final WebTestClient client;

    @Autowired
    GatewaySecurityConfigurationTest(ApplicationContext context) {
        client = WebTestClient.bindToApplicationContext(context).build();
    }

    @Test
    void adminLoginPostDoesNotRequireAuthentication() {
        client.post().uri("/api/v1/admin/auth/login")
                .exchange()
                .expectStatus().isNoContent();
    }

    @RestController
    @RequestMapping("/api/v1/admin")
    static class LoginController {
        @PostMapping("/auth/login")
        @ResponseStatus(HttpStatus.NO_CONTENT)
        void login() { }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableWebFlux
    @EnableConfigurationProperties({GatewayJwtProperties.class, GatewayCorsProperties.class})
    @Import({GatewaySecurityConfiguration.class, GatewayCorsConfiguration.class, LoginController.class})
    static class TestApplication { }
}
