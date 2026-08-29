package com.dramaip.platform.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.dramaip.platform.common.observability.DramaipMetrics;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

class CorrelationAndContractFilterTest {
    private final CorrelationAndContractFilter filter = new CorrelationAndContractFilter(mock(DramaipMetrics.class));

    @Test
    void rejectsMissingContractBeforeAuthenticationFiltersCanRun() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/plans").build());
        var called = new AtomicBoolean();

        filter.filter(exchange, ignored -> {
            called.set(true);
            return exchange.getResponse().setComplete();
        }).block();

        assertFalse(called.get());
        assertEquals(HttpStatus.UPGRADE_REQUIRED, exchange.getResponse().getStatusCode());
        assertEquals("2", exchange.getResponse().getHeaders().getFirst(CorrelationAndContractFilter.CONTRACT_VERSION));
        assertEquals(Ordered.HIGHEST_PRECEDENCE, filter.getOrder());
    }

    @Test
    void allowsVersionTwoToContinueIntoAuthentication() {
        var request = MockServerHttpRequest.get("/api/v1/plans")
                .header(CorrelationAndContractFilter.CONTRACT_VERSION, "2")
                .build();
        var exchange = MockServerWebExchange.from(request);
        var called = new AtomicBoolean();

        filter.filter(exchange, ignored -> {
            called.set(true);
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }).block();

        assertTrue(called.get());
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
    }
}
