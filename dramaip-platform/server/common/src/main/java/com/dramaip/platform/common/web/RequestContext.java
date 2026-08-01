package com.dramaip.platform.common.web;

/** Request-scoped correlation values. They are cleared by {@link RequestIdFilter}. */
public final class RequestContext {
    private static final ThreadLocal<Ids> IDS = new ThreadLocal<>();

    private RequestContext() { }

    public static String requestId() { return IDS.get() == null ? "" : IDS.get().requestId(); }
    public static String traceId() { return IDS.get() == null ? "" : IDS.get().traceId(); }
    static void set(String requestId, String traceId) { IDS.set(new Ids(requestId, traceId)); }
    static void clear() { IDS.remove(); }

    private record Ids(String requestId, String traceId) { }
}
