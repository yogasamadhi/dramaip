import type { PaymentProvider } from '@dramaip/sdk'

const supportedLiveProviders: PaymentProvider[] = ['wechat_pay', 'alipay']

export const paymentMode = process.env.NEXT_PUBLIC_PAYMENT_MODE ?? 'simulated'

export function isSimulatedPaymentEnabled() {
	return paymentMode === 'simulated'
}

// Provider availability is a public deployment hint only. Billing remains the
// authority: it rejects a channel unless the server-side merchant config is
// enabled and complete.
export function checkoutProviders(): PaymentProvider[] {
	if (isSimulatedPaymentEnabled()) return ['simulated']
	const configured = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDERS ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value): value is PaymentProvider => supportedLiveProviders.includes(value as PaymentProvider))
	return [...new Set(configured)]
}

export function isSupportedPaymentProvider(value?: string): value is PaymentProvider {
	return value === 'simulated' || supportedLiveProviders.includes(value as PaymentProvider)
}
