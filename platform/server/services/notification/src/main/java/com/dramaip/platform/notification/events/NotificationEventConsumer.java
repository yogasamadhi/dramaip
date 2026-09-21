package com.dramaip.platform.notification.events;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.DramaipTelemetry;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Manual ACK happens only after the durable inbox makes duplicate delivery harmless. */
@Component
public class NotificationEventConsumer {
    private static final Logger LOG = LoggerFactory.getLogger(NotificationEventConsumer.class);
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;
    private final DramaipMetrics metrics;
    private final DramaipTelemetry telemetry;

    public NotificationEventConsumer(ObjectMapper json, JdbcTemplate jdbc,
            DramaipMetrics metrics, DramaipTelemetry telemetry) {
        this.json = json;
        this.jdbc = jdbc;
        this.metrics = metrics;
        this.telemetry = telemetry;
    }

    @RabbitListener(queues = "${dramaip.events.notification-queue:dramaip.notification.java}", ackMode = "MANUAL", autoStartup = "${dramaip.consumer.enabled:false}")
    public void consume(Message message, Channel channel) throws Exception {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        try (DramaipTelemetry.Operation operation = telemetry.start("notification.consume")) {
            try {
                String outcome = process(json.readTree(message.getBody()));
                channel.basicAck(deliveryTag, false);
                operation.succeeded();
                metrics.workflow("notification_consume", outcome);
                LOG.atInfo().addKeyValue("operation", "notification_consume")
                        .addKeyValue("outcome", outcome).log("Notification event consumed");
            } catch (Exception exception) {
                String failure = failureCategory(exception);
                operation.failed(failure);
                metrics.workflow("notification_consume", "failed");
                metrics.error(failure, "notification_consume");
                LOG.atWarn().addKeyValue("operation", "notification_consume")
                        .addKeyValue("outcome", "failed").addKeyValue("failure_class", failure)
                        .log("Notification event consumption failed");
                // Queue/DLQ policy owns finite retry; a poison event is never requeued forever.
                channel.basicNack(deliveryTag, false, false);
            }
        }
    }

    @Transactional
    String process(JsonNode envelope) {
        String eventId = required(envelope, "eventId");
        String eventType = required(envelope, "eventType");
        int inserted = jdbc.update("""
                insert into notification.event_inbox(id, event_id, event_type, trace_id, raw_payload, processed_at)
                values (?::uuid, ?, ?, ?, ?::jsonb, now()) on conflict(event_id) do nothing
                """, UUID.randomUUID().toString(), eventId, eventType, envelope.path("traceId").asText(""), envelope.toString());
        if (inserted == 0) return "duplicate";
        if (!"notification.requested.v1".equals(eventType)) return "ignored";
        JsonNode payload = envelope.path("notificationRequested");
        jdbc.update("""
                insert into notification.notifications(id, user_id, type, title, body, source_event_id)
                values (?::uuid, ?::uuid, ?, ?, ?, ?) on conflict(user_id, source_event_id) do nothing
                """, payload.path("notificationId").asText(UUID.randomUUID().toString()), required(payload, "userId"),
                payload.path("category").asText("system"), required(payload, "title"), required(payload, "body"), payload.path("sourceEventId").asText(eventId));
        return "succeeded";
    }

    private String required(JsonNode node, String field) {
        String value = node.path(field).asText();
        if (value.isBlank()) throw new IllegalArgumentException("missing event field " + field);
        return value;
    }

    private static String failureCategory(Exception exception) {
        if (exception instanceof IllegalArgumentException || exception instanceof JsonProcessingException) {
            return "invalid_event";
        }
        if (exception instanceof DataAccessException) return "persistence";
        return "messaging";
    }
}
