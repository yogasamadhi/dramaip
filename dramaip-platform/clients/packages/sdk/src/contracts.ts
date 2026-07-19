import { z } from 'zod'

// Every public BFF accepts a missing version during the v1 compatibility
// window, but shipped clients always declare the contract they understand.
export const API_CONTRACT_VERSION = '1' as const
export const API_CONTRACT_HEADER = 'X-DramaIP-Contract-Version' as const
export const DEFAULT_LIST_LIMIT = 50
export const MAX_LIST_LIMIT = 100
export const DEFAULT_USAGE_TREND_DAYS = 14
export const MAX_USAGE_TREND_DAYS = 365

export const ListQuerySchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
})
export type ListQuery = z.infer<typeof ListQuerySchema>

export const UsageTrendQuerySchema = z.object({
  days: z.number().int().min(1).max(MAX_USAGE_TREND_DAYS).default(DEFAULT_USAGE_TREND_DAYS),
})
export type UsageTrendQuery = z.infer<typeof UsageTrendQuerySchema>

export const ContractErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    trace_id: z.string().min(1),
  }),
})
export type ContractError = z.infer<typeof ContractErrorSchema>

export function contractHeaders(headers: HeadersInit = {}): HeadersInit {
  return { [API_CONTRACT_HEADER]: API_CONTRACT_VERSION, ...headers }
}

export function contractErrorCode(payload: unknown): string | undefined {
  return ContractErrorSchema.safeParse(payload).data?.error.code
}

const IdentifierSchema = z.string().min(1)
const NonnegativeIntegerSchema = z.number().int().nonnegative()
const PositiveIntegerSchema = z.number().int().positive()

export const MobileUserSchema = z.object({ id: IdentifierSchema, name: IdentifierSchema })
export const MobileSessionSchema = z.object({
  access_token: IdentifierSchema,
  refresh_token: IdentifierSchema,
  expires_in: PositiveIntegerSchema,
  token_type: z.literal('Bearer'),
  user: MobileUserSchema,
})
export const MobileBriefSchema = z.object({
  display_name: IdentifierSchema,
  plan: IdentifierSchema,
  remaining_tokens: NonnegativeIntegerSchema,
})
export const MobileDraftSchema = z.object({
  id: IdentifierSchema,
  client_id: IdentifierSchema,
  kind: z.enum(['inspiration', 'character', 'project']),
  capture_mode: z.enum(['text', 'voice']),
  title: IdentifierSchema,
  content: IdentifierSchema,
  ai_expansion: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  adoption_count: NonnegativeIntegerSchema,
  last_adopted_at: z.string(),
})
export const MobileDraftsResponseSchema = z.object({ drafts: z.array(MobileDraftSchema) })
export const MobileDraftResponseSchema = z.object({ draft: MobileDraftSchema })
export const MobileDraftPageSchema = z.object({ drafts: z.array(MobileDraftSchema), next_cursor: z.string() })
export const MobileDraftDeleteResponseSchema = z.object({ draft_id: IdentifierSchema, deleted_at: z.string() })
export const MobileExpansionResponseSchema = z.object({ expansion: IdentifierSchema })
export type MobileSession = z.infer<typeof MobileSessionSchema>
export type MobileBrief = z.infer<typeof MobileBriefSchema>
export type MobileDraft = z.infer<typeof MobileDraftSchema>

export const AdminPrincipalSchema = z.object({
  id: IdentifierSchema,
  email: z.string().email(),
  status: IdentifierSchema,
  roles: z.array(IdentifierSchema),
  permissions: z.array(IdentifierSchema),
})
export const AdminOverviewSchema = z.object({
  user_count: NonnegativeIntegerSchema,
  paid_order_count: NonnegativeIntegerSchema,
  active_subscription_count: NonnegativeIntegerSchema,
  total_tokens: NonnegativeIntegerSchema,
  open_exception_count: NonnegativeIntegerSchema,
  last_event_at: z.string(),
})
export const AdminUserSummarySchema = z.object({ user_id: IdentifierSchema, first_seen_at: z.string(), last_seen_at: z.string(), total_tokens: NonnegativeIntegerSchema, last_plan_code: z.string() })
export const AdminOrderSummarySchema = z.object({ order_id: IdentifierSchema, user_id: IdentifierSchema, plan_code: z.string(), provider: z.string(), amount: z.string(), currency: z.string(), status: z.string(), subscription_id: z.string(), updated_at: z.string() })
export const AdminSubscriptionSummarySchema = z.object({ subscription_id: IdentifierSchema, user_id: IdentifierSchema, plan_code: z.string(), status: z.string(), period_start: z.string(), period_end: z.string(), updated_at: z.string() })
export const AdminProjectionExceptionSchema = z.object({ id: IdentifierSchema, event_id: z.string(), event_type: z.string(), status: z.string(), summary: z.string(), trace_id: z.string(), created_at: z.string(), resolved_at: z.string(), resolved_by: z.string(), resolution_reason: z.string() })
export const AdminAuditEntrySchema = z.object({ id: IdentifierSchema, actor_id: z.string(), action: z.string(), resource_type: z.string(), resource_id: z.string(), reason: z.string(), trace_id: z.string(), created_at: z.string() })
export const AdminLoginResponseSchema = z.object({ access_token: IdentifierSchema, expires_in: PositiveIntegerSchema, principal: AdminPrincipalSchema })
export const AdminConfirmationResponseSchema = z.object({ confirmation: z.object({ id: IdentifierSchema }) })
export const AdminExceptionResolutionResponseSchema = z.object({ exception: AdminProjectionExceptionSchema })
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserSummarySchema) })
export const AdminOrdersResponseSchema = z.object({ orders: z.array(AdminOrderSummarySchema) })
export const AdminSubscriptionsResponseSchema = z.object({ subscriptions: z.array(AdminSubscriptionSummarySchema) })
export const AdminExceptionsResponseSchema = z.object({ exceptions: z.array(AdminProjectionExceptionSchema) })
export const AdminAuditResponseSchema = z.object({ entries: z.array(AdminAuditEntrySchema) })
export type AdminPrincipal = z.infer<typeof AdminPrincipalSchema>
export type AdminOverview = z.infer<typeof AdminOverviewSchema>
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>
export type AdminOrderSummary = z.infer<typeof AdminOrderSummarySchema>
export type AdminSubscriptionSummary = z.infer<typeof AdminSubscriptionSummarySchema>
export type AdminProjectionException = z.infer<typeof AdminProjectionExceptionSchema>
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>

// Desktop receives only cloud-account, model, preflight, chat and handoff
// shapes; it never receives the platform's internal project/core types.
export const DesktopCloudModelSchema = z.object({ provider: IdentifierSchema, model: IdentifierSchema, is_default: z.boolean() })
export const DesktopCloudModelsResponseSchema = z.object({ models: z.array(DesktopCloudModelSchema) })
export const DesktopCloudPreflightResponseSchema = z.object({ model: DesktopCloudModelSchema, estimated_tokens: NonnegativeIntegerSchema, remaining_tokens: NonnegativeIntegerSchema, request_hash: IdentifierSchema })
export const DesktopCloudChatResponseSchema = z.object({ request_id: IdentifierSchema, content: IdentifierSchema, provider: IdentifierSchema, model: IdentifierSchema, total_tokens: NonnegativeIntegerSchema, remaining_tokens: NonnegativeIntegerSchema, status: IdentifierSchema })
export const DesktopCloudContextSchema = z.object({
  user: z.object({ id: IdentifierSchema, email: z.string().email(), name: IdentifierSchema }),
  subscription: z.object({ id: z.string(), plan: z.string(), status: z.string() }),
  token_balance: z.object({ plan: z.string(), quota_tokens: NonnegativeIntegerSchema, used_tokens: NonnegativeIntegerSchema, remaining_tokens: NonnegativeIntegerSchema }),
})
