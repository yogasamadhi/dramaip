import { z } from 'zod'

// Contract v2 is deliberately breaking: Java exposes only /api/v1 resources.
export const API_CONTRACT_VERSION = '2' as const
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

// The account read model intentionally makes its two potentially expensive
// windows explicit. Defaults match the account UI, while validation prevents
// callers from quietly asking the API for unbounded histories.
export const AccountBootstrapQuerySchema = z.object({
  usage_limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  trend_days: z.number().int().min(1).max(MAX_USAGE_TREND_DAYS).default(30),
})
export type AccountBootstrapQuery = z.infer<typeof AccountBootstrapQuerySchema>

export const ResultSchema = <T extends z.ZodType>(data: T) => z.object({
  code: z.string().min(1),
  message: z.string(),
  data,
  requestId: z.string(),
  traceId: z.string(),
})
export type Result<T> = { code: string; message: string; data: T; requestId: string; traceId: string }

export const ContractErrorSchema = ResultSchema(z.null())
export type ContractError = z.infer<typeof ContractErrorSchema>

export function contractHeaders(headers: HeadersInit = {}): HeadersInit {
  return { [API_CONTRACT_HEADER]: API_CONTRACT_VERSION, ...headers }
}

export function contractErrorCode(payload: unknown): string | undefined {
  return ContractErrorSchema.safeParse(payload).data?.code
}

const IdentifierSchema = z.string().min(1)
const NonnegativeIntegerSchema = z.number().int().nonnegative()
const PositiveIntegerSchema = z.number().int().positive()

export const MobileUserSchema = z.object({ id: IdentifierSchema, name: z.string() })
export const MobileSessionSchema = z.object({
  accessToken: IdentifierSchema,
  refreshToken: IdentifierSchema,
  expiresIn: PositiveIntegerSchema,
  tokenType: z.literal('Bearer'),
  userId: IdentifierSchema,
  email: z.string().email(),
  name: z.string(),
})
export const MobileBriefSchema = z.object({
  profile: z.object({ id: IdentifierSchema, displayName: z.string() }),
  workspaces: z.array(z.object({ planCode: z.string() })),
})
export const MobileDraftSchema = z.object({
  id: IdentifierSchema,
  clientId: IdentifierSchema,
  kind: z.enum(['inspiration', 'character', 'project']),
  captureMode: z.enum(['text', 'voice']),
  title: IdentifierSchema,
  content: IdentifierSchema,
  aiExpansion: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const MobileDraftsResponseSchema = z.array(MobileDraftSchema)
export const MobileDraftResponseSchema = MobileDraftSchema
export const MobileDraftPageSchema = z.array(MobileDraftSchema)
export const MobileDraftDeleteResponseSchema = z.null()
export const MobileExpansionResponseSchema = z.object({ content: IdentifierSchema })
export const AiModelsSchema = z.array(IdentifierSchema)
export const AiChatSchema = z.object({ requestId: IdentifierSchema, content: IdentifierSchema, model: IdentifierSchema, totalTokens: NonnegativeIntegerSchema, status: IdentifierSchema })
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
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserSummarySchema), next_cursor: z.string().default('') })
export const AdminOrdersResponseSchema = z.object({ orders: z.array(AdminOrderSummarySchema), next_cursor: z.string().default('') })
export const AdminSubscriptionsResponseSchema = z.object({ subscriptions: z.array(AdminSubscriptionSummarySchema), next_cursor: z.string().default('') })
export const AdminExceptionsResponseSchema = z.object({ exceptions: z.array(AdminProjectionExceptionSchema), next_cursor: z.string().default('') })
export const AdminAuditResponseSchema = z.object({ entries: z.array(AdminAuditEntrySchema) })
export const AdminCustomerProfileSchema = z.object({ id: IdentifierSchema, email: z.string(), phone: z.string(), display_name: z.string(), status: z.enum(['active', 'suspended']), locale: z.string(), timezone: z.string() })
export const AdminCustomerSubscriptionSchema = z.object({ id: IdentifierSchema, user_id: IdentifierSchema, plan_code: z.string(), status: z.string(), period_start: z.string(), period_end: z.string(), cancel_at_period_end: z.boolean(), lifecycle_error: z.string() })
export const AdminCustomerOrderSchema = z.object({ id: IdentifierSchema, plan_code: z.string(), provider: z.string(), status: z.string(), amount: z.string(), currency: z.string(), subscription_id: z.string(), created_at: z.string() })
export const AdminQuotaBalanceSchema = z.object({ plan: z.string(), quota_tokens: NonnegativeIntegerSchema, used_tokens: NonnegativeIntegerSchema, remaining_tokens: NonnegativeIntegerSchema, period_start: z.string(), period_end: z.string() })
export const AdminTokenUsageSchema = z.object({ id: IdentifierSchema, request_id: z.string(), model: z.string(), total_tokens: NonnegativeIntegerSchema, status: z.string(), created_at: z.string() })
export const AdminNotificationSchema = z.object({ id: IdentifierSchema, type: z.string(), title: z.string(), body: z.string(), source_event_id: z.string(), read_at: z.string(), created_at: z.string() })
export const AdminCustomerResponseSchema = z.object({ profile: AdminCustomerProfileSchema, subscription: AdminCustomerSubscriptionSchema.nullable(), orders: z.array(AdminCustomerOrderSchema), balance: AdminQuotaBalanceSchema.nullable(), usage: z.array(AdminTokenUsageSchema), notifications: z.array(AdminNotificationSchema) })
export const AdminCostAlertSchema = z.object({ id: IdentifierSchema, audit_id: IdentifierSchema, user_id: IdentifierSchema, event_type: z.string(), observed_cost_cny: z.string(), threshold_cny: z.string(), trace_id: z.string(), created_at: z.string() })
export const AdminCostAlertsResponseSchema = z.object({ alerts: z.array(AdminCostAlertSchema) })
export const AdminProfileResponseSchema = z.object({ profile: AdminCustomerProfileSchema })
export const AdminRefundResponseSchema = z.object({ refund: z.object({ id: IdentifierSchema, subscription_id: IdentifierSchema, status: z.string(), used_tokens: NonnegativeIntegerSchema, quota_hold_status: z.string() }) })
export const AdminSubscriptionResponseSchema = z.object({ subscription: AdminCustomerSubscriptionSchema })
export const AdminQuotaAdjustmentResponseSchema = z.object({ adjustment: z.object({ id: IdentifierSchema, delta_tokens: z.number().int(), quota_before: NonnegativeIntegerSchema, quota_after: NonnegativeIntegerSchema, status: z.string() }) })
export const AdminNotificationResponseSchema = z.object({ notification: AdminNotificationSchema })
export const AdminReconciliationRunSchema = z.object({ id: IdentifierSchema, trigger: z.string(), requested_by: z.string(), status: z.string(), scanned_items: NonnegativeIntegerSchema, detected_items: NonnegativeIntegerSchema, started_at: z.string(), completed_at: z.string(), failure: z.string() })
export const AdminReconciliationItemSchema = z.object({ id: IdentifierSchema, order_id: z.string(), subscription_id: z.string(), mismatch_type: z.string(), severity: z.string(), recommendation: z.string(), status: z.string(), occurrences: NonnegativeIntegerSchema, first_detected_at: z.string(), last_detected_at: z.string(), resolved_at: z.string(), resolved_by: z.string(), resolution_note: z.string() })
export const AdminReconciliationSchema = z.object({ latest_run: AdminReconciliationRunSchema.nullable(), items: z.array(AdminReconciliationItemSchema) })
export const AdminReconciliationRunResponseSchema = z.object({ run: AdminReconciliationRunSchema })
export const AdminReconciliationActionResponseSchema = z.object({ action: z.object({ id: IdentifierSchema, item_id: IdentifierSchema, action: z.string(), status: z.string(), outcome_json: z.string(), created_at: z.string(), completed_at: z.string() }) })
export const AdminDeliveryAttemptSchema = z.object({ id: IdentifierSchema, event_id: z.string(), notification_id: IdentifierSchema, user_id: IdentifierSchema, channel: z.string(), status: z.string(), failure: z.string(), attempted_at: z.string() })
export const AdminDeliveryAttemptsResponseSchema = z.object({ attempts: z.array(AdminDeliveryAttemptSchema) })
export const AdminDeliveryRetryResponseSchema = z.object({ event_id: z.string(), notification_id: IdentifierSchema, status: z.string() })
export type AdminPrincipal = z.infer<typeof AdminPrincipalSchema>
export type AdminOverview = z.infer<typeof AdminOverviewSchema>
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>
export type AdminOrderSummary = z.infer<typeof AdminOrderSummarySchema>
export type AdminSubscriptionSummary = z.infer<typeof AdminSubscriptionSummarySchema>
export type AdminProjectionException = z.infer<typeof AdminProjectionExceptionSchema>
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>
export type AdminCustomer = z.infer<typeof AdminCustomerResponseSchema>
export type AdminCostAlert = z.infer<typeof AdminCostAlertSchema>
export type AdminReconciliation = z.infer<typeof AdminReconciliationSchema>
export type AdminDeliveryAttempt = z.infer<typeof AdminDeliveryAttemptSchema>

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
