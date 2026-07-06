import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

export const TokenBalanceSchema = z.object({
  plan: z.string(),
  quota_tokens: z.number(),
  used_tokens: z.number(),
  remaining_tokens: z.number(),
  period_start: z.string(),
  period_end: z.string(),
})

export type TokenBalance = z.infer<typeof TokenBalanceSchema>

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const LoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  user: UserSchema,
})

export type LoginResponse = z.infer<typeof LoginResponseSchema>

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
})

export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatResponseSchema = z.object({
  content: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  reservation_id: z.string(),
  remaining_tokens: z.number(),
})

export type ChatResponse = z.infer<typeof ChatResponseSchema>

export interface ApiClientOptions {
  baseURL: string
  getAccessToken?: () => string | undefined | Promise<string | undefined>
}

export interface DramaIpApiClient {
  http: AxiosInstance
  login(input: { email: string; password: string }): Promise<LoginResponse>
  getHealth(): Promise<Health>
  getPlans(): Promise<PlansResponse>
  getDashboard(): Promise<Dashboard>
  getTokenBalance(): Promise<TokenBalance>
  createCheckout(input: { plan_id: string; channel?: string }): Promise<CheckoutResponse>
  chat(input: { provider?: string; model?: string; messages: ChatMessage[]; max_tokens?: number }): Promise<ChatResponse>
}

export function createApiClient(options: ApiClientOptions): DramaIpApiClient {
  const http = axios.create({ baseURL: options.baseURL })

  http.interceptors.request.use(async (config) => {
    const token = await options.getAccessToken?.()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  return {
    http,
    async login(input) {
      const res = await http.post('/auth/login', input)
      return LoginResponseSchema.parse(res.data)
    },
    async getHealth() {
      const res = await http.get('/healthz')
      return HealthSchema.parse(res.data)
    },
    async getPlans() {
      const res = await http.get('/plans')
      return PlansResponseSchema.parse(res.data)
    },
    async getDashboard() {
      const res = await http.get('/me/dashboard')
      return DashboardSchema.parse(res.data)
    },
    async getTokenBalance() {
      const res = await http.get('/me/token-balance')
      return TokenBalanceSchema.parse(res.data)
    },
    async createCheckout(input) {
      const res = await http.post('/billing/checkout', input)
      return CheckoutResponseSchema.parse(res.data)
    },
    async chat(input) {
      const res = await http.post('/ai/chat', input)
      return ChatResponseSchema.parse(res.data)
    },
  }
}
