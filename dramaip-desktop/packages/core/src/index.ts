export * from './types'
export * from './schemas'
export * from './constants'
export * from './ipc-contract'
export * from './structure-snapshot'
export * from './mobile-inspiration'
export * from './quality-gate-freshness'
export * from './script-blocks'
export * from './video-production'
// v0.8 内置 Agent / 类型预设种子数据（仅在 db seed 时使用，不进 UI 常量）
export {
  BUILT_IN_AGENTS,
  BUILT_IN_TEMPLATES,
  type BuiltInAgentPreset,
  type BuiltInTemplatePreset,
  type WritingRoomTaskType,
} from './constants/agents'
export { BUILT_IN_GENRE_PRESETS, type BuiltInGenrePreset } from './constants/genre-presets'
