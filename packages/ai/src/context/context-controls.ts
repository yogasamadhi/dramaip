import type { AiContextControls } from '@sdns/core'

export type AiContextControlKey = 'chapters' | 'characters' | 'storyArcs' | 'caseStudies' | 'visualProfiles'

export function applyContextControls<T extends { id: string }>(
  items: T[],
  key: AiContextControlKey,
  controls?: AiContextControls,
): T[] {
  const excluded = new Set(controls?.excluded?.[key] ?? [])
  const pinned = new Set(controls?.pinned?.[key] ?? [])
  const filtered = items.filter((item) => !excluded.has(item.id))
  return [
    ...filtered.filter((item) => pinned.has(item.id)),
    ...filtered.filter((item) => !pinned.has(item.id)),
  ]
}
