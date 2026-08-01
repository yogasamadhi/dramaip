package com.dramaip.platform.common.web;

/** Stable, domain-prefixed error code contract. */
public interface ErrorCode {
    String code();
    String message();
}
