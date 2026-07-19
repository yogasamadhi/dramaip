import { inArray } from 'drizzle-orm'
import type { DB } from '../client'
import { cloudMobileDraftAdoptions } from '../schema'
import { now } from './util'

export function recordCloudMobileDraftAdoption(db: DB, cloudDraftId: string, projectId: string): void {
  db.insert(cloudMobileDraftAdoptions).values({ cloudDraftId, projectId, adoptedAt: now() }).onConflictDoNothing().run()
}

export function adoptionStatusForCloudDrafts(db: DB, projectId: string, draftIds: string[]): Map<string, { currentProject: boolean; otherProjects: boolean }> {
  const statuses = new Map(draftIds.map((id) => [id, { currentProject: false, otherProjects: false }]))
  if (!draftIds.length) return statuses
  const rows = db.select().from(cloudMobileDraftAdoptions).where(inArray(cloudMobileDraftAdoptions.cloudDraftId, draftIds)).all()
  for (const row of rows) {
    const status = statuses.get(row.cloudDraftId); if (!status) continue
    if (row.projectId === projectId) status.currentProject = true
    else status.otherProjects = true
  }
  return statuses
}
