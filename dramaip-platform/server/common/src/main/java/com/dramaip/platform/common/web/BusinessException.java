package com.dramaip.platform.common.web;

import org.springframework.http.HttpStatusCode;

public class BusinessException extends RuntimeException {
    private final String code;
    private final HttpStatusCode status;

    public BusinessException(String code, String message, HttpStatusCode status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() { return code; }
    public HttpStatusCode status() { return status; }
}
