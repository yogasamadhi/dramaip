package com.dramaip.platform.common.web;

/** The only public JSON response envelope exposed by contract version 2. */
public record Result<T>(String code, String message, T data, String requestId, String traceId) {
    public static <T> Result<T> ok(T data) {
        return new Result<>("OK", "OK", data, RequestContext.requestId(), RequestContext.traceId());
    }

    public static <T> Result<T> failure(String code, String message) {
        return new Result<>(code, message, null, RequestContext.requestId(), RequestContext.traceId());
    }
}
