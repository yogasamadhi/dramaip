import type { Project } from './types'

function hasText(value?: string): boolean {
  return Boolean(value?.trim())
}

/**
 * The minimum project brief required before the first chapter can be written.
 * Keep this shared so project cards and the workspace progress guide agree.
 */
export function isProjectSetupComplete(project: Pick<Project, 'coreHook' | 'synopsis'>): boolean {
  return hasText(project.coreHook) && hasText(project.synopsis)
}
