package com.dramaip.platform.ai.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.dramaip.platform.ai.AiProperties;
import com.dramaip.platform.ai.client.QuotaClient;
import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.client.RestClient;

class ChatServiceTest {
    private ChatService service;

    @AfterEach
    void shutdown() {
        if (service != null) service.shutdownStreams();
    }

    @Test
    void modelCatalogAndPreflightAreBounded() {
        AiProperties properties = new AiProperties();
        properties.setModels(" model-a, ,model-b ");
        properties.setBaseUrl("http://provider.invalid/");
        properties.setApiKey("secret-key");
        service = create(properties);

        assertEquals(List.of("model-a", "model-b"), service.models());
        assertEquals(1, service.preflight("model-a", 0).maxTokens());
        assertEquals(32_768, service.preflight("model-b", 100_000).maxTokens());
        assertEquals("AI_MODEL_UNAVAILABLE", assertThrows(
                BusinessException.class,
                () -> service.preflight("disabled", 10)
        ).code());
        assertEquals("secret-key", properties.getApiKey());
        assertEquals("http://provider.invalid/", properties.getBaseUrl());
    }

    @Test
    void idempotencyAndAdminIdentifiersAreValidatedWithoutLeakingPrompts() {
        AiProperties properties = new AiProperties();
        properties.setModels("model-a");
        service = create(properties);

        assertEquals("AI_IDEMPOTENCY_KEY_REQUIRED", assertThrows(
                BusinessException.class,
                () -> service.chat("user", "", "model-a", List.of(new ChatService.Message("user", "private prompt")), 10)
        ).code());
        assertEquals("AI_ADMIN_USER_ID_INVALID", assertThrows(
                BusinessException.class,
                () -> service.adminCostAlerts(10, "not-a-uuid")
        ).code());
        assertEquals("AI_CHAT_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.status("user", "missing")
        ).code());
        assertEquals("notFound", service.cancel("user", "missing").status());
        assertEquals(List.of(), service.costAlerts("user", 500));
    }

    private ChatService create(AiProperties properties) {
        return new ChatService(
                properties,
                mock(QuotaClient.class),
                RestClient.builder(),
                new EmptyJdbcTemplate(),
                new ObjectMapper(),
                mock(DramaipMetrics.class),
                "internal-token"
        );
    }

    private static final class EmptyJdbcTemplate extends JdbcTemplate {
        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            return Collections.emptyList();
        }

        @Override
        public <T> T query(String sql, ResultSetExtractor<T> resultSetExtractor, Object... args) {
            return null;
        }
    }
}
