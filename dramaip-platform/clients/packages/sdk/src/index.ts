import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'
import { API_CONTRACT_HEADER, API_CONTRACT_VERSION, AccountBootstrapQuerySchema, ListQuerySchema, UsageTrendQuerySchema, type AccountBootstrapQuery } from './contracts'

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
  // Older temporary-staging BFFs emitted null for a protobuf empty repeated
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

export interface ApiClientOptions {
  baseURL: string
  getAccessToken?: () => string | undefined | Promise<string | undefined>
  getDeviceID?: () => string | undefined | Promise<string | undefined>
  getCSRFToken?: () => string | undefined | Promise<string | undefined>
  withCredentials?: boolean
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
    const token = await options.getAccessToken?.()
    if (token) config.headers.Authorization = `Bearer ${token}`
    const deviceID = await options.getDeviceID?.()
    if (deviceID) config.headers['X-Device-Id'] = deviceID
    const csrfToken = await options.getCSRFToken?.()
    if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken
    return config
  })

  return {
    http,
    async register(input) {
      const res = await http.post('/v1/auth/register', input)
      return RegisterResponseSchema.parse(res.data)
    },
    async login(input) {
      const res = await http.post('/v1/auth/login', input)
      return LoginResponseSchema.parse(res.data)
    },
    async requestEmailVerification() {
      const res = await http.post('/v1/auth/email-verification/request')
      return EmailActionResponseSchema.parse(res.data)
    },
    async verifyEmail(input) {
      const res = await http.post('/v1/auth/email-verification/confirm', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async requestPasswordReset(input) {
      const res = await http.post('/v1/auth/password-reset/request', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async resetPassword(input) {
      const res = await http.post('/v1/auth/password-reset/confirm', input)
      return EmailActionResponseSchema.parse(res.data)
    },
    async getSession() {
      const res = await http.get('/v1/auth/session')
      return LoginResponseSchema.parse(res.data)
    },
    async getHealth() {
      const res = await http.get('/v1/healthz')
      return HealthSchema.parse(res.data)
    },
    async getPlans() {
      const res = await http.get('/v1/plans')
      return PlansResponseSchema.parse(res.data)
    },
    async getProfile() {
      const res = await http.get('/v1/me/profile')
      return ProfileSchema.parse(res.data)
    },
    async updateProfile(input) {
      const res = await http.patch('/v1/me/profile', input)
      return ProfileSchema.parse(res.data)
    },
    async getDashboard() {
      const res = await http.get('/v1/me/dashboard')
      return DashboardSchema.parse(res.data)
    },
    async getTokenBalance() {
      const res = await http.get('/v1/me/token-balance')
      return TokenBalanceSchema.parse(res.data)
    },
    async getSubscription() {
      const res = await http.get('/v1/me/subscription')
      return SubscriptionSchema.parse(res.data)
    },
    async getOrders() {
      const res = await http.get('/v1/me/orders')
      return OrdersResponseSchema.parse(res.data)
    },
    async getOrder(orderID) {
      const res = await http.get(`/v1/me/orders/${encodeURIComponent(orderID)}`)
      return OrderSchema.parse(res.data)
    },
    async getTokenUsage(input = {}) {
      const res = await http.get('/v1/me/token-usage', { params: ListQuerySchema.parse(input) })
      return TokenUsageResponseSchema.parse(res.data)
    },
    async getUsageTrend(input = {}) {
      const res = await http.get('/v1/me/usage-trend', { params: UsageTrendQuerySchema.parse(input) })
      return UsageTrendResponseSchema.parse(res.data)
    },
    async getNotifications() {
      const res = await http.get('/v1/me/notifications')
      return NotificationsResponseSchema.parse(res.data)
    },
    async markNotificationRead(notificationID) {
      const res = await http.post(`/v1/me/notifications/${encodeURIComponent(notificationID)}/read`)
      return NotificationSchema.parse(res.data)
    },
    async getAccountBootstrap(input = {}) {
      const res = await http.get('/v1/me/account-bootstrap', { params: AccountBootstrapQuerySchema.parse(input) })
      return AccountBootstrapSchema.parse(res.data)
    },
    async getAccountReport() {
      const res = await http.get('/v1/me/account-report')
      return AccountReportSchema.parse(res.data)
    },
    async createCheckout(input) {
      const res = await http.post('/v1/billing/checkout', input)
      return CheckoutResponseSchema.parse(res.data)
    },
    async confirmSimulatedPayment(input) {
      const res = await http.post('/v1/billing/payments/simulated/confirm', input)
      return PaymentConfirmationResponseSchema.parse(res.data)
    },
    async confirmSandboxPayment(input) {
      return this.confirmSimulatedPayment(input)
    },
    async cancelSubscription(input = {}) {
      const res = await http.post('/v1/subscription/cancel', input)
      return SubscriptionSchema.parse(res.data)
    },
    async resumeSubscription(input = {}) {
      const res = await http.post('/v1/subscription/resume', input)
      return SubscriptionSchema.parse(res.data)
    },
    async changeSubscriptionPlan(input) {
      const res = await http.post('/v1/subscription/change-plan', input)
      return SubscriptionSchema.parse(res.data)
    },
    async requestRefund(input = {}) {
      const res = await http.post('/v1/subscription/refund', input)
      return RefundSchema.parse(res.data)
    },
    async getWorkspaces() {
      const res = await http.get('/v1/me/workspaces')
      return z.object({ workspaces: z.array(WorkspaceSchema) }).parse(res.data)
    },
    async getWorkspaceMembers(workspaceID) {
      const res = await http.get('/v1/me/workspaces/members', { params: { workspace_id: workspaceID } })
      return z.object({ members: z.array(WorkspaceMemberSchema) }).parse(res.data)
    },
    async getWorkspaceInvitations(workspaceID) {
      const res = await http.get('/v1/me/workspaces/invitations', { params: { workspace_id: workspaceID } })
      return z.object({ invitations: z.array(WorkspaceInvitationSchema) }).parse(res.data)
    },
    async inviteWorkspaceMember(input) {
      const { workspace_id, ...body } = input
      const res = await http.post('/v1/me/workspaces/invitations', body, { params: { workspace_id } })
      return WorkspaceInvitationSchema.parse(res.data)
    },
    async updateWorkspaceMember(input) {
      const { workspace_id, ...body } = input
      const res = await http.patch('/v1/me/workspaces/members', body, { params: { workspace_id } })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async removeWorkspaceMember(input) {
      const res = await http.delete('/v1/me/workspaces/members', {
        params: { workspace_id: input.workspace_id, member_user_id: input.member_user_id },
      })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async revokeWorkspaceInvitation(input) {
      const res = await http.delete('/v1/me/workspaces/invitations', {
        params: { workspace_id: input.workspace_id, invitation_id: input.invitation_id },
      })
      return WorkspaceInvitationSchema.parse(res.data)
    },
    async acceptWorkspaceInvitation(token) {
      const res = await http.post('/v1/me/workspace-invitations/accept', { token })
      return WorkspaceMemberSchema.parse(res.data)
    },
    async getPublicReview(input) {
      const res = await http.post('/v1/review/package', input)
      return z.object({ package: ReviewPackageSchema }).parse(res.data)
    },
    async submitPublicReviewComment(input) {
      const res = await http.post('/v1/review/comments', input, {
        headers: { 'Idempotency-Key': input.client_id },
      })
      return ReviewCommentSchema.parse(res.data)
    },
    async submitPublicReviewDecision(input) {
      const res = await http.post('/v1/review/decisions', input, {
        headers: { 'Idempotency-Key': input.client_id },
      })
      return ReviewDecisionSchema.parse(res.data)
    },
    async refresh() {
      const res = await http.post('/v1/auth/refresh')
      return LoginResponseSchema.parse(res.data)
    },
    async logout() {
      const res = await http.post('/v1/auth/logout')
      return LogoutResponseSchema.parse(res.data)
    },
    async getChatModels() {
      const res = await http.get('/v1/ai/models')
      return ChatModelsResponseSchema.parse(res.data)
    },
    async preflightChat(input) {
      const res = await http.post('/v1/ai/preflight', input)
      return ChatPreflightResponseSchema.parse(res.data)
    },
    async chat(input) {
      const { idempotency_key, ...body } = input
      const idempotencyKey = idempotency_key ?? input.request_id
      const res = await http.post('/v1/ai/chat', body, {
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
      const response = await fetch(resolveApiRequestURL(options.baseURL, '/v1/ai/chat/stream'), {
        method: 'POST', headers, body: JSON.stringify(body), signal: streamOptions.signal,
        credentials: options.withCredentials === false ? 'omit' : 'include',
      })
      if (!response.ok || !response.body) {
        throw new Error((await response.text()).slice(0, 512) || 'chat_stream_unavailable')
      }
      await readSSE(response.body, (event) => streamOptions.onEvent?.(ChatStreamEventSchema.parse(event)))
    },
    async cancelChat(input) {
      const res = await http.post('/v1/ai/chat/cancel', input)
      return z.object({ status: z.string() }).parse(res.data)
    },
    async getChatStatus(input) {
      const res = await http.get('/v1/ai/chat/status', { params: input })
      return ChatResponseSchema.parse(res.data)
    },
  }
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
