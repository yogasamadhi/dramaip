import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

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

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cny: z.number(),
  quota_tokens: z.number(),
  description: z.string(),
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

export interface ApiClientOptions {
  baseURL: string
  getAccessToken?: () => string | undefined | Promise<string | undefined>
  getDeviceID?: () => string | undefined | Promise<string | undefined>
  getCSRFToken?: () => string | undefined | Promise<string | undefined>
  withCredentials?: boolean
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
  getAccountReport(): Promise<AccountReport>
	createCheckout(input: { plan_id: string; channel: PaymentProvider }): Promise<CheckoutResponse>
  confirmSimulatedPayment(input: { checkout_id: string }): Promise<PaymentConfirmationResponse>
  confirmSandboxPayment(input: { checkout_id: string }): Promise<SandboxPaymentResponse>
  cancelSubscription(input?: { immediate?: boolean }): Promise<Subscription>
  resumeSubscription(input?: { subscription_id?: string; idempotency_key?: string }): Promise<Subscription>
  changeSubscriptionPlan(input: { subscription_id?: string; plan_id: string; idempotency_key?: string }): Promise<Subscription>
  requestRefund(input?: { subscription_id?: string; reason?: string; idempotency_key?: string }): Promise<Refund>
  refresh(): Promise<LoginResponse>
  logout(): Promise<LogoutResponse>
  chat(input: { request_id?: string; idempotency_key?: string; provider?: string; model?: string; messages: ChatMessage[]; max_tokens?: number }): Promise<ChatResponse>
}

export function createApiClient(options: ApiClientOptions): DramaIpApiClient {
  const http = axios.create({ baseURL: options.baseURL, withCredentials: options.withCredentials ?? false })

  http.interceptors.request.use(async (config) => {
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
      const res = await http.get('/v1/me/token-usage', { params: input })
      return TokenUsageResponseSchema.parse(res.data)
    },
    async getUsageTrend(input = {}) {
      const res = await http.get('/v1/me/usage-trend', { params: input })
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
    async refresh() {
      const res = await http.post('/v1/auth/refresh')
      return LoginResponseSchema.parse(res.data)
    },
    async logout() {
      const res = await http.post('/v1/auth/logout')
      return LogoutResponseSchema.parse(res.data)
    },
    async chat(input) {
      const { idempotency_key, ...body } = input
      const idempotencyKey = idempotency_key ?? input.request_id
      const res = await http.post('/v1/ai/chat', body, {
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
      return ChatResponseSchema.parse(res.data)
    },
  }
}
