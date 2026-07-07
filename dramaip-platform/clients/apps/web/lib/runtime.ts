export const paymentMode = process.env.NEXT_PUBLIC_PAYMENT_MODE ?? 'simulated'

export function isSimulatedPaymentEnabled() {
  return paymentMode === 'simulated'
}
