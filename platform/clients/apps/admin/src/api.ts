import {
  API_CONTRACT_HEADER,
  API_CONTRACT_VERSION,
  AdminAuditResponseSchema,
  AdminConfirmationResponseSchema,
  AdminCostAlertsResponseSchema,
  AdminCustomerResponseSchema,
  AdminExceptionResolutionResponseSchema,
  AdminExceptionsResponseSchema,
  AdminLoginResponseSchema,
  AdminOrdersResponseSchema,
  AdminOverviewSchema,
  AdminSubscriptionsResponseSchema,
  AdminProfileResponseSchema,
  AdminQuotaAdjustmentResponseSchema,
  AdminRefundResponseSchema,
  AdminSubscriptionResponseSchema,
  AdminNotificationResponseSchema,
  AdminReconciliationSchema,
  AdminReconciliationRunResponseSchema,
  AdminReconciliationActionResponseSchema,
  AdminDeliveryAttemptsResponseSchema,
  AdminDeliveryRetryResponseSchema,
  AdminUsersResponseSchema,
  DEFAULT_LIST_LIMIT,
  ListQuerySchema,
  ResultSchema,
  contractErrorCode,
  type AdminAuditEntry,
  type AdminCostAlert,
  type AdminCustomer,
  type AdminOrderSummary,
  type AdminOverview,
  type AdminPrincipal,
  type AdminProjectionException,
  type AdminSubscriptionSummary,
  type AdminUserSummary,
  type AdminReconciliation,
  type AdminDeliveryAttempt,
} from '@dramaip/sdk/contracts'
import { z } from 'zod'

export type { AdminAuditEntry as AuditEntry, AdminCostAlert as CostAlert, AdminCustomer as Customer, AdminOrderSummary as OrderSummary, AdminOverview as Overview, AdminPrincipal as Principal, AdminProjectionException as ProjectionException, AdminSubscriptionSummary as SubscriptionSummary, AdminUserSummary as UserSummary, AdminReconciliation as Reconciliation, AdminDeliveryAttempt as DeliveryAttempt }

const baseURL = (import.meta.env.VITE_ADMIN_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')
const defaultListQuery = ListQuerySchema.parse({ limit: DEFAULT_LIST_LIMIT })

export class APIError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

type Parser<T> = { parse(value: unknown): T }

const JavaAdminPrincipalSchema = z.object({ id: z.string(), email: z.string().email(), status: z.string(), roles: z.array(z.string()), permissions: z.array(z.string()) })
const JavaAdminLoginSchema = z.object({ accessToken: z.string(), expiresIn: z.number().int().positive(), principal: JavaAdminPrincipalSchema })
const JavaAdminConfirmationSchema = z.object({ id: z.string() })
const JavaAdminAuditSchema = z.object({ id: z.string(), actorId: z.string(), action: z.string(), resourceType: z.string(), resourceId: z.string(), reason: z.string(), traceId: z.string(), createdAt: z.string() })
export const CorpusSourceSchema = z.object({
  id: z.string(), submittedBy: z.string().nullish(), canonicalUrl: z.string(), domain: z.string(),
  title: z.string().nullish(), excerpt: z.string().max(500).nullish(), contentHash: z.string().nullish(),
  status: z.enum(['quarantined', 'fetched', 'allowed', 'blocked', 'takedown', 'failed']),
  rightsStatus: z.enum(['unknown', 'review_required', 'allowed', 'restricted', 'removed']),
  locale: z.string(), httpStatus: z.number().int().nullish(), retrievedAt: z.string().nullish(),
  lastErrorCode: z.string().nullish(), version: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
})
export type CorpusSource = z.infer<typeof CorpusSourceSchema>
export const CorpusJobSchema = z.object({
  id: z.string(), sourceId: z.string(), depth: z.number().int().nonnegative(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'blocked']), attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string(), leaseUntil: z.string().nullish(), errorCode: z.string().nullish(),
  createdAt: z.string(), updatedAt: z.string(), finishedAt: z.string().nullish(),
})
export type CorpusJob = z.infer<typeof CorpusJobSchema>
function adminPrincipal(value: z.infer<typeof JavaAdminPrincipalSchema>) {
  return { id: value.id, email: value.email, status: value.status, roles: value.roles, permissions: value.permissions }
}
function adminLogin(value: unknown) {
  const item = JavaAdminLoginSchema.parse(value)
  return AdminLoginResponseSchema.parse({ access_token: item.accessToken, expires_in: item.expiresIn, principal: adminPrincipal(item.principal) })
}
function adminConfirmation(value: unknown) {
  const item = JavaAdminConfirmationSchema.parse(value)
  return AdminConfirmationResponseSchema.parse({ confirmation: { id: item.id } })
}
function adminAudit(value: unknown) {
  const entries = z.array(JavaAdminAuditSchema).parse(value)
  return AdminAuditResponseSchema.parse({ entries: entries.map((entry) => ({ id: entry.id, actor_id: entry.actorId, action: entry.action, resource_type: entry.resourceType, resource_id: entry.resourceId, reason: entry.reason, trace_id: entry.traceId, created_at: entry.createdAt })) })
}

async function request<T>(path: string, parser: Parser<T>, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      [API_CONTRACT_HEADER]: API_CONTRACT_VERSION,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw new APIError(contractErrorCode(body) || `request_failed_${response.status}`, response.status)
  const envelope = ResultSchema(z.unknown()).parse(body)
  if (envelope.code !== 'OK') throw new APIError(envelope.code, response.status)
  return parser.parse(envelope.data)
}

export const adminAPI = {
  login: async (email: string, password: string) => adminLogin(await request('/api/v1/admin/auth/login', z.unknown(), undefined, { method: 'POST', body: JSON.stringify({ email, password }) })),
  overview: (token: string) => request('/api/v1/admin/reporting/overview', AdminOverviewSchema, token),
  users: (token: string, cursor = '', query = '') => request(`/api/v1/admin/reporting/users?limit=${defaultListQuery.limit}&cursor=${encodeURIComponent(cursor)}&query=${encodeURIComponent(query)}`, AdminUsersResponseSchema, token),
  orders: (token: string, cursor = '', query = '') => request(`/api/v1/admin/reporting/orders?limit=${defaultListQuery.limit}&cursor=${encodeURIComponent(cursor)}&query=${encodeURIComponent(query)}`, AdminOrdersResponseSchema, token),
  subscriptions: (token: string, cursor = '', query = '') => request(`/api/v1/admin/reporting/subscriptions?limit=${defaultListQuery.limit}&cursor=${encodeURIComponent(cursor)}&query=${encodeURIComponent(query)}`, AdminSubscriptionsResponseSchema, token),
  exceptions: (token: string, includeResolved = false) => request(`/api/v1/admin/reporting/exceptions?limit=${defaultListQuery.limit}&include_resolved=${includeResolved}`, AdminExceptionsResponseSchema, token),
  audit: async (token: string) => adminAudit(await request(`/api/v1/admin/audit?limit=${defaultListQuery.limit}`, z.unknown(), token)),
  createResolutionConfirmation: async (token: string, exceptionID: string, reason: string) => adminConfirmation(await request('/api/v1/admin/confirmations', z.unknown(), token, { method: 'POST', body: JSON.stringify({ action: 'reporting.exception.resolve', targetId: exceptionID, reason }) })),
  resolveException: (token: string, exceptionID: string, confirmationID: string) => request('/api/v1/admin/reporting/exceptions/resolve', AdminExceptionResolutionResponseSchema, token, { method: 'POST', body: JSON.stringify({ exception_id: exceptionID, confirmation_id: confirmationID }) }),
  customer: (token: string, userID: string) => request(`/api/v1/admin/customers/${encodeURIComponent(userID)}`, AdminCustomerResponseSchema, token),
  costAlerts: (token: string, userID = '') => request(`/api/v1/admin/ai/cost-alerts?limit=${defaultListQuery.limit}${userID ? `&user_id=${encodeURIComponent(userID)}` : ''}`, AdminCostAlertsResponseSchema, token),
  createConfirmation: async (token: string, action: string, targetID: string, reason: string) => adminConfirmation(await request('/api/v1/admin/confirmations', z.unknown(), token, { method: 'POST', body: JSON.stringify({ action, targetId: targetID, reason }) })),
  setCustomerStatus: (token: string, userID: string, status: 'active' | 'suspended', confirmationID: string) => request('/api/v1/admin/customers/status', AdminProfileResponseSchema, token, { method: 'POST', body: JSON.stringify({ user_id: userID, status, confirmation_id: confirmationID }) }),
  requestRefund: (token: string, userID: string, subscriptionID: string, confirmationID: string) => request('/api/v1/admin/billing/refunds', AdminRefundResponseSchema, token, { method: 'POST', body: JSON.stringify({ user_id: userID, subscription_id: subscriptionID, confirmation_id: confirmationID }) }),
  resumeSubscription: (token: string, userID: string, subscriptionID: string, confirmationID: string) => request('/api/v1/admin/billing/subscriptions/resume', AdminSubscriptionResponseSchema, token, { method: 'POST', body: JSON.stringify({ user_id: userID, subscription_id: subscriptionID, confirmation_id: confirmationID }) }),
  adjustQuota: (token: string, userID: string, subscriptionID: string, deltaTokens: number, confirmationID: string) => request('/api/v1/admin/quota/adjustments', AdminQuotaAdjustmentResponseSchema, token, { method: 'POST', body: JSON.stringify({ user_id: userID, subscription_id: subscriptionID, delta_tokens: deltaTokens, confirmation_id: confirmationID }) }),
  sendNotification: (token: string, userID: string, title: string, body: string, confirmationID: string) => request('/api/v1/admin/notifications/send', AdminNotificationResponseSchema, token, { method: 'POST', body: JSON.stringify({ user_id: userID, title, body, confirmation_id: confirmationID }) }),
  reconciliation: (token: string, status = '') => request(`/api/v1/admin/billing/reconciliation?limit=${defaultListQuery.limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`, AdminReconciliationSchema, token),
  startReconciliation: (token: string, confirmationID: string) => request('/api/v1/admin/billing/reconciliation/runs', AdminReconciliationRunResponseSchema, token, { method: 'POST', body: JSON.stringify({ confirmation_id: confirmationID }) }),
  applyReconciliationAction: (token: string, itemID: string, action: string, confirmationID: string) => request('/api/v1/admin/billing/reconciliation/items/actions', AdminReconciliationActionResponseSchema, token, { method: 'POST', body: JSON.stringify({ item_id: itemID, action, confirmation_id: confirmationID }) }),
  deliveryAttempts: (token: string, status = 'failed') => request(`/api/v1/admin/notifications/delivery-attempts?limit=${defaultListQuery.limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`, AdminDeliveryAttemptsResponseSchema, token),
  retryDelivery: (token: string, deliveryAttemptID: string, confirmationID: string) => request('/api/v1/admin/notifications/delivery-attempts/retry', AdminDeliveryRetryResponseSchema, token, { method: 'POST', body: JSON.stringify({ delivery_attempt_id: deliveryAttemptID, confirmation_id: confirmationID }) }),
  corpusSources: (token: string) => request('/api/v1/admin/creative-corpus/sources?limit=100', z.array(CorpusSourceSchema), token),
  corpusJobs: (token: string) => request('/api/v1/admin/creative-corpus/jobs?limit=100', z.array(CorpusJobSchema), token),
  submitCorpusSource: (token: string, url: string) => request('/api/v1/admin/creative-corpus/sources', CorpusSourceSchema, token, { method: 'POST', body: JSON.stringify({ url }) }),
  governCorpusSource: (token: string, source: CorpusSource, action: 'allow' | 'block' | 'takedown', reason: string, confirmationID?: string) => request(`/api/v1/admin/creative-corpus/sources/${encodeURIComponent(source.id)}/actions`, CorpusSourceSchema, token, { method: 'POST', body: JSON.stringify({ version: source.version, action, reason, confirmationId: confirmationID }) }),
}
