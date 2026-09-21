package com.dramaip.platform.notification.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.DramaipTelemetry;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.jdbc.core.JdbcTemplate;

class NotificationEventConsumerTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void duplicateAndUnrelatedEventsDoNotCreateNotifications() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(0);
        NotificationEventConsumer consumer = consumer(jdbc, mock(DramaipMetrics.class));

        assertEquals("duplicate", consumer.process(
                json.readTree("{\"eventId\":\"event-1\",\"eventType\":\"notification.requested.v1\"}")));

        verify(jdbc).update(anyString(), any(Object[].class));
    }

    @Test
    void missingRequiredEnvelopeFieldIsRejectedBeforeNotificationWrite() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        NotificationEventConsumer consumer = consumer(jdbc, mock(DramaipMetrics.class));

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> consumer.process(json.readTree("{\"eventType\":\"notification.requested.v1\"}"))
        );
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void consumeAcknowledgesDuplicatesAndEmitsLowCardinalityOutcome() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(0);
        DramaipMetrics metrics = mock(DramaipMetrics.class);
        Channel channel = mock(Channel.class);
        NotificationEventConsumer consumer = consumer(jdbc, metrics);

        consumer.consume(message("{\"eventId\":\"event-1\",\"eventType\":\"notification.requested.v1\"}"), channel);

        verify(channel).basicAck(7L, false);
        verify(metrics).workflow("notification_consume", "duplicate");
    }

    @Test
    void consumeRejectsInvalidEventsAndEmitsAnErrorSignal() throws Exception {
        DramaipMetrics metrics = mock(DramaipMetrics.class);
        Channel channel = mock(Channel.class);
        NotificationEventConsumer consumer = consumer(mock(JdbcTemplate.class), metrics);

        consumer.consume(message("{\"eventType\":\"notification.requested.v1\"}"), channel);

        verify(channel).basicNack(7L, false, false);
        verify(metrics).workflow("notification_consume", "failed");
        verify(metrics).error("invalid_event", "notification_consume");
    }

    private NotificationEventConsumer consumer(JdbcTemplate jdbc, DramaipMetrics metrics) {
        return new NotificationEventConsumer(json, jdbc, metrics, new DramaipTelemetry("test", "test"));
    }

    private Message message(String body) {
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(7L);
        return new Message(body.getBytes(StandardCharsets.UTF_8), properties);
    }
}
