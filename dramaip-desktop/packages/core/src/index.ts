export * from './types'
export * from './schemas'
export * from './constants'
export * from './ipc-contract'
export * from './structure-snapshot'
export * from './mobile-inspiration'
export * from './quality-gate-freshness'
export * from './script-blocks'
export * from './video-production'
export * from './image-production'
export * from './visual-continuity'
export * from './shot-still-production'
export * from './animatic'
export * from './audio-generation'
export * from './episode-render'
// v0.8 内置 Agent / 类型预设种子数据（仅在 db seed 时使用，不进 UI 常量）
export {
  BUILT_IN_AGENTS,
  BUILT_IN_TEMPLATES,
  type BuiltInAgentPreset,
  type BuiltInTemplatePreset,
  type WritingRoomTaskType,
} from './constants/agents'
export {
  BUILT_IN_GENRE_PRESETS,
  CLASSIC_GENRE_PRESET_NAMES,
  HOT_GENRE_PRESET_NAMES,
  RETIRED_BUILT_IN_GENRE_PRESET_NAMES,
  type BuiltInGenrePreset,
} from './constants/genre-presets'
