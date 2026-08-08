import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'
import { API_CONTRACT_HEADER, API_CONTRACT_VERSION, AccountBootstrapQuerySchema, ListQuerySchema, ResultSchema, UsageTrendQuerySchema, type AccountBootstrapQuery } from './contracts'

export * from './contracts'

export const TokenBalanceSchema = z.object({
  plan: z.string().default(''),
  quota_tokens: z.number().default(0),
  used_tokens: z.number().default(0),
  remaining_tokens: z.number().default(0),
  period_start: z.string().default(''),
  period_end: z.string().default(''),
})

export type TokenBalance = z.infer<typeof TokenBalanceSchema>

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const ProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  phone: z.string(),
  status: z.string(),
  display_name: z.string(),
  avatar_url: z.string(),
  locale: z.string(),
  timezone: z.string(),
})

export type Profile = z.infer<typeof ProfileSchema>

export const LoginResponseSchema = z.object({
  user: UserSchema,
})

export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const RegisterResponseSchema = LoginResponseSchema

export type RegisterResponse = LoginResponse

export const EmailActionResponseSchema = z.object({
  accepted: z.boolean(),
})

export type EmailActionResponse = z.infer<typeof EmailActionResponseSchema>

export const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  dependencies: z.record(z.string()).optional(),
})

export type Health = z.infer<typeof HealthSchema>

export const DashboardSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string(),
  subscription_status: z.string(),
  plan: z.string(),
  quota_tokens: z.number(),
  used_tokens: z.number(),
  remaining_tokens: z.number(),
})

export type Dashboard = z.infer<typeof DashboardSchema>

export const PlanEntitlementsSchema = z.object({
  included_seats: z.number().int().nonnegative(),
  byok_enabled: z.boolean(),
  offline_review_enabled: z.boolean(),
  advanced_export_enabled: z.boolean(),
  cloud_review_enabled: z.boolean(),
  review_storage_bytes: z.number().nonnegative(),
  review_retention_days: z.number().int().nonnegative(),
  private_gateway_enabled: z.boolean(),
})

export type PlanEntitlements = z.infer<typeof PlanEntitlementsSchema>

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cny: z.number(),
  quota_tokens: z.number(),
  description: z.string(),
  purchase_mode: z.enum(['self_serve', 'sales_contact']).default('self_serve'),
  entitlements: PlanEntitlementsSchema,
})

export type Plan = z.infer<typeof PlanSchema>

export const PlansResponseSchema = z.object({
  plans: z.array(PlanSchema),
})

export type PlansResponse = z.infer<typeof PlansResponseSchema>

export const CheckoutResponseSchema = z.object({
  checkout_id: z.string(),
  plan_id: z.string(),
  channel: z.string(),
  status: z.string(),
  checkout_url: z.string(),
  expires_at: z.string().default(''),
})

export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>

export const PaymentProviderSchema = z.enum(['simulated', 'wechat_pay', 'alipay'])
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>

export const SubscriptionSchema = z.object({
  id: z.string().default(''),
  user_id: z.string().default(''),
  plan_id: z.string().default(''),
  plan_code: z.string().default(''),
  status: z.string().default(''),
  current_period_start: z.string().default(''),
  current_period_end: z.string().default(''),
  cancel_at_period_end: z.boolean().optional(),
  canceled_at: z.string().optional(),
  scheduled_plan_code: z.string().optional(),
  scheduled_change_at: z.string().optional(),
  lifecycle_error: z.string().optional(),
  purchase_mode: z.enum(['self_serve', 'sales_contact']).optional(),
  entitlements: PlanEntitlementsSchema.optional(),
  legacy_plan_code: z.string().optional(),
  renewal_plan_code: z.string().optional(),
  migration_effective_at: z.string().optional(),
})

export type Subscription = z.infer<typeof SubscriptionSchema>

export const RefundSchema = z.object({
  id: z.string().default(''),
  subscription_id: z.string().default(''),
  status: z.string().default(''),
  reason: z.string().default(''),
  used_tokens: z.number().default(0),
  quota_hold_status: z.string().default(''),
  failure_reason: z.string().default(''),
  created_at: z.string().default(''),
  resolved_at: z.string().default(''),
})

export type Refund = z.infer<typeof RefundSchema>

export const PaymentConfirmationResponseSchema = z.object({
  order_id: z.string(),
  status: z.string(),
  subscription: SubscriptionSchema,
  token_balance: TokenBalanceSchema,
})

export type PaymentConfirmationResponse = z.infer<typeof PaymentConfirmationResponseSchema>
export type SandboxPaymentResponse = PaymentConfirmationResponse

export const OrderSchema = z.object({
  id: z.string().default(''),
  user_id: z.string().default(''),
  plan_id: z.string().default(''),
  plan_code: z.string().default(''),
  provider: z.string().default(''),
  amount: z.string().default('0'),
  currency: z.string().default(''),
  status: z.string().default(''),
  payment_url: z.string().default(''),
	created_at: z.string().default(''),
	expires_at: z.string().default(''),
	paid_at: z.string().optional(),
  subscription_id: z.string().optional(),
  purchase_mode: z.enum(['self_serve', 'sales_contact']).optional(),
  entitlements_snapshot: PlanEntitlementsSchema.optional(),
})

export type Order = z.infer<typeof OrderSchema>

export const OrdersResponseSchema = z.object({
  orders: z.array(OrderSchema),
})

export type OrdersResponse = z.infer<typeof OrdersResponseSchema>

export const TokenUsageSchema = z.object({
  id: z.string().default(''),
  reservation_id: z.string().default(''),
  request_id: z.string().default(''),
  model: z.string().default(''),
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  total_tokens: z.number().default(0),
  status: z.string().default(''),
  created_at: z.string().default(''),
})

export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const TokenUsageResponseSchema = z.object({
  usage: z.array(TokenUsageSchema),
})

export type TokenUsageResponse = z.infer<typeof TokenUsageResponseSchema>

export const UsageTrendPointSchema = z.object({
  date: z.string(),
  total_tokens: z.number(),
})

export type UsageTrendPoint = z.infer<typeof UsageTrendPointSchema>

export const UsageTrendResponseSchema = z.object({
  points: z.array(UsageTrendPointSchema),
})

export type UsageTrendResponse = z.infer<typeof UsageTrendResponseSchema>

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  source_event_id: z.string().default(''),
  read_at: z.string().default(''),
  created_at: z.string().default(''),
})

export type Notification = z.infer<typeof NotificationSchema>

export const NotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unread_count: z.number().default(0),
})

export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>

export const AccountReportSchema = z.object({
  generated_at: z.string(),
  subscription: SubscriptionSchema.nullish(),
  token_balance: TokenBalanceSchema.nullish(),
  order_summary: z.object({ paid: z.number(), pending: z.number(), total: z.number() }),
  usage_summary: z.object({ total_tokens: z.number(), requests: z.number() }),
  // Earlier temporary-staging API responses emitted null for a protobuf empty repeated
  // field. Normalize it at the client boundary so an empty history remains a
  // valid account report while the server-side contract is being upgraded.
  usage_trend: z.array(UsageTrendPointSchema).nullish().transform((points) => points ?? []),
  notification_summary: z.object({ unread: z.number(), total: z.number() }),
})

export type AccountReport = z.infer<typeof AccountReportSchema>

const AccountSectionSchema = <T extends z.ZodTypeAny>(data: T) => z.object({
  status: z.enum(['ready', 'unavailable']),
  last_updated: z.string(),
  trace_id: z.string().default(''),
  error_code: z.string().default(''),
  data: data.optional(),
})

export const AccountBootstrapSchema = z.object({
  generated_at: z.string(),
  cache_ttl_seconds: z.number().int().positive(),
  usage_limit: z.number().int().positive(),
  trend_days: z.number().int().positive(),
  sections: z.object({
    profile: AccountSectionSchema(ProfileSchema),
    subscription: AccountSectionSchema(SubscriptionSchema),
    token_balance: AccountSectionSchema(TokenBalanceSchema),
    orders: AccountSectionSchema(OrdersResponseSchema),
    usage: AccountSectionSchema(TokenUsageResponseSchema),
    usage_trend: AccountSectionSchema(UsageTrendResponseSchema),
    notifications: AccountSectionSchema(NotificationsResponseSchema),
  }),
})

export type AccountBootstrap = z.infer<typeof AccountBootstrapSchema>

const JavaProfileSchema = z.object({
  id: z.string(), email: z.string(), phone: z.string().nullish(), status: z.string(), displayName: z.string().nullish(),
  avatarUrl: z.string().nullish(), locale: z.string().nullish(), timezone: z.string().nullish(),
})
const JavaSubscriptionSchema = z.object({
  id: z.string(), planId: z.string(), planCode: z.string(), planName: z.string(), provider: z.string(), status: z.string(),
  currentPeriodStart: z.string(), currentPeriodEnd: z.string(), cancelAtPeriodEnd: z.boolean(),
  renewalPlanCode: z.string().nullish(), entitlements: z.string().default('{}'),
})
const JavaTokenBalanceSchema = z.object({
  planCode: z.string(), quotaTokens: z.number(), usedTokens: z.number(), remainingTokens: z.number(),
  periodStart: z.string(), periodEnd: z.string(),
})
const JavaOrderSchema = z.object({
  id: z.string(), planId: z.string(), planCode: z.string(), status: z.string(), provider: z.string(), amountMinor: z.number(),
  currency: z.string(), createdAt: z.string(), paidAt: z.string().nullish(), paymentUrl: z.string().nullish(),
  paymentExpiresAt: z.string().nullish(), subscriptionId: z.string().nullish(),
})
const JavaTokenUsageSchema = z.object({
  id: z.string(), requestId: z.string(), model: z.string(), promptTokens: z.number(), completionTokens: z.number(),
  totalTokens: z.number(), status: z.string(), createdAt: z.string(),
})
const JavaUsageTrendPointSchema = z.object({ date: z.string(), totalTokens: z.number() })
const JavaNotificationSchema = z.object({
  id: z.string(), type: z.string(), title: z.string(), body: z.string(), sourceEventId: z.string().nullish(),
  readAt: z.string().nullish(), createdAt: z.string(),
})
const JavaPlanSchema = z.object({
  id: z.string(), code: z.string(), name: z.string(), billingPeriod: z.string(), amountMinor: z.number(),
  currency: z.string(), monthlyTokenQuota: z.number(), maxRpm: z.number(), maxContextTokens: z.number(),
  modelLevel: z.string(), purchaseMode: z.string(), entitlements: z.string().default('{}'),
})

function profileFromJava(value: unknown): Profile {
  const item = JavaProfileSchema.parse(value)
  return ProfileSchema.parse({
    id: item.id, email: item.email, phone: item.phone ?? '', status: item.status, display_name: item.displayName ?? '',
    avatar_url: item.avatarUrl ?? '', locale: item.locale ?? '', timezone: item.timezone ?? '',
  })
}

function subscriptionFromJava(value: unknown): Subscription {
  const item = JavaSubscriptionSchema.parse(value)
  let entitlements: PlanEntitlements | undefined
  try {
    const parsed = PlanEntitlementsSchema.safeParse(JSON.parse(item.entitlements))
    if (parsed.success) entitlements = parsed.data
  } catch {
    // A malformed historical snapshot must not make the whole account page unavailable.
  }
  return SubscriptionSchema.parse({
    id: item.id, plan_id: item.planId, plan_code: item.planCode, status: item.status,
    current_period_start: item.currentPeriodStart, current_period_end: item.currentPeriodEnd,
    cancel_at_period_end: item.cancelAtPeriodEnd, renewal_plan_code: item.renewalPlanCode ?? '', entitlements,
  })
}

function tokenBalanceFromJava(value: unknown): TokenBalance {
  const item = JavaTokenBalanceSchema.parse(value)
  return TokenBalanceSchema.parse({
    plan: item.planCode, quota_tokens: item.quotaTokens, used_tokens: item.usedTokens,
    remaining_tokens: item.remainingTokens, period_start: item.periodStart, period_end: item.periodEnd,
  })
}

function orderFromJava(value: unknown): Order {
  const item = JavaOrderSchema.parse(value)
  return OrderSchema.parse({
    id: item.id, plan_id: item.planId, plan_code: item.planCode, provider: item.provider,
    amount: (item.amountMinor / 100).toFixed(2), currency: item.currency, status: item.status,
    payment_url: item.paymentUrl ?? '', created_at: item.createdAt, expires_at: item.paymentExpiresAt ?? '',
    paid_at: item.paidAt ?? undefined, subscription_id: item.subscriptionId || undefined,
  })
}

function ordersFromJava(value: unknown): OrdersResponse {
  return OrdersResponseSchema.parse({ orders: z.array(JavaOrderSchema).parse(value).map(orderFromJava) })
}

function tokenUsageFromJava(value: unknown): TokenUsageResponse {
  const usage = z.array(JavaTokenUsageSchema).parse(value).map((item) => TokenUsageSchema.parse({
    id: item.id, request_id: item.requestId, model: item.model, prompt_tokens: item.promptTokens,
    completion_tokens: item.completionTokens, total_tokens: item.totalTokens, status: item.status, created_at: item.createdAt,
  }))
  return TokenUsageResponseSchema.parse({ usage })
}

function usageTrendFromJava(value: unknown): UsageTrendResponse {
  const points = z.array(JavaUsageTrendPointSchema).parse(value).map((item) => ({ date: item.date, total_tokens: item.totalTokens }))
  return UsageTrendResponseSchema.parse({ points })
}

function notificationFromJava(value: unknown): Notification {
  const item = JavaNotificationSchema.parse(value)
  return NotificationSchema.parse({
    id: item.id, type: item.type, title: item.title, body: item.body, source_event_id: item.sourceEventId ?? '',
    read_at: item.readAt ?? '', created_at: item.createdAt,
  })
}

function notificationsFromJava(value: unknown): NotificationsResponse {
  const items = z.array(JavaNotificationSchema).parse(value)
  return NotificationsResponseSchema.parse({
    notifications: items.map(notificationFromJava), unread_count: items.filter((item) => !item.readAt).length,
  })
}

// Entitlements are stored server-side as a JSON string (selected via entitlements::text);
// parse it back into the object the catalogue expects, falling back to an empty
// entitlement set so a single malformed plan row never blanks the whole page.
const EmptyPlanEntitlements = {
  included_seats: 0, byok_enabled: false, offline_review_enabled: false, advanced_export_enabled: false,
  cloud_review_enabled: false, review_storage_bytes: 0, review_retention_days: 0, private_gateway_enabled: false,
}
function planEntitlementsFromJava(raw: string): PlanEntitlements {
  try {
    const parsed = PlanEntitlementsSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // A malformed historical plan row must not blank the whole catalogue.
  }
  return PlanEntitlementsSchema.parse(EmptyPlanEntitlements)
}

// The catalogue treats the plan code as the stable identifier (sorting, plan-code
// matching, checkout); the Java Plan record exposes it as `code`, with `id` being
// the row UUID. Amounts arrive as minor units (fen) and purchase modes use the
// backend spelling, so both are normalised at the client boundary.
function planFromJava(value: unknown): Plan {
  const item = JavaPlanSchema.parse(value)
  return PlanSchema.parse({
    id: item.code,
    name: item.name,
    price_cny: item.amountMinor / 100,
    quota_tokens: item.monthlyTokenQuota,
    description: '',
    purchase_mode: item.purchaseMode === 'sales_contact' ? 'sales_contact' : 'self_serve',
    entitlements: planEntitlementsFromJava(item.entitlements),
  })
}

function plansFromJava(value: unknown): PlansResponse {
  return PlansResponseSchema.parse({ plans: z.array(JavaPlanSchema).parse(value).map(planFromJava) })
}

type AccountSection<T> = {
  status: 'ready' | 'unavailable'
  last_updated: string
  trace_id: string
  error_code: string
  data?: T
}

function errorEnvelopeField(error: unknown, field: 'code' | 'traceId'): string {
  if (!axios.isAxiosError(error) || !error.response?.data || typeof error.response.data !== 'object') return ''
  const value = (error.response.data as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : ''
}

async function accountSection<T>(lastUpdated: string, load: () => Promise<T>): Promise<AccountSection<T>> {
  try {
    return { status: 'ready', last_updated: lastUpdated, trace_id: '', error_code: '', data: await load() }
  } catch (error) {
    return {
      status: 'unavailable', last_updated: lastUpdated, trace_id: errorEnvelopeField(error, 'traceId'),
      error_code: errorEnvelopeField(error, 'code') || 'COMMON_SECTION_UNAVAILABLE',
    }
  }
}

export const LogoutResponseSchema = z.object({
  ok: z.boolean(),
})

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatResponseSchema = z.object({
  request_id: z.string(),
  content: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  reservation_id: z.string(),
  remaining_tokens: z.number(),
  status: z.string().optional(),
})

export type ChatResponse = z.infer<typeof ChatResponseSchema>

export const ChatPreflightResponseSchema = z.object({
  model: z.object({ provider: z.string().min(1), model: z.string().min(1), is_default: z.boolean() }),
  estimated_tokens: z.number().int().nonnegative(),
  remaining_tokens: z.number().int().nonnegative(),
  request_hash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

export type ChatPreflightResponse = z.infer<typeof ChatPreflightResponseSchema>

export const ChatModelSchema = z.object({
  id: z.string().min(3),
  provider: z.string().min(1),
  model: z.string().min(1),
  is_default: z.boolean(),
})

export const ChatModelsResponseSchema = z.object({
  models: z.array(ChatModelSchema),
})

export type ChatModel = z.infer<typeof ChatModelSchema>
export type ChatModelsResponse = z.infer<typeof ChatModelsResponseSchema>

export const ChatStreamEventSchema = z.object({
  type: z.enum(['started', 'delta', 'completed', 'failed', 'canceled']),
  request_id: z.string().default(''),
  delta: z.string().default(''),
  reply: ChatResponseSchema.optional(),
  code: z.string().optional(),
  trace_id: z.string().optional(),
})

export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>

export type ChatInput = {
  request_id?: string
  idempotency_key?: string
  provider?: string
  model?: string
  messages: ChatMessage[]
  max_tokens?: number
}

export type ChatStreamInput = ChatInput & { preflight_request_hash: string }

export const WorkspaceSchema = z.object({
  id: z.string(),
  owner_user_id: z.string(),
  name: z.string(),
  plan_code: z.string(),
  included_seats: z.number().int().nonnegative(),
  active_member_count: z.number().int().nonnegative(),
  pending_invitation_count: z.number().int().nonnegative(),
  current_user_role: z.enum(['owner', 'admin', 'member']),
  review_storage_bytes: z.number().nonnegative(),
  review_retention_days: z.number().int().nonnegative(),
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const WorkspaceMemberSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  status: z.string(),
  display_name: z.string(),
  email: z.string(),
  created_at: z.string(),
})
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>

export const WorkspaceInvitationSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'member']),
  invited_by: z.string(),
  expires_at: z.string(),
  accepted_by: z.string().default(''),
  accepted_at: z.string().default(''),
  revoked_at: z.string().default(''),
  created_at: z.string(),
  token: z.string().default(''),
})
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>

export const ReviewMediaSchema = z.object({
  id: z.string(),
  relative_path: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().nonnegative(),
  sha256: z.string(),
  status: z.string(),
  download_url: z.string(),
  download_url_expires_at: z.string(),
})
export type ReviewMedia = z.infer<typeof ReviewMediaSchema>

export const ReviewPackageSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  desktop_package_id: z.string(),
  title: z.string(),
  status: z.string(),
  manifest_json: z.string(),
  storage_bytes: z.number().nonnegative(),
  sync_cursor: z.number().int().nonnegative(),
  expires_at: z.string(),
  created_at: z.string(),
  media: z.array(ReviewMediaSchema),
})
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>

// Review pages retain their existing display model while the v2 resource API uses camelCase.
const JavaReviewMediaSchema = z.object({
  id: z.string(), relativePath: z.string(), mimeType: z.string(), sizeBytes: z.number().nonnegative(), sha256: z.string(), status: z.string(),
  downloadUrl: z.string().nullable().optional(), downloadUrlExpiresAt: z.string().nullable().optional(),
})
const JavaReviewPackageSchema = z.object({
  id: z.string(), workspaceId: z.string(), desktopPackageId: z.string(), title: z.string(), status: z.string(), manifestJson: z.string(),
  storageBytes: z.number().nonnegative(), syncCursor: z.number().int().nonnegative(), expiresAt: z.string(), createdAt: z.string(), media: z.array(JavaReviewMediaSchema),
})
function reviewPackageFromJava(value: unknown): ReviewPackage {
  const item = JavaReviewPackageSchema.parse(value)
  return ReviewPackageSchema.parse({
    id: item.id, workspace_id: item.workspaceId, desktop_package_id: item.desktopPackageId, title: item.title, status: item.status,
    manifest_json: item.manifestJson, storage_bytes: item.storageBytes, sync_cursor: item.syncCursor, expires_at: item.expiresAt, created_at: item.createdAt,
    media: item.media.map((media) => ({ id: media.id, relative_path: media.relativePath, mime_type: media.mimeType, size_bytes: media.sizeBytes, sha256: media.sha256, status: media.status, download_url: media.downloadUrl ?? '', download_url_expires_at: media.downloadUrlExpiresAt ?? '' })),
  })
}

export const ReviewCommentSchema = z.object({
  id: z.string(),
  package_id: z.string(),
  client_id: z.string(),
  shot_id: z.string(),
  timecode_seconds: z.number().nonnegative(),
  author_alias: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  cursor: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ReviewComment = z.infer<typeof ReviewCommentSchema>

export const ReviewDecisionSchema = z.object({
  id: z.string(),
  package_id: z.string(),
  client_id: z.string(),
  shot_id: z.string(),
  decision: z.enum(['approve', 'return', 'request_changes', 'note']),
  author_alias: z.string(),
  note: z.string(),
  cursor: z.number().int().nonnegative(),
  created_at: z.string(),
})
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>

const JavaReviewCommentSchema = z.object({
  id: z.string(), packageId: z.string(), clientId: z.string(), shotId: z.string(), timecodeSeconds: z.number().nonnegative(), authorAlias: z.string(), body: z.string(), resolved: z.boolean(), cursor: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
})
const JavaReviewDecisionSchema = z.object({
  id: z.string(), packageId: z.string(), clientId: z.string(), shotId: z.string(), decision: z.enum(['approve', 'return', 'request_changes', 'note']), authorAlias: z.string(), note: z.string(), cursor: z.number().int().nonnegative(), createdAt: z.string(),
})
function javaReviewComment(value: unknown): ReviewComment {
  const item = JavaReviewCommentSchema.parse(value)
  return { id: item.id, package_id: item.packageId, client_id: item.clientId, shot_id: item.shotId, timecode_seconds: item.timecodeSeconds, author_alias: item.authorAlias, body: item.body, resolved: item.resolved, cursor: item.cursor, created_at: item.createdAt, updated_at: item.updatedAt }
}
function javaReviewDecision(value: unknown): ReviewDecision {
  const item = JavaReviewDecisionSchema.parse(value)
  return { id: item.id, package_id: item.packageId, client_id: item.clientId, shot_id: item.shotId, decision: item.decision, author_alias: item.authorAlias, note: item.note, cursor: item.cursor, created_at: item.createdAt }
}

export interface ApiClientOptions {
  baseURL: string
  getAccessToken?: () => string | undefined | Promise<string | undefined>
  getDeviceID?: () => string | undefined | Promise<string | undefined>
  getCSRFToken?: () => string | undefined | Promise<string | undefined>
  withCredentials?: boolean
  /**
   * Web is the only public client that exchanges credentials for an HttpOnly
   * Cookie session. Native clients keep using the token response contract.
   */
  webSession?: boolean
}

export function resolveApiRequestURL(baseURL: string, path: string): string {
  const normalizedPath = `/${path.replace(/^\/+/, '')}`
  const normalizedBaseURL = baseURL.trim().replace(/\/+$/, '')
  return normalizedBaseURL ? `${normalizedBaseURL}${normalizedPath}` : normalizedPath
}

export interface DramaIpApiClient {
  http: AxiosInstance
  register(input: { email: string; password: string; display_name?: string }): Promise<RegisterResponse>
  login(input: { email: string; password: string }): Promise<LoginResponse>
  requestEmailVerification(): Promise<EmailActionResponse>
  verifyEmail(input: { code: string }): Promise<EmailActionResponse>
  requestPasswordReset(input: { email: string }): Promise<EmailActionResponse>
  resetPassword(input: { email: string; code: string; password: string }): Promise<EmailActionResponse>
  getSession(): Promise<LoginResponse>
  getHealth(): Promise<Health>
  getPlans(): Promise<PlansResponse>
  getProfile(): Promise<Profile>
  updateProfile(input: { display_name: string; phone?: string; avatar_url?: string; locale?: string; timezone?: string }): Promise<Profile>
  getDashboard(): Promise<Dashboard>
  getTokenBalance(): Promise<TokenBalance>
  getSubscription(): Promise<Subscription>
  getOrders(): Promise<OrdersResponse>
  getOrder(orderID: string): Promise<Order>
  getTokenUsage(input?: { limit?: number }): Promise<TokenUsageResponse>
  getUsageTrend(input?: { days?: number }): Promise<UsageTrendResponse>
  getNotifications(): Promise<NotificationsResponse>
  markNotificationRead(notificationID: string): Promise<Notification>
  getAccountBootstrap(input?: Partial<AccountBootstrapQuery>): Promise<AccountBootstrap>
  getAccountReport(): Promise<AccountReport>
	createCheckout(input: { plan_id: string; channel: PaymentProvider }): Promise<CheckoutResponse>
  confirmSimulatedPayment(input: { checkout_id: string }): Promise<PaymentConfirmationResponse>
  confirmSandboxPayment(input: { checkout_id: string }): Promise<SandboxPaymentResponse>
  cancelSubscription(input?: { immediate?: boolean }): Promise<Subscription>
  resumeSubscription(input?: { subscription_id?: string; idempotency_key?: string }): Promise<Subscription>
  changeSubscriptionPlan(input: { subscription_id?: string; plan_id: string; idempotency_key?: string }): Promise<Subscription>
  requestRefund(input?: { subscription_id?: string; reason?: string; idempotency_key?: string }): Promise<Refund>
  getWorkspaces(): Promise<{ workspaces: Workspace[] }>
  getWorkspaceMembers(workspaceID: string): Promise<{ members: WorkspaceMember[] }>
  getWorkspaceInvitations(workspaceID: string): Promise<{ invitations: WorkspaceInvitation[] }>
  inviteWorkspaceMember(input: { workspace_id: string; email: string; role: 'admin' | 'member'; expires_in_hours?: number }): Promise<WorkspaceInvitation>
  updateWorkspaceMember(input: { workspace_id: string; member_user_id: string; role: 'admin' | 'member' }): Promise<WorkspaceMember>
  removeWorkspaceMember(input: { workspace_id: string; member_user_id: string }): Promise<WorkspaceMember>
  revokeWorkspaceInvitation(input: { workspace_id: string; invitation_id: string }): Promise<WorkspaceInvitation>
  acceptWorkspaceInvitation(token: string): Promise<WorkspaceMember>
  getPublicReview(input: { token: string; pin?: string }): Promise<{ package: ReviewPackage }>
  submitPublicReviewComment(input: { token: string; pin?: string; client_id: string; shot_id: string; timecode_seconds: number; author_alias: string; body: string }): Promise<ReviewComment>
  submitPublicReviewDecision(input: { token: string; pin?: string; client_id: string; shot_id: string; decision: 'approve' | 'return' | 'request_changes' | 'note'; author_alias: string; note?: string }): Promise<ReviewDecision>
  refresh(): Promise<LoginResponse>
  logout(): Promise<LogoutResponse>
  getChatModels(): Promise<ChatModelsResponse>
  preflightChat(input: Omit<ChatInput, 'request_id' | 'idempotency_key'>): Promise<ChatPreflightResponse>
  chat(input: ChatInput & { preflight_request_hash: string }): Promise<ChatResponse>
  streamChat(input: ChatStreamInput, options?: { signal?: AbortSignal; onEvent?: (event: ChatStreamEvent) => void }): Promise<void>
  cancelChat(input: { idempotency_key: string }): Promise<{ status: string }>
  getChatStatus(input: { idempotency_key: string }): Promise<ChatResponse>
}

export function createApiClient(options: ApiClientOptions): DramaIpApiClient {
  const http = axios.create({ baseURL: options.baseURL, withCredentials: options.withCredentials ?? false })

  http.interceptors.request.use(async (config) => {
    config.headers[API_CONTRACT_HEADER] = API_CONTRACT_VERSION
    config.headers['X-Request-Id'] = globalThis.crypto?.randomUUID?.() ?? `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const token = await options.getAccessToken?.()
    if (token) config.headers.Authorization = `Bearer ${token}`
    const deviceID = await options.getDeviceID?.()
    if (deviceID) config.headers['X-Device-Id'] = deviceID
    const csrfToken = await options.getCSRFToken?.()
    if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken
    if (options.webSession) config.headers['X-DramaIP-Web-Session'] = '1'
    return config
  })

  http.interceptors.response.use((response) => {
    const envelope = ResultSchema(z.unknown()).parse(response.data)
    if (envelope.code !== 'OK') throw new Error(`${envelope.code}: ${envelope.message}`)
    response.data = envelope.data
    return response
  })

  return {
    http,
    async register(input) {
      const res = await http.post('/api/v1/auth/register', input)
      return RegisterResponseSchema.parse(res.data)
    },
    async login(input) {
      const res = await http.post('/api/v1/auth/token', input)
      return LoginResponseSchema.parse(res.data)
    },
    async requestEmailVerification() {
      const res = await http.post('/api/v1/auth/email-verification/request')
      return EmailActionResponseSchema.parse(res.data)
    },
    async verifyEmail(input) {
      const res = await http.post('/api/v1/auth/email-verification/confirm', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async requestPasswordReset(input) {
      const res = await http.post('/api/v1/auth/password-reset/request', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async resetPassword(input) {
      const res = await http.post('/api/v1/auth/password-reset/confirm', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async getSession() {
      const res = await http.get('/api/v1/auth/session')
      return LoginResponseSchema.parse(res.data)
    },
    async getHealth() {
      const res = await http.get('/internal/v1/health')
      return HealthSchema.parse(res.data)
    },
    async getPlans() {
      const res = await http.get('/api/v1/plans')
      return plansFromJava(res.data)
    },
    async getProfile() {
      const res = await http.get('/api/v1/users/me/profile')
      return profileFromJava(res.data)
    },
    async updateProfile(input) {
      const res = await http.patch('/api/v1/users/me/profile', {
        displayName: input.display_name, avatarUrl: input.avatar_url, locale: input.locale, timezone: input.timezone,
      })
      return profileFromJava(res.data)
    },
    async getDashboard() {
      const res = await http.get('/api/v1/users/me/context')
      return DashboardSchema.parse(res.data)
    },
    async getTokenBalance() {
      const res = await http.get('/api/v1/quota/balance')
      return tokenBalanceFromJava(res.data)
    },
    async getSubscription() {
      const res = await http.get('/api/v1/subscriptions/current')
      return subscriptionFromJava(res.data)
    },
    async getOrders() {
      const res = await http.get('/api/v1/orders')
      return ordersFromJava(res.data)
    },
    async getOrder(orderID) {
      const res = await http.get(`/api/v1/orders/${encodeURIComponent(orderID)}`)
      return orderFromJava(res.data)
    },
    async getTokenUsage(input = {}) {
      const res = await http.get('/api/v1/quota/usage', { params: ListQuerySchema.parse(input) })
      return tokenUsageFromJava(res.data)
    },
    async getUsageTrend(input = {}) {
      const res = await http.get('/api/v1/quota/usage/trend', { params: UsageTrendQuerySchema.parse(input) })
      return usageTrendFromJava(res.data)
    },
    async getNotifications() {
      const res = await http.get('/api/v1/notifications')
      return notificationsFromJava(res.data)
    },
    async markNotificationRead(notificationID) {
      const res = await http.post(`/api/v1/notifications/${encodeURIComponent(notificationID)}/read`)
      return notificationFromJava(res.data)
    },
    async getAccountBootstrap(input = {}) {
      const query = AccountBootstrapQuerySchema.parse(input)
      const generatedAt = new Date().toISOString()
      const [profile, subscription, tokenBalance, orders, usage, usageTrend, notifications] = await Promise.all([
        accountSection(generatedAt, async () => profileFromJava((await http.get('/api/v1/users/me/profile')).data)),
        accountSection(generatedAt, async () => subscriptionFromJava((await http.get('/api/v1/subscriptions/current')).data)),
        accountSection(generatedAt, async () => tokenBalanceFromJava((await http.get('/api/v1/quota/balance')).data)),
        accountSection(generatedAt, async () => ordersFromJava((await http.get('/api/v1/orders')).data)),
        accountSection(generatedAt, async () => tokenUsageFromJava((await http.get('/api/v1/quota/usage', { params: { limit: query.usage_limit } })).data)),
        accountSection(generatedAt, async () => usageTrendFromJava((await http.get('/api/v1/quota/usage/trend', { params: { days: query.trend_days } })).data)),
        accountSection(generatedAt, async () => notificationsFromJava((await http.get('/api/v1/notifications')).data)),
      ])
      return AccountBootstrapSchema.parse({
        generated_at: generatedAt, cache_ttl_seconds: 30, usage_limit: query.usage_limit, trend_days: query.trend_days,
        sections: { profile, subscription, token_balance: tokenBalance, orders, usage, usage_trend: usageTrend, notifications },
      })
    },
    async getAccountReport() {
      const res = await http.get('/api/v1/reports/me')
      return AccountReportSchema.parse(res.data)
    },
    async createCheckout(input) {
      const res = await http.post('/api/v1/orders', input)
      return CheckoutResponseSchema.parse(res.data)
    },
    async confirmSimulatedPayment(input) {
      const res = await http.post('/api/v1/payments/simulated/confirm', input)
      return PaymentConfirmationResponseSchema.parse(res.data)
    },
    async confirmSandboxPayment(input) {
      return this.confirmSimulatedPayment(input)
    },
    async cancelSubscription(input = {}) {
      const res = await http.post('/api/v1/subscriptions/current/cancel', input)
      return SubscriptionSchema.parse(res.data)
    },
    async resumeSubscription(input = {}) {
      const res = await http.post('/api/v1/subscriptions/current/resume', input)
      return SubscriptionSchema.parse(res.data)
    },
    async changeSubscriptionPlan(input) {
      const res = await http.post('/api/v1/subscriptions/current/plan', input)
      return SubscriptionSchema.parse(res.data)
    },
    async requestRefund(input = {}) {
      const res = await http.post('/api/v1/refunds', input)
      return RefundSchema.parse(res.data)
    },
    async getWorkspaces() {
      const res = await http.get('/api/v1/workspaces')
      return z.object({ workspaces: z.array(WorkspaceSchema) }).parse(res.data)
    },
    async getWorkspaceMembers(workspaceID) {
      const res = await http.get('/api/v1/workspaces/members', { params: { workspace_id: workspaceID } })
      return z.object({ members: z.array(WorkspaceMemberSchema) }).parse(res.data)
    },
    async getWorkspaceInvitations(workspaceID) {
      const res = await http.get('/api/v1/workspaces/invitations', { params: { workspace_id: workspaceID } })
      return z.object({ invitations: z.array(WorkspaceInvitationSchema) }).parse(res.data)
    },
    async inviteWorkspaceMember(input) {
      const { workspace_id, ...body } = input
      const res = await http.post('/api/v1/workspaces/invitations', body, { params: { workspace_id } })
      return WorkspaceInvitationSchema.parse(res.data)
    },
    async updateWorkspaceMember(input) {
      const { workspace_id, ...body } = input
      const res = await http.patch('/api/v1/workspaces/members', body, { params: { workspace_id } })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async removeWorkspaceMember(input) {
      const res = await http.delete('/api/v1/workspaces/members', {
        params: { workspace_id: input.workspace_id, member_user_id: input.member_user_id },
      })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async revokeWorkspaceInvitation(input) {
      const res = await http.delete('/api/v1/workspaces/invitations', {
        params: { workspace_id: input.workspace_id, invitation_id: input.invitation_id },
      })
      return WorkspaceInvitationSchema.parse(res.data)
    },
    async acceptWorkspaceInvitation(token) {
      const res = await http.post('/api/v1/workspace-invitations/accept', { token })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async getPublicReview(input) {
      const res = await http.get(`/api/v1/review-packages/public/${encodeURIComponent(input.token)}`, { params: input.pin ? { pin: input.pin } : undefined })
      return { package: reviewPackageFromJava(res.data) }
    },
    async submitPublicReviewComment(input) {
      const { token, ...body } = input
      const res = await http.post(`/api/v1/review-packages/public/${encodeURIComponent(token)}/comments`, body, {
        headers: { 'Idempotency-Key': input.client_id },
      })
      return ReviewCommentSchema.parse(javaReviewComment(res.data))
    },
    async submitPublicReviewDecision(input) {
      const { token, ...body } = input
      const res = await http.post(`/api/v1/review-packages/public/${encodeURIComponent(token)}/decisions`, body, {
        headers: { 'Idempotency-Key': input.client_id },
      })
      return ReviewDecisionSchema.parse(javaReviewDecision(res.data))
    },
    async refresh() {
      const res = await http.post('/api/v1/auth/token/refresh')
      return LoginResponseSchema.parse(res.data)
    },
    async logout() {
      const res = await http.post('/api/v1/auth/token/revoke')
      return LogoutResponseSchema.parse(res.data)
    },
    async getChatModels() {
      const res = await http.get('/api/v1/models')
      return ChatModelsResponseSchema.parse(res.data)
    },
    async preflightChat(input) {
      const res = await http.post('/api/v1/preflight', javaChatBody(input))
      return ChatPreflightResponseSchema.parse(res.data)
    },
    async chat(input) {
      const { idempotency_key, ...body } = input
      const idempotencyKey = idempotency_key ?? input.request_id
      const res = await http.post('/api/v1/chats', javaChatBody(body), {
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
      return ChatResponseSchema.parse(res.data)
    },
    async streamChat(input, streamOptions = {}) {
      const { idempotency_key, ...body } = input
      const idempotencyKey = idempotency_key ?? input.request_id
      const headers: Record<string, string> = {
        [API_CONTRACT_HEADER]: API_CONTRACT_VERSION,
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      }
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      const token = await options.getAccessToken?.()
      if (token) headers.Authorization = `Bearer ${token}`
      const deviceID = await options.getDeviceID?.()
      if (deviceID) headers['X-Device-Id'] = deviceID
      const csrfToken = await options.getCSRFToken?.()
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken
      const response = await fetch(resolveApiRequestURL(options.baseURL, '/api/v1/stream'), {
        method: 'POST', headers, body: JSON.stringify(javaChatBody(body)), signal: streamOptions.signal,
        credentials: options.withCredentials === false ? 'omit' : 'include',
      })
      if (!response.ok || !response.body) {
        throw new Error((await response.text()).slice(0, 512) || 'chat_stream_unavailable')
      }
      await readSSE(response.body, (event) => streamOptions.onEvent?.(ChatStreamEventSchema.parse(event)))
    },
    async cancelChat(input) {
      const res = await http.post('/api/v1/cancel', { idempotencyKey: input.idempotency_key })
      return z.object({ status: z.string() }).parse(res.data)
    },
    async getChatStatus(input) {
      const res = await http.get('/api/v1/chats/status', { params: { idempotencyKey: input.idempotency_key } })
      return ChatResponseSchema.parse(res.data)
    },
  }
}

/** Converts the TypeScript input spelling at the client boundary only. */
function javaChatBody(input: { model?: string; messages?: ChatMessage[]; max_tokens?: number; maxTokens?: number }) {
  return { model: input.model, messages: input.messages, maxTokens: input.maxTokens ?? input.max_tokens }
}

async function readSSE(stream: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let boundary = pending.indexOf('\n\n')
      while (boundary >= 0) {
        const block = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const data = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
        const type = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
        if (data && type) onEvent({ type, ...JSON.parse(data) })
        boundary = pending.indexOf('\n\n')
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
