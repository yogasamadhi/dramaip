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

export const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
})

export type Health = z.infer<typeof HealthSchema>

export const DashboardSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  subscription_status: z.string(),
  plan: z.string(),
  quota_tokens: z.number(),
  used_tokens: z.number(),
  remaining_tokens: z.number(),
})

export type Dashboard = z.infer<typeof DashboardSchema>

export interface ApiClientOptions {
  baseURL: string
  getAccessToken?: () => string | undefined | Promise<string | undefined>
}

export interface DramaIpApiClient {
  http: AxiosInstance
  getHealth(): Promise<Health>
  getDashboard(): Promise<Dashboard>
  getTokenBalance(): Promise<TokenBalance>
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
    async getHealth() {
      const res = await http.get('/healthz')
      return HealthSchema.parse(res.data)
    },
    async getDashboard() {
      const res = await http.get('/me/dashboard')
      return DashboardSchema.parse(res.data)
    },
    async getTokenBalance() {
      const res = await http.get('/me/token-balance')
      return TokenBalanceSchema.parse(res.data)
    },
  }
}
