export type Principal = { id: string; email: string; status: string; roles: string[]; permissions: string[] }
export type Overview = { user_count: number; paid_order_count: number; active_subscription_count: number; total_tokens: number; open_exception_count: number; last_event_at: string }
export type UserSummary = { user_id: string; first_seen_at: string; last_seen_at: string; total_tokens: number; last_plan_code: string }
export type OrderSummary = { order_id: string; user_id: string; plan_code: string; provider: string; amount: string; currency: string; status: string; subscription_id: string; updated_at: string }
export type SubscriptionSummary = { subscription_id: string; user_id: string; plan_code: string; status: string; period_start: string; period_end: string; updated_at: string }
export type ProjectionException = { id: string; event_id: string; event_type: string; status: string; summary: string; trace_id: string; created_at: string; resolved_at: string; resolved_by: string; resolution_reason: string }
export type AuditEntry = { id: string; actor_id: string; action: string; resource_type: string; resource_id: string; reason: string; trace_id: string; created_at: string }

const baseURL = (import.meta.env.VITE_ADMIN_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

export class APIError extends Error { constructor(message: string, readonly status: number) { super(message) } }

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as { error?: { code?: string } }
  if (!response.ok) throw new APIError(body.error?.code || `request_failed_${response.status}`, response.status)
  return body as T
}

export const adminAPI = {
  login: (email: string, password: string) => request<{ access_token: string; expires_in: number; principal: Principal }>('/v1/admin/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email, password }) }),
  overview: (token: string) => request<Overview>('/v1/admin/reporting/overview', token),
  users: (token: string) => request<{ users: UserSummary[] }>('/v1/admin/reporting/users?limit=20', token),
  orders: (token: string) => request<{ orders: OrderSummary[] }>('/v1/admin/reporting/orders?limit=20', token),
  subscriptions: (token: string) => request<{ subscriptions: SubscriptionSummary[] }>('/v1/admin/reporting/subscriptions?limit=20', token),
  exceptions: (token: string, includeResolved = false) => request<{ exceptions: ProjectionException[] }>(`/v1/admin/reporting/exceptions?limit=20&include_resolved=${includeResolved}`, token),
  audit: (token: string) => request<{ entries: AuditEntry[] }>('/v1/admin/audit?limit=20', token),
  createResolutionConfirmation: (token: string, exceptionID: string, reason: string) => request<{ confirmation: { id: string } }>('/v1/admin/confirmations', token, { method: 'POST', body: JSON.stringify({ action: 'reporting.exception.resolve', target_id: exceptionID, reason }) }),
  resolveException: (token: string, exceptionID: string, confirmationID: string) => request<{ exception: ProjectionException }>('/v1/admin/reporting/exceptions/resolve', token, { method: 'POST', body: JSON.stringify({ exception_id: exceptionID, confirmation_id: confirmationID }) }),
}
