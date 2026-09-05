package com.dramaip.platform.billing.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class PaymentProviderRegistryTest {
    @Test
    void productionPublishesLiveChannelsAsUnavailableAndOmitsSimulated() {
        PaymentProviderRegistry registry = registry("prod");

        assertEquals(List.of("wechatPay", "alipay"), registry.publicProviders().stream()
                .map(PaymentProviderRegistry.PaymentProviderAvailability::provider).toList());
        assertTrue(registry.publicProviders().stream().allMatch(provider -> "unavailable".equals(provider.state())));
        assertFalse(registry.canCreateOrder("simulated"));
        assertFalse(registry.simulatedEnabled());
    }

    @Test
    void simulatedProviderRequiresExplicitDevOrTestProfile() {
        PaymentProviderRegistry registry = registry("test");

        assertTrue(registry.simulatedEnabled());
        assertTrue(registry.canCreateOrder("simulated"));
        assertEquals("verified", registry.publicProviders().stream()
                .filter(provider -> "simulated".equals(provider.provider()))
                .findFirst().orElseThrow().state());
        assertFalse(registry.canCreateOrder("wechatPay"));
        assertFalse(registry.canCreateOrder("alipay"));
    }

    private static PaymentProviderRegistry registry(String profile) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profile);
        return new PaymentProviderRegistry(environment);
    }
}
