import {
  API_CONTRACT_HEADER,
  API_CONTRACT_VERSION,
  AdminAuditResponseSchema,
  AdminConfirmationResponseSchema,
  AdminExceptionResolutionResponseSchema,
  AdminExceptionsResponseSchema,
  AdminLoginResponseSchema,
  AdminOrdersResponseSchema,
  AdminOverviewSchema,
  AdminSubscriptionsResponseSchema,
  AdminUsersResponseSchema,
  DEFAULT_LIST_LIMIT,
  ListQuerySchema,
  contractErrorCode,
  type AdminAuditEntry,
  type AdminOrderSummary,
  type AdminOverview,
  type AdminPrincipal,
  type AdminProjectionException,
  type AdminSubscriptionSummary,
  type AdminUserSummary,
} from '@dramaip/sdk/contracts'

export type { AdminAuditEntry as AuditEntry, AdminOrderSummary as OrderSummary, AdminOverview as Overview, AdminPrincipal as Principal, AdminProjectionException as ProjectionException, AdminSubscriptionSummary as SubscriptionSummary, AdminUserSummary as UserSummary }

const baseURL = (import.meta.env.VITE_ADMIN_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
const defaultListQuery = ListQuerySchema.parse({ limit: DEFAULT_LIST_LIMIT })

export class APIError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

type Parser<T> = { parse(value: unknown): T }

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
  return parser.parse(body)
}

export const adminAPI = {
  login: (email: string, password: string) => request('/v1/admin/auth/login', AdminLoginResponseSchema, undefined, { method: 'POST', body: JSON.stringify({ email, password }) }),
  overview: (token: string) => request('/v1/admin/reporting/overview', AdminOverviewSchema, token),
  users: (token: string) => request(`/v1/admin/reporting/users?limit=${defaultListQuery.limit}`, AdminUsersResponseSchema, token),
  orders: (token: string) => request(`/v1/admin/reporting/orders?limit=${defaultListQuery.limit}`, AdminOrdersResponseSchema, token),
  subscriptions: (token: string) => request(`/v1/admin/reporting/subscriptions?limit=${defaultListQuery.limit}`, AdminSubscriptionsResponseSchema, token),
  exceptions: (token: string, includeResolved = false) => request(`/v1/admin/reporting/exceptions?limit=${defaultListQuery.limit}&include_resolved=${includeResolved}`, AdminExceptionsResponseSchema, token),
  audit: (token: string) => request(`/v1/admin/audit?limit=${defaultListQuery.limit}`, AdminAuditResponseSchema, token),
  createResolutionConfirmation: (token: string, exceptionID: string, reason: string) => request('/v1/admin/confirmations', AdminConfirmationResponseSchema, token, { method: 'POST', body: JSON.stringify({ action: 'reporting.exception.resolve', target_id: exceptionID, reason }) }),
  resolveException: (token: string, exceptionID: string, confirmationID: string) => request('/v1/admin/reporting/exceptions/resolve', AdminExceptionResolutionResponseSchema, token, { method: 'POST', body: JSON.stringify({ exception_id: exceptionID, confirmation_id: confirmationID }) }),
}
