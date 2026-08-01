package com.dramaip.platform.common.events;

import java.time.Instant;

/** Matches the legacy protobuf-JSON event envelope's common wire fields. */
public record EventEnvelope<T>(
        String eventId,
        String eventType,
        int schemaVersion,
        String aggregateType,
        String aggregateId,
        Instant occurredAt,
        String traceId,
        T payload) { }
