package com.dramaip.platform.billing.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.dramaip.platform.billing.client.QuotaProvisionClient;
import com.dramaip.platform.billing.client.QuotaRefundClient;
import com.dramaip.platform.billing.controller.BillingController;
import com.dramaip.platform.common.observability.DramaipMetrics;
import com.dramaip.platform.common.observability.DramaipTelemetry;
import com.dramaip.platform.common.observability.OutboxObservability;
import com.dramaip.platform.common.web.BusinessException;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.env.MockEnvironment;

class PlanServiceTest {
    @Test
    void missingOwnedResourcesAndUnknownPlansReturnStableErrors() {
        PlanService service = service(new EmptyJdbcTemplate());

        assertEquals(List.of(), service.listPlans());
        assertEquals("BILLING_PLAN_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.createOrder("user", new PlanService.CreateOrder("missing", "simulated", "test-order"))
        ).code());
        assertEquals("BILLING_ORDER_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.order("order", "other-user")
        ).code());
        assertEquals("BILLING_SUBSCRIPTION_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.currentSubscription("user")
        ).code());
        assertEquals("BILLING_ORDER_NOT_FOUND", assertThrows(
                BusinessException.class,
                () -> service.confirmSimulatedPayment("user", "order")
        ).code());
    }

    @Test
    void reconciliationBoundsRowsAndProducesEmptyAdminProjection() {
        PlanService service = service(new EmptyJdbcTemplate());

        assertEquals(List.of(), service.orders("user"));
        assertEquals(List.of(), service.reconciliation("user", 0));
        PaymentProviderRegistry providers = providers("test");
        assertEquals(List.of(), new BillingController(service, providers).listPlans().data());
        assertEquals(List.of("wechatPay", "alipay", "simulated"), new BillingController(service, providers)
                .paymentProviders().data().stream().map(PaymentProviderRegistry.PaymentProviderAvailability::provider).toList());
        PlanService.AdminReconciliation projection = service.adminReconciliation(null, 1000);
        assertEquals(null, projection.latestRun());
        assertEquals(List.of(), projection.items());
    }

    private PlanService service(JdbcTemplate jdbc) {
        OutboxObservability outbox = new OutboxObservability(
                mock(DramaipMetrics.class), new DramaipTelemetry("test", "test"));
        return new PlanService(jdbc, mock(QuotaProvisionClient.class), mock(QuotaRefundClient.class),
                "internal-token", providers("test"), outbox);
    }

    private PaymentProviderRegistry providers(String profile) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profile);
        return new PaymentProviderRegistry(environment);
    }

    private static final class EmptyJdbcTemplate extends JdbcTemplate {
        @Override
        public int update(String sql, Object... args) {
            return 1;
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            return Collections.emptyList();
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper) {
            return Collections.emptyList();
        }

        @Override
        public <T> T query(String sql, ResultSetExtractor<T> resultSetExtractor, Object... args) {
            return null;
        }

        @Override
        public <T> T query(String sql, ResultSetExtractor<T> resultSetExtractor) {
            return null;
        }
    }
}
