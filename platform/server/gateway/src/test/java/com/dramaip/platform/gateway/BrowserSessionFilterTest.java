package com.dramaip.platform.gateway;

import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpCookie;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BrowserSessionFilterTest {
    private final BrowserSessionFilter filter = new BrowserSessionFilter();

    @Test
    void allowsLoginWhenTheBrowserOnlyHasStaleSessionCookies() {
        var request = MockServerHttpRequest.post("/api/v1/auth/token")
                .cookie(new HttpCookie(BrowserSessionFilter.ACCESS_COOKIE, "stale-access"))
                .cookie(new HttpCookie("dramaip_web_refresh", "stale-refresh"))
                .build();
        var exchange = MockServerWebExchange.from(request);
        var called = new AtomicBoolean();

        filter.filter(exchange, successfulChain(called)).block();

        assertTrue(called.get());
    }

    @Test
    void stillRejectsOtherUnsafeRequestsWithoutCsrfProof() {
        var request = MockServerHttpRequest.post("/api/v1/users/me/profile")
                .cookie(new HttpCookie(BrowserSessionFilter.ACCESS_COOKIE, "stale-access"))
                .build();
        var exchange = MockServerWebExchange.from(request);
        var called = new AtomicBoolean();

        filter.filter(exchange, successfulChain(called)).block();

        assertFalse(called.get());
        assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
    }

    private GatewayFilterChain successfulChain(AtomicBoolean called) {
        return exchange -> {
            called.set(true);
            exchange.getResponse().setStatusCode(HttpStatus.NO_CONTENT);
            return exchange.getResponse().setComplete();
        };
    }
}
