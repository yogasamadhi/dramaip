import { createApiClient } from '@dramaip/sdk'

export const apiClient = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000',
})
