'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api-client'
import { Button } from './ui/Button'

export function PricingPlans() {
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiClient.getPlans(),
  })

  const checkout = useMutation({
    mutationFn: (planID: string) => apiClient.createCheckout({ plan_id: planID, channel: 'wechat_pay' }),
  })

  if (plans.isLoading) {
    return <p className="mt-8 text-sm text-slate-600">Loading plans...</p>
  }

  if (plans.error) {
    return <p className="mt-8 text-sm text-rose-600">Cannot load plans from the service.</p>
  }

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-4">
      {plans.data?.plans.map((plan) => (
        <section key={plan.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{plan.name}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{plan.description}</p>
          <p className="mt-5 text-sm text-slate-500">{plan.quota_tokens.toLocaleString()} tokens / month</p>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {plan.price_cny === 0 ? 'Free' : `¥${plan.price_cny}`}
          </p>
          <Button className="mt-5 w-full" onClick={() => checkout.mutate(plan.id)}>
            {plan.price_cny === 0 ? 'Start free' : 'Subscribe'}
          </Button>
        </section>
      ))}
      {checkout.data ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 md:col-span-4">
          Checkout created: {checkout.data.checkout_id}
        </section>
      ) : null}
      {checkout.error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 md:col-span-4">
          Login first, then create a checkout from this plan.
        </section>
      ) : null}
    </div>
  )
}
