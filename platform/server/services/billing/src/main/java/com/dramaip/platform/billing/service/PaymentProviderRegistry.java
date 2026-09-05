package com.dramaip.platform.billing.service;

import java.util.List;
import java.util.Set;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Authoritative deployment-time availability for payment providers.
 *
 * <p>Live providers intentionally remain unavailable until their signed adapter,
 * merchant configuration and release evidence are present. The simulated provider
 * only exists in an explicitly active dev/test profile.</p>
 */
@Component
public final class PaymentProviderRegistry {
    public static final String WECHAT_PAY = "wechatPay";
    public static final String ALIPAY = "alipay";
    public static final String SIMULATED = "simulated";
    private static final Set<String> KNOWN = Set.of(WECHAT_PAY, ALIPAY, SIMULATED);

    private final boolean simulatedEnabled;

    public PaymentProviderRegistry(Environment environment) {
        this.simulatedEnabled = environment.acceptsProfiles(Profiles.of("dev", "test"));
    }

    public List<PaymentProviderAvailability> publicProviders() {
        var providers = new java.util.ArrayList<PaymentProviderAvailability>();
        providers.add(unavailable(
                WECHAT_PAY,
                "Native v3 adapter, merchant credentials and release payment/refund evidence are not installed"));
        providers.add(unavailable(
                ALIPAY,
                "precreate adapter, merchant credentials and release payment/refund evidence are not installed"));
        if (simulatedEnabled) {
            providers.add(new PaymentProviderAvailability(
                    SIMULATED,
                    "verified",
                    "dev-test-v1",
                    List.of("Only available in dev/test; it does not contact a payment network"),
                    List.of("qrCode")));
        }
        return List.copyOf(providers);
    }

    public boolean isKnown(String provider) {
        return KNOWN.contains(provider);
    }

    public boolean canCreateOrder(String provider) {
        return SIMULATED.equals(provider) && simulatedEnabled;
    }

    public boolean simulatedEnabled() {
        return simulatedEnabled;
    }

    private static PaymentProviderAvailability unavailable(String provider, String limitation) {
        return new PaymentProviderAvailability(
                provider,
                "unavailable",
                "unconfigured-v1",
                List.of(limitation),
                List.of("qrCode"));
    }

    public record PaymentProviderAvailability(
            String provider,
            String state,
            String version,
            List<String> limitations,
            List<String> paymentActionTypes) { }
}
