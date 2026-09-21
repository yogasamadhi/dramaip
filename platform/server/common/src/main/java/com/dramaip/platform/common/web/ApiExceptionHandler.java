package com.dramaip.platform.common.web;

import com.dramaip.platform.common.observability.DramaipMetrics;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private final DramaipMetrics metrics;

    public ApiExceptionHandler(DramaipMetrics metrics) { this.metrics = metrics; }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<Result<Void>> business(BusinessException exception) {
        metrics.error("business", "mvc");
        return ResponseEntity.status(exception.status()).body(Result.failure(exception.code(), exception.getMessage()));
    }

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            ConstraintViolationException.class,
            ServletRequestBindingException.class
    })
    public ResponseEntity<Result<Void>> validation(Exception exception) {
        metrics.error("validation", "mvc");
        return ResponseEntity.badRequest().body(Result.failure("COMMON_VALIDATION_FAILED", "request validation failed"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Result<Void>> notFound(NoResourceFoundException exception) {
        metrics.error("not_found", "mvc");
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Result.failure("COMMON_RESOURCE_NOT_FOUND", "resource not found"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> unexpected(Exception exception) {
        metrics.error("internal", "mvc");
        // Do not attach arbitrary exception messages or stack traces: dependency
        // exceptions can echo URLs, SQL values, credentials, or request content.
        LOG.atError().addKeyValue("operation", "mvc").addKeyValue("failure_class", "internal")
                .log("Unhandled API exception");
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Result.failure("COMMON_INTERNAL_ERROR", "internal server error"));
    }
}
