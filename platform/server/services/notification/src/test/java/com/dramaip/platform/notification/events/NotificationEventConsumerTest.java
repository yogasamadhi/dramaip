package com.dramaip.platform.notification.events;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class NotificationEventConsumerTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void duplicateAndUnrelatedEventsDoNotCreateNotifications() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(0);
        NotificationEventConsumer consumer = new NotificationEventConsumer(json, jdbc);

        consumer.process(json.readTree("{\"eventId\":\"event-1\",\"eventType\":\"notification.requested.v1\"}"));

        verify(jdbc).update(anyString(), any(Object[].class));
    }

    @Test
    void missingRequiredEnvelopeFieldIsRejectedBeforeNotificationWrite() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        NotificationEventConsumer consumer = new NotificationEventConsumer(json, jdbc);

        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> consumer.process(json.readTree("{\"eventType\":\"notification.requested.v1\"}"))
        );
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
