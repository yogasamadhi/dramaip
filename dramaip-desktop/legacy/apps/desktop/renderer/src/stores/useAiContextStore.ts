// AI 上下文控制的共享 store：让 WorkspacePage 顶层、AiAssistantPanel、命令面板等
// 所有 AI 入口共享同一份 contextControls（固定/自动/排除的上下文实体）。
// 避免之前 3 处独立 state 导致用户在面板调的设置对命令面板不可见的问题。
import { create } from 'zustand'
import type { AiContextControls } from '@sdns/core'
import { setAiContextControlMode, type AiContextControlKey, type AiContextControlMode } from '@/lib/aiPreflightContext'

interface AiContextState {
  contextControls: AiContextControls
  setControlMode: (key: AiContextControlKey, targetId: string, mode: AiContextControlMode) => void
  resetControls: () => void
}

export const useAiContextStore = create<AiContextState>((set) => ({
  contextControls: {},
  setControlMode: (key, targetId, mode) =>
    set((state) => ({ contextControls: setAiContextControlMode(state.contextControls, key, targetId, mode) })),
  resetControls: () => set({ contextControls: {} }),
}))
