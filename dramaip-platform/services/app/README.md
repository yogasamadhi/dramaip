# Runnable Apps

Each app directory is reserved for a Kratos runnable unit.

- `auth/service`: login, JWT, refresh token
- `user/service`: user profile and preferences
- `billing/service`: plans, orders, subscriptions, payment callbacks
- `billing/job`: billing outbox relay, renewal checks, reconciliation
- `quota/service`: token accounts, reservations, usage logs
- `quota/job`: quota aggregation and period account maintenance
- `ai_gateway/service`: hosted model proxy and token metering
- `bff/interface`: frontend-facing API aggregation
