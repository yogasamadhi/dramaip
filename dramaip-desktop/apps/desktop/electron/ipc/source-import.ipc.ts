import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { getRepos } from '../db'
import { assertReadableImportFile } from '../file-security'
import {
  applySourceImport,
  parseSourceImportBuffer,
  type SourceImportPreview,
  type SourceImportStrategy,
} from '../source-import'

interface ImportSession {
  projectId: string
  preview: SourceImportPreview
  sourcePath: string
  expiresAt: number
}

const IMPORT_SESSION_TTL_MS = 30 * 60 * 1000
const importSessions = new Map<string, ImportSession>()

export function registerSourceImportIpc(): void {
  ipcMain.handle('sourceImport:choose', async (_event, projectId: string) => chooseSourceImport(projectId))
  ipcMain.handle('sourceImport:commit', async (_event, input: SourceImportCommitInput) => commitSourceImport(input))
  ipcMain.handle('sourceImport:discard', (_event, importId: string) => {
    importSessions.delete(importId)
    return { ok: true }
  })
}

interface SourceImportCommitInput {
  importId: string
  projectId: string
  strategy: SourceImportStrategy
  rightsConfirmed: boolean
  destructiveConfirmed?: boolean
  preview: SourceImportPreview
}

async function chooseSourceImport(projectId: string) {
  const repos = getRepos()
  if (!repos.project.getProject(repos.db, projectId)) return { ok: false, error: '未找到导入目标项目' }
  try {
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const open = window
      ? await dialog.showOpenDialog(window, sourceImportDialogOptions())
      : await dialog.showOpenDialog(sourceImportDialogOptions())
    if (open.canceled || !open.filePaths[0]) return { ok: false, canceled: true }
    const path = open.filePaths[0]
    await assertReadableImportFile('sourceDocument', path)
    const preview = parseSourceImportBuffer(basename(path), await readFile(path))
    const importId = randomUUID()
    importSessions.set(importId, { projectId, preview, sourcePath: path, expiresAt: Date.now() + IMPORT_SESSION_TTL_MS })
    pruneExpiredSessions()
    return {
      ok: true,
      importId,
      preview,
      duplicates: summarizeDuplicates(projectId, preview),
      note: '导入后仅生成可审查的故事圣经建议，不会自动采用人物、大纲或设定。',
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function commitSourceImport(input: SourceImportCommitInput) {
  const session = importSessions.get(input.importId)
  if (!session || session.expiresAt < Date.now()) {
    importSessions.delete(input.importId)
    return { ok: false, error: '导入预览已过期，请重新选择文件' }
  }
  if (session.projectId !== input.projectId) return { ok: false, error: '导入目标与预览项目不一致' }
  if (!input.rightsConfirmed) return { ok: false, error: '请先确认你拥有导入内容的使用权或已获得授权' }
  if (input.strategy !== 'append' && !input.destructiveConfirmed) {
    return { ok: false, error: '合并或覆盖会修改已有内容，请完成二次确认' }
  }
  try {
    const repos = getRepos()
    const result = applySourceImport(repos, {
      projectId: input.projectId,
      strategy: input.strategy,
      preview: sanitizeEditedPreview(session.preview, input.preview),
    })
    // 导入时的勾选只记录为“已声明”，绝不自动升级为已核验；最终交付仍需证据和范围预检。
    const sourceAsset = repos.asset.createAsset(repos.db, {
      projectId: input.projectId,
      kind: 'source_media',
      title: `导入原稿：${session.preview.fileName}`,
      sourceEntityKind: 'project',
      sourceEntityId: input.projectId,
      localPath: session.sourcePath,
      originalName: session.preview.fileName,
      tags: ['导入原稿', '待权利核验'],
      metadata: { sourceType: session.preview.sourceType, importedAt: new Date().toISOString() },
      status: 'available',
      packagePolicy: 'reference_only',
    })
    repos.rights.upsertAssetRightsRecord(repos.db, {
      projectId: input.projectId,
      assetId: sourceAsset.id,
      source: '导入时由用户声明拥有使用权或已获得授权',
      status: 'declared',
      rightsTypes: [],
      permittedUses: [],
    })
    importSessions.delete(input.importId)
    return { ok: true, result }
  } catch (error) {
    // SQLite transaction 失败会整体回滚；保留 session，用户可修正预览后重试。
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function sanitizeEditedPreview(original: SourceImportPreview, edited: SourceImportPreview): SourceImportPreview {
  // 允许用户修正拆章、标题和正文；不可借由 renderer 改变已识别的来源类型或文件元信息。
  return {
    ...original,
    chapters: Array.isArray(edited.chapters) ? edited.chapters : original.chapters,
    episodes: Array.isArray(edited.episodes) ? edited.episodes : original.episodes,
    warnings: original.warnings,
  }
}

function summarizeDuplicates(projectId: string, preview: SourceImportPreview) {
  const repos = getRepos()
  const chapterTitles = new Set(repos.chapter.listChapters(repos.db, projectId).map((chapter) => chapter.title.trim()))
  const duplicateChapterTitles = preview.chapters.filter((chapter) => chapterTitles.has(chapter.title.trim())).map((chapter) => chapter.title)
  const adaptation = repos.adaptationProject.listAdaptationsByProject(repos.db, projectId)[0]
  const existingEpisodeNumbers = new Set(adaptation ? repos.script.listScripts(repos.db, adaptation.id).map((script) => script.episodeNumber) : [])
  const duplicateEpisodes = preview.episodes.filter((episode) => existingEpisodeNumbers.has(episode.episodeNumber)).map((episode) => episode.episodeNumber)
  return { chapters: duplicateChapterTitles, episodes: duplicateEpisodes }
}

function sourceImportDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: '选择拥有授权的小说或漫剧剧本',
    filters: [
      { name: '小说与剧本', extensions: ['txt', 'md', 'markdown', 'docx', 'epub', 'json'] },
      { name: '文本与 Markdown', extensions: ['txt', 'md', 'markdown'] },
      { name: 'Word 与 EPUB', extensions: ['docx', 'epub'] },
      { name: '结构化剧本 JSON', extensions: ['json'] },
    ],
    properties: ['openFile'],
  }
}

function pruneExpiredSessions(): void {
  const now = Date.now()
  for (const [id, session] of importSessions) if (session.expiresAt < now) importSessions.delete(id)
}
