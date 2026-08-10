import { create } from 'zustand'
import { ipc } from '@/lib/ipc'
import type { ModelConfig } from '@sdns/core'

interface ModelInput {
  name: string
  provider: string
  baseUrl: string
  apiKey?: string
  model: string
  isDefault?: boolean
}

interface ModelState {
  configs: ModelConfig[]
  defaultId?: string
  loading: boolean
  fetch: () => Promise<void>
  create: (data: ModelInput) => Promise<ModelConfig>
  update: (id: string, patch: Partial<ModelInput>) => Promise<void>
  remove: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
}

export const useModelStore = create<ModelState>((set, get) => ({
  configs: [],
  loading: false,
  fetch: async () => {
    set({ loading: true })
    try {
      const [configs, def] = await Promise.all([ipc.model.list(), ipc.model.getDefault()])
      set({ configs, defaultId: def?.id })
    } finally {
      set({ loading: false })
    }
  },
  create: async (data) => {
    const config = await ipc.model.create(data)
    await get().fetch()
    return config
  },
  update: async (id, patch) => {
    await ipc.model.update(id, patch)
    await get().fetch()
  },
  remove: async (id) => {
    await ipc.model.remove(id)
    await get().fetch()
  },
  setDefault: async (id) => {
    await ipc.model.setDefault(id)
    set({ defaultId: id })
  },
}))
