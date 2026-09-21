package com.dramaip.platform.common.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.TraceCorrelation;
import com.fasterxml.jackson.databind.ObjectMapper;
import feign.RequestTemplate;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.ContextKey;
import io.opentelemetry.context.Scope;
import jakarta.validation.ConstraintViolationException;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.mock.web.MockHttpServletResponse;

class CommonWebContractTest {
    @AfterEach
    void clearRequestContext() {
        RequestContext.clear();
        MDC.clear();
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
    void correlationSnapshotPropagatesOnlySafeIdsAndRestoresWorkerContext() {
        String traceId = "abcdefabcdefabcdefabcdefabcdefab";
        ContextKey<String> telemetryKey = ContextKey.named("dramaip-test-context");
        AtomicReference<String> observedRequest = new AtomicReference<>();
        AtomicReference<String> observedTrace = new AtomicReference<>();
        AtomicReference<String> observedMdcRequest = new AtomicReference<>();
        AtomicReference<String> observedTelemetry = new AtomicReference<>();
        Runnable wrapped;

        RequestContext.set("request-captured", traceId);
        MDC.put("request_id", "request-captured");
        MDC.put("trace_id", traceId);
        MDC.put("unsafe", "must-not-propagate");
        try (Scope ignored = Context.current().with(telemetryKey, "captured").makeCurrent()) {
            wrapped = CorrelationContextSnapshot.capture().wrap(() -> {
                observedRequest.set(RequestContext.requestId());
                observedTrace.set(RequestContext.traceId());
                observedMdcRequest.set(MDC.get("request_id"));
                observedTelemetry.set(Context.current().get(telemetryKey));
                assertNull(MDC.get("unsafe"));
            });
        }

        RequestContext.set("worker-request", "0123456789abcdef0123456789abcdef");
        MDC.clear();
        MDC.put("request_id", "worker-request");
        MDC.put("unsafe", "worker-private-state");
        wrapped.run();

        assertEquals("request-captured", observedRequest.get());
        assertEquals(traceId, observedTrace.get());
        assertEquals("request-captured", observedMdcRequest.get());
        assertEquals("captured", observedTelemetry.get());
        assertEquals("worker-request", RequestContext.requestId());
        assertEquals("worker-request", MDC.get("request_id"));
        assertEquals("worker-private-state", MDC.get("unsafe"));
    }

    @Test
    void correlationSnapshotCrossesAVirtualThreadBoundary() throws Exception {
        String traceId = "fedcbafedcbafedcbafedcbafedcbafe";
        AtomicReference<String> observedRequest = new AtomicReference<>();
        AtomicReference<String> observedTrace = new AtomicReference<>();
        RequestContext.set("virtual-request", traceId);
        Runnable wrapped = CorrelationContextSnapshot.capture().wrap(() -> {
            observedRequest.set(RequestContext.requestId());
            observedTrace.set(RequestContext.traceId());
        });
        RequestContext.clear();
        MDC.clear();

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            executor.submit(wrapped).get();
        }

        assertEquals("virtual-request", observedRequest.get());
        assertEquals(traceId, observedTrace.get());
        assertEquals("", RequestContext.requestId());
    }

    @Test
    void correlationSnapshotRestoresContextAfterTaskFailure() {
        RequestContext.set("captured-request", "abcdefabcdefabcdefabcdefabcdefab");
        Runnable wrapped = CorrelationContextSnapshot.capture().wrap(() -> {
            throw new IllegalStateException("private failure detail");
        });
        RequestContext.set("worker-request", "fedcbafedcbafedcbafedcbafedcbafe");
        MDC.put("request_id", "worker-request");

        assertThrows(IllegalStateException.class, wrapped::run);

        assertEquals("worker-request", RequestContext.requestId());
        assertEquals("worker-request", MDC.get("request_id"));
    }

    @Test
    void exceptionHandlerMapsBusinessValidationAndUnexpectedFailures() {
        DramaipMetrics metrics = mock(DramaipMetrics.class);
        ApiExceptionHandler handler = new ApiExceptionHandler(metrics);
        BusinessException conflict = new BusinessException("IDENTITY_EMAIL_EXISTS", "email exists", HttpStatus.CONFLICT);

        var business = handler.business(conflict);
        var validation = handler.validation(new ConstraintViolationException(Set.of()));
        var missingHeader = handler.validation(new ServletRequestBindingException("missing required header"));
        var unexpected = handler.unexpected(new IllegalStateException("simulated failure"));

        assertEquals(HttpStatus.CONFLICT, business.getStatusCode());
        assertEquals("IDENTITY_EMAIL_EXISTS", business.getBody().code());
        assertEquals(HttpStatus.BAD_REQUEST, validation.getStatusCode());
        assertEquals("COMMON_VALIDATION_FAILED", validation.getBody().code());
        assertEquals(HttpStatus.BAD_REQUEST, missingHeader.getStatusCode());
        assertEquals("COMMON_VALIDATION_FAILED", missingHeader.getBody().code());
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, unexpected.getStatusCode());
        assertEquals("internal server error", unexpected.getBody().message());
        assertEquals("IDENTITY_EMAIL_EXISTS", conflict.code());
        assertEquals(HttpStatus.CONFLICT, conflict.status());
        verify(metrics).error("business", "mvc");
        verify(metrics, org.mockito.Mockito.times(2)).error("validation", "mvc");
        verify(metrics).error("internal", "mvc");
    }
}
