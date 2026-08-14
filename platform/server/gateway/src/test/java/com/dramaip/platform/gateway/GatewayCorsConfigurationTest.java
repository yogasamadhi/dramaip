package com.dramaip.platform.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.CorsConfigurationSource;

class GatewayCorsConfigurationTest {
    @Test
    void allowsWebDevelopmentOriginAndLoginHeaders() {
        CorsConfigurationSource source = new GatewayCorsConfiguration().gatewayCorsConfigurationSource(
                new GatewayCorsProperties(List.of("http://localhost:3009", "http://localhost:3010")));
        MockServerHttpRequest request = MockServerHttpRequest.options("/api/v1/auth/token")
                .header(HttpHeaders.ORIGIN, "http://localhost:3009")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, HttpMethod.POST.name())
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type,x-csrf-token,x-device-id,x-dramaip-web-session,x-dramaip-contract-version")
                .build();

        CorsConfiguration cors = source.getCorsConfiguration(MockServerWebExchange.from(request));

        assertThat(cors).isNotNull();
        assertThat(cors.checkOrigin("http://localhost:3009")).isEqualTo("http://localhost:3009");
        assertThat(cors.checkHttpMethod(HttpMethod.POST)).contains(HttpMethod.POST);
        assertThat(cors.checkHeaders(List.of("content-type", "x-csrf-token", "x-device-id", "x-dramaip-web-session", "x-dramaip-contract-version")))
                .containsExactly("content-type", "x-csrf-token", "x-device-id", "x-dramaip-web-session", "x-dramaip-contract-version");
        assertThat(cors.getAllowCredentials()).isTrue();
        assertThat(request.getHeaders().getOrigin()).isEqualTo("http://localhost:3009");
        assertThat(request.getHeaders().getAccessControlRequestMethod()).isEqualTo(HttpMethod.POST);
        assertThat(request.getHeaders().getAccessControlRequestHeaders())
                .containsExactly("content-type", "x-csrf-token", "x-device-id", "x-dramaip-web-session", "x-dramaip-contract-version");

        WebTestClient.bindToWebHandler(exchange -> exchange.getResponse().setComplete())
                .webFilter(new CorsWebFilter(source)).build()
                .options().uri("http://localhost:8080/api/v1/auth/token")
                .header(HttpHeaders.ORIGIN, "http://localhost:3009")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, HttpMethod.POST.name())
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type,x-csrf-token,x-device-id,x-dramaip-web-session,x-dramaip-contract-version")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3009")
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true");

        WebTestClient.bindToWebHandler(exchange -> exchange.getResponse().setComplete())
                .webFilter(new CorsWebFilter(source)).build()
                .post().uri("http://localhost:8080/api/v1/auth/token")
                .header(HttpHeaders.ORIGIN, "http://localhost:3009")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3009");
    }
}
