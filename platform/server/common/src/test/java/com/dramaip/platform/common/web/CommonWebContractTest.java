package com.dramaip.platform.common.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.TraceCorrelation;
import com.fasterxml.jackson.databind.ObjectMapper;
import feign.RequestTemplate;
import jakarta.validation.ConstraintViolationException;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class CommonWebContractTest {
    @AfterEach
    void clearRequestContext() {
        RequestContext.clear();
    }

    @Test
    void resultCarriesRequestAndTraceCorrelationWithoutSensitiveDetails() {
        RequestContext.set("request-123", "abcdefabcdefabcdefabcdefabcdefab");

        Result<String> success = Result.ok("value");
        Result<Void> failure = Result.failure("DOMAIN_FAILURE", "safe message");

        assertEquals("request-123", success.requestId());
        assertEquals("abcdefabcdefabcdefabcdefabcdefab", success.traceId());
        assertEquals("value", success.data());
        assertNull(failure.data());
        assertEquals("DOMAIN_FAILURE", failure.code());
        RequestContext.clear();
        assertEquals("", RequestContext.requestId());
        assertEquals("", RequestContext.traceId());
    }

    @Test
    void traceCorrelationAcceptsValidInputsAndRejectsAllZeroIds() {
        String traceId = "0123456789abcdef0123456789abcdef";
        assertEquals(traceId, TraceCorrelation.resolve("00-" + traceId + "-0123456789abcdef-01", null));
        assertEquals(traceId, TraceCorrelation.resolve(null, traceId.toUpperCase()));

        String generated = TraceCorrelation.resolve("invalid", "00000000000000000000000000000000");
        assertEquals(32, generated.length());
        assertNotEquals("00000000000000000000000000000000", generated);
    }

    @Test
    void contractFilterRejectsMissingVersionAndAllowsSelectedVersion() throws Exception {
        ContractVersionFilter filter = new ContractVersionFilter(new ObjectMapper());
        MockHttpServletRequest missing = new MockHttpServletRequest("GET", "/api/v1/plans");
        MockHttpServletResponse rejected = new MockHttpServletResponse();
        MockFilterChain rejectedChain = new MockFilterChain();

        filter.doFilter(missing, rejected, rejectedChain);

        assertEquals(426, rejected.getStatus());
        assertEquals("2", rejected.getHeader(ContractVersionFilter.HEADER));
        assertTrue(rejected.getContentAsString().contains("COMMON_CONTRACT_VERSION_UNSUPPORTED"));
        assertFalse(rejectedChain.getRequest() != null);

        MockHttpServletRequest selected = new MockHttpServletRequest("GET", "/api/v1/plans");
        selected.addHeader(ContractVersionFilter.HEADER, "2");
        MockHttpServletResponse allowed = new MockHttpServletResponse();
        MockFilterChain allowedChain = new MockFilterChain();
        filter.doFilter(selected, allowed, allowedChain);
        assertEquals(selected, allowedChain.getRequest());
    }

    @Test
    void feignCallsSelectContractVersionTwo() {
        RequestTemplate template = new RequestTemplate();
        RequestContext.set("request-123", "abcdefabcdefabcdefabcdefabcdefab");

        new FeignCorrelationInterceptor().apply(template);

        assertEquals(Set.of("2"), Set.copyOf(template.headers().get(ContractVersionFilter.HEADER)));
        assertEquals(Set.of("request-123"), Set.copyOf(template.headers().get(RequestIdFilter.REQUEST_ID)));
    }

    @Test
    void exceptionHandlerMapsBusinessValidationAndUnexpectedFailures() {
        DramaipMetrics metrics = mock(DramaipMetrics.class);
        ApiExceptionHandler handler = new ApiExceptionHandler(metrics);
        BusinessException conflict = new BusinessException("IDENTITY_EMAIL_EXISTS", "email exists", HttpStatus.CONFLICT);

        var business = handler.business(conflict);
        var validation = handler.validation(new ConstraintViolationException(Set.of()));
        var unexpected = handler.unexpected(new IllegalStateException("simulated failure"));

        assertEquals(HttpStatus.CONFLICT, business.getStatusCode());
        assertEquals("IDENTITY_EMAIL_EXISTS", business.getBody().code());
        assertEquals(HttpStatus.BAD_REQUEST, validation.getStatusCode());
        assertEquals("COMMON_VALIDATION_FAILED", validation.getBody().code());
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, unexpected.getStatusCode());
        assertEquals("internal server error", unexpected.getBody().message());
        assertEquals("IDENTITY_EMAIL_EXISTS", conflict.code());
        assertEquals(HttpStatus.CONFLICT, conflict.status());
        verify(metrics).error("business", "mvc");
        verify(metrics).error("validation", "mvc");
        verify(metrics).error("internal", "mvc");
    }
}
