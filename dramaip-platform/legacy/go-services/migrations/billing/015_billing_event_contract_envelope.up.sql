-- Keep already-published legacy messages untouched. Only pending outbox rows
-- need conversion because the relay now requires a versioned EventEnvelope.

UPDATE billing.outbox_events
SET
  event_type = 'billing.checkout.created.v1',
  version = 1,
  trace_id = COALESCE(NULLIF(trace_id, ''), payload ->> 'trace_id', ''),
  payload = jsonb_build_object(
    'eventId', id::text,
    'eventType', 'billing.checkout.created.v1',
    'schemaVersion', 1,
    'aggregateType', 'billing.order',
    'aggregateId', aggregate_id::text,
    'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'traceId', COALESCE(NULLIF(trace_id, ''), payload ->> 'trace_id', ''),
    'checkoutCreated', jsonb_build_object(
      'orderId', aggregate_id::text,
      'userId', payload ->> 'user_id',
      'planCode', payload ->> 'plan',
      'provider', payload ->> 'channel',
      'amount', payload ->> 'amount',
      'currency', 'CNY'
    )
  )
WHERE published_at IS NULL
  AND event_type = 'billing.checkout.created';

UPDATE billing.outbox_events AS outbox
SET
  version = 1,
  trace_id = COALESCE(NULLIF(outbox.trace_id, ''), outbox.payload ->> 'trace_id', ''),
  payload = jsonb_build_object(
    'eventId', outbox.id::text,
    'eventType', 'payment.succeeded.v1',
    'schemaVersion', 1,
    'aggregateType', 'billing.payment',
    'aggregateId', outbox.aggregate_id::text,
    'occurredAt', to_char(outbox.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'traceId', COALESCE(NULLIF(outbox.trace_id, ''), outbox.payload ->> 'trace_id', ''),
    'paymentSucceeded', jsonb_build_object(
      'paymentId', payment.id::text,
      'orderId', billing_order.id::text,
      'subscriptionId', billing_order.subscription_id::text,
      'userId', payment.user_id::text,
      'planCode', plan.code,
      'provider', payment.provider,
      'amount', payment.amount::text,
      'currency', payment.currency
    )
  )
FROM billing.payments AS payment
JOIN billing.orders AS billing_order ON billing_order.id = payment.order_id
JOIN billing.plans AS plan ON plan.id = billing_order.plan_id
WHERE outbox.published_at IS NULL
  AND outbox.event_type = 'payment.succeeded.v1'
  AND NOT (outbox.payload ? 'paymentSucceeded')
  AND outbox.aggregate_type = 'billing.payment'
  AND outbox.aggregate_id = payment.id;
