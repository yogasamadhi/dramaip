import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { parseMobileInspirationImport, type InspirationCardKind } from '@sdns/core'
import { adoptCloudMobileDraft, listCloudMobileDrafts } from '../cloud-handoff'
import { getRepos } from '../db'

// The renderer never receives the desktop access token. Adoption remains an
// explicit local action: it writes an inspiration favorite only, never a
// chapter/body overwrite or an automatic project merge.
export function registerCloudHandoffIpc(): void {
  ipcMain.handle('cloudHandoff:list', async (_event, input: { projectId: string }) => {
    const drafts = await listCloudMobileDrafts()
    const statuses = getRepos().cloudMobileDraftAdoption.adoptionStatusForCloudDrafts(getRepos().db, input.projectId, drafts.map((draft) => draft.id))
    return drafts.map((draft) => ({ ...draft, currentProjectAdopted: statuses.get(draft.id)?.currentProject ?? false, adoptedInOtherProject: statuses.get(draft.id)?.otherProjects ?? false }))
  })
  ipcMain.handle('cloudHandoff:adopt', async (_event, input: { projectId: string; draftId: string }) => {
    const draft = await adoptCloudMobileDraft(input.draftId, randomUUID())
    const content = JSON.stringify({
      items: [{
        title: draft.title,
        kind: favoriteKind(draft.kind),
        pattern: [draft.content, draft.aiExpansion].filter(Boolean).join('\n\n'),
        applyTo: draft.kind === 'character' ? '人物设定候选' : draft.kind === 'project' ? '项目方向候选' : '灵感台候选',
        risk: `来自移动端${draft.captureMode === 'voice' ? '语音' : '文字'}草稿；采用前请人工核对。`,
      }],
    })
    const parsed = parseMobileInspirationImport({ projectId: input.projectId, content, fileName: `cloud-${draft.id}.json` })
    const repos = getRepos()
    const favorites = parsed.items.map((item) => repos.inspirationFavorite.upsertInspirationFavorite(repos.db, item))
    repos.cloudMobileDraftAdoption.recordCloudMobileDraftAdoption(repos.db, draft.id, input.projectId)
    return { draft, imported: favorites.length, skipped: parsed.skipped }
  })
}

function favoriteKind(kind: 'inspiration' | 'character' | 'project'): InspirationCardKind {
  if (kind === 'character') return 'relationship'
  if (kind === 'project') return 'opening'
  return 'conflict'
}
