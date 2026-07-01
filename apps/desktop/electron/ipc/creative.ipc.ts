// v1.1 创意诊断与反套路迭代系统 IPC
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import {
  CREATIVE_WORKFLOW_TEMPLATES,
  TASK_TYPE_LABELS,
  type ContentVersion,
  type NovelTaskType,
  type WorkflowRunStep,
} from '@sdns/core'
import { resolveProviderForTask, runNovelWorkflow, type NovelWorkflowInput } from '@sdns/ai'
import { getRepos } from '../db'
import { assertReadableImportFile, truncateImportedText } from '../file-security'

type WorkflowInput = {
  templateKey: string
  projectId?: string
  chapterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  userInstruction?: string
}

export function registerCreativeIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('caseStudy:list', () => repos().creative.listCaseStudies(repos().db))
  ipcMain.handle('caseStudy:importDocuments', async () => importCaseStudyDocuments())
  ipcMain.handle('caseStudy:create', (_e, data: unknown) => repos().creative.createCaseStudy(repos().db, data as never))
  ipcMain.handle('caseStudy:update', (_e, id: string, patch: unknown) =>
    repos().creative.updateCaseStudy(repos().db, id, patch as never),
  )
  ipcMain.handle('caseStudy:delete', (_e, id: string) => {
    repos().creative.deleteCaseStudy(repos().db, id)
    return true
  })

  ipcMain.handle('creative:freshness:list', (_e, projectId?: string) =>
    repos().creative.listFreshnessReports(repos().db, projectId),
  )
  ipcMain.handle('creative:freshness:listByTarget', (_e, targetKind: string, targetId?: string) =>
    repos().creative.listFreshnessReportsByTarget(repos().db, targetKind, targetId),
  )
  ipcMain.handle('creative:antiTrope:listByTarget', (_e, targetKind: string, targetId?: string) =>
    repos().creative.listAntiTropeVariantsByTarget(repos().db, targetKind, targetId),
  )
  ipcMain.handle('creative:qualityGate:list', (_e, projectId?: string) =>
    repos().creative.listQualityGateReports(repos().db, projectId),
  )
  ipcMain.handle('creative:audience:list', (_e, projectId?: string) =>
    repos().creative.listAudienceSimulations(repos().db, projectId),
  )
  ipcMain.handle('creative:curve:list', (_e, projectId?: string) =>
    repos().creative.listNarrativeCurveReports(repos().db, projectId),
  )

  ipcMain.handle('revisionTask:list', (_e, projectId?: string) =>
    repos().creative.listRevisionTasks(repos().db, projectId),
  )
  ipcMain.handle('revisionTask:listByTarget', (_e, targetKind: string, targetId?: string) =>
    repos().creative.listRevisionTasksByTarget(repos().db, targetKind, targetId),
  )
  ipcMain.handle('revisionTask:create', (_e, data: unknown) =>
    repos().creative.createRevisionTask(repos().db, data as never),
  )
  ipcMain.handle('revisionTask:update', (_e, id: string, patch: unknown) =>
    repos().creative.updateRevisionTask(repos().db, id, patch as never),
  )
  ipcMain.handle('revisionTask:apply', async (_e, id: string) => applyRevisionTask(id))

  ipcMain.handle('contentVersion:listByTarget', (_e, targetKind: string, targetId: string) =>
    repos().creative.listContentVersionsByTarget(repos().db, targetKind, targetId),
  )
  ipcMain.handle('contentVersion:create', (_e, data: unknown) =>
    repos().creative.createContentVersion(repos().db, data as never),
  )
  ipcMain.handle('contentVersion:restore', (_e, id: string) => restoreContentVersion(id))

  ipcMain.handle('workflow:list', (_e, projectId?: string) => repos().creative.listWorkflowRuns(repos().db, projectId))
  ipcMain.handle('workflow:run', async (_e, input: WorkflowInput) => runCreativeWorkflow(input))
}

function stringMeta(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function restoreContentVersion(id: string): { ok: boolean; error?: string; result?: ContentVersion } {
  const r = getRepos()
  const db = r.db
  const version = r.creative.getContentVersion(db, id)
  if (!version) return { ok: false, error: '未找到内容版本' }

  try {
    if (version.targetKind === 'chapter') {
      const chapter = r.chapter.getChapter(db, version.targetId)
      if (!chapter) return { ok: false, error: '未找到章节' }
      const before = r.creative.createContentVersion(db, {
        projectId: version.projectId ?? chapter.projectId,
        targetKind: 'chapter',
        targetId: chapter.id,
        label: `恢复前：${chapter.title}`,
        source: 'manual_checkpoint',
        content: chapter.content,
        meta: { phase: 'before_restore', restoreFromVersionId: version.id },
      })
      const updated = r.chapter.updateChapterContent(db, chapter.id, version.content)
      const restored = r.creative.createContentVersion(db, {
        projectId: version.projectId ?? chapter.projectId,
        targetKind: 'chapter',
        targetId: chapter.id,
        label: `恢复：${version.label}`,
        source: 'restore',
        content: updated?.content ?? version.content,
        meta: { phase: 'after_restore', restoreFromVersionId: version.id, beforeVersionId: before.id },
      })
      return { ok: true, result: restored }
    }

    if (version.targetKind === 'script') {
      const script = r.script.getScript(db, version.targetId)
      if (!script) return { ok: false, error: '未找到剧本' }
      const before = r.creative.createContentVersion(db, {
        projectId: version.projectId,
        targetKind: 'script',
        targetId: script.id,
        label: `恢复前：${script.title}`,
        source: 'manual_checkpoint',
        content: script.content,
        meta: { phase: 'before_restore', restoreFromVersionId: version.id },
      })
      const updated = r.script.updateScriptContent(db, script.id, version.content)
      const restored = r.creative.createContentVersion(db, {
        projectId: version.projectId,
        targetKind: 'script',
        targetId: script.id,
        label: `恢复：${version.label}`,
        source: 'restore',
        content: updated?.content ?? version.content,
        meta: { phase: 'after_restore', restoreFromVersionId: version.id, beforeVersionId: before.id },
      })
      return { ok: true, result: restored }
    }

    if (version.targetKind === 'shot') {
      const shot = r.shot.getShot(db, version.targetId)
      if (!shot) return { ok: false, error: '未找到镜头' }
      const before = r.creative.createContentVersion(db, {
        projectId: version.projectId,
        targetKind: 'shot',
        targetId: shot.id,
        label: `恢复前：镜头 ${shot.shotNumber}`,
        source: 'manual_checkpoint',
        content: shot.videoPrompt,
        meta: {
          phase: 'before_restore',
          restoreFromVersionId: version.id,
          negativePrompt: shot.negativePrompt,
          imagePrompt: shot.imagePrompt,
        },
      })
      const negativePrompt = stringMeta(version.meta?.negativePrompt) ?? shot.negativePrompt
      const imagePrompt = stringMeta(version.meta?.imagePrompt) ?? shot.imagePrompt
      const patch: { videoPrompt: string; negativePrompt?: string; imagePrompt?: string } = { videoPrompt: version.content }
      if (negativePrompt !== undefined) patch.negativePrompt = negativePrompt
      if (imagePrompt !== undefined) patch.imagePrompt = imagePrompt
      const updated = r.shot.updateShot(db, shot.id, patch)
      r.shot.appendPromptVersion(db, {
        shotId: shot.id,
        taskType: 'restore_shot_prompt',
        videoPrompt: updated?.videoPrompt ?? version.content,
        negativePrompt: updated?.negativePrompt,
        imagePrompt: updated?.imagePrompt,
        note: `恢复：${version.label}`,
      })
      const restored = r.creative.createContentVersion(db, {
        projectId: version.projectId,
        targetKind: 'shot',
        targetId: shot.id,
        label: `恢复：${version.label}`,
        source: 'restore',
        content: updated?.videoPrompt ?? version.content,
        meta: {
          phase: 'after_restore',
          restoreFromVersionId: version.id,
          beforeVersionId: before.id,
          negativePrompt: updated?.negativePrompt,
          imagePrompt: updated?.imagePrompt,
        },
      })
      return { ok: true, result: restored }
    }

    return { ok: false, error: '当前版本目标暂不支持恢复' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function importCaseStudyDocuments() {
  try {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const options: OpenDialogOptions = {
      title: '选择样本资料',
      filters: [
        { name: '样本文档', extensions: ['md', 'txt', 'docx'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本文件', extensions: ['txt'] },
        { name: 'Word 文档', extensions: ['docx'] },
      ],
      properties: ['openFile', 'multiSelections'],
    }
    const open = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (open.canceled || open.filePaths.length === 0) return { ok: false, canceled: true, documents: [] }

    const docs = []
    for (const filePath of open.filePaths) {
      try {
        const doc = await readCaseStudyDocument(filePath)
        docs.push(doc)
      } catch (e) {
        docs.push({
          fileName: basename(filePath),
          path: filePath,
          text: '',
          truncated: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return { ok: true, documents: docs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), documents: [] }
  }
}

async function readCaseStudyDocument(filePath: string) {
  const { readFile } = await import('node:fs/promises')
  await assertReadableImportFile('caseStudyDocument', filePath)
  const fileName = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  let text = ''
  if (ext === '.md' || ext === '.txt') {
    text = await readFile(filePath, 'utf-8')
  } else if (ext === '.docx') {
    text = extractDocxText(await readFile(filePath))
  } else {
    throw new Error('仅支持 .md / .txt / .docx')
  }
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  const truncated = truncateImportedText('caseStudyDocument', cleaned)
  return {
    fileName,
    path: filePath,
    text: truncated.text,
    truncated: truncated.truncated,
  }
}

function extractDocxText(buffer: Buffer): string {
  const entry = readZipEntry(buffer, 'word/document.xml')
  if (!entry) throw new Error('无法读取 Word 正文，请确认文件是有效 .docx')
  const xml = entry.toString('utf-8')
  const out: string[] = []
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    if (match[1] !== undefined) out.push(decodeXml(match[1]))
    else if (match[0].startsWith('<w:tab')) out.push('\t')
    else out.push('\n')
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function readZipEntry(buffer: Buffer, fileName: string): Buffer | undefined {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) return undefined
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  let offset = centralOffset

  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return undefined
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf-8')
    if (name === fileName) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return undefined
      const localNameLen = buffer.readUInt16LE(localOffset + 26)
      const localExtraLen = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return Buffer.from(compressed)
      if (method === 8) return inflateRawSync(compressed)
      throw new Error(`不支持的 docx 压缩方式：${method}`)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  return undefined
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) return -1
  const min = Math.max(0, buffer.length - 65_557)
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function applyRevisionTask(id: string) {
  const r = getRepos()
  const db = r.db
  const task = r.creative.listRevisionTasks(db).find((it) => it.id === id)
  if (!task) return { ok: false, error: '未找到修稿任务' }

  try {
    if (task.targetKind === 'chapter' && task.targetId) {
      const chapter = r.chapter.getChapter(db, task.targetId)
      if (!chapter) return { ok: false, error: '未找到章节' }
      r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'chapter',
        targetId: chapter.id,
        label: `应用任务前：${task.title}`,
        source: 'revision_task',
        content: chapter.content,
        meta: { taskId: task.id, phase: 'before' },
      })
      const res = await runAiTask({ projectId: chapter.projectId, chapterId: chapter.id, taskType: 'rewrite_chapter', userInstruction: task.suggestedAction })
      const updated = r.chapter.getChapter(db, chapter.id)
      const version = r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'chapter',
        targetId: chapter.id,
        label: `应用任务后：${task.title}`,
        source: 'revision_task',
        content: updated?.content ?? chapter.content,
        meta: { taskId: task.id, aiRunId: res.aiRunId, phase: 'after' },
      })
      r.creative.updateRevisionTask(db, task.id, { status: 'applied', appliedVersionId: version.id })
      return { ok: res.ok, error: res.error, result: version }
    }

    if (task.targetKind === 'script' && task.targetId) {
      const script = r.script.getScript(db, task.targetId)
      if (!script) return { ok: false, error: '未找到剧本' }
      r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'script',
        targetId: script.id,
        label: `应用任务前：${task.title}`,
        source: 'revision_task',
        content: script.content,
        meta: { taskId: task.id, phase: 'before' },
      })
      const res = await runAiTask({
        projectId: task.projectId,
        adaptationProjectId: script.adaptationProjectId,
        episodeId: script.episodeId,
        taskType: 'rewrite_ai_drama_script',
        userInstruction: task.suggestedAction,
      })
      const updated = r.script.getScript(db, script.id)
      const version = r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'script',
        targetId: script.id,
        label: `应用任务后：${task.title}`,
        source: 'revision_task',
        content: updated?.content ?? script.content,
        meta: { taskId: task.id, aiRunId: res.aiRunId, phase: 'after' },
      })
      r.creative.updateRevisionTask(db, task.id, { status: 'applied', appliedVersionId: version.id })
      return { ok: res.ok, error: res.error, result: version }
    }

    if (task.targetKind === 'shot' && task.targetId) {
      const shot = r.shot.getShot(db, task.targetId)
      if (!shot) return { ok: false, error: '未找到镜头' }
      const scene = r.scene.getScene(db, shot.sceneId)
      const script = scene ? r.script.getScript(db, scene.scriptId) : undefined
      r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'shot',
        targetId: shot.id,
        label: `应用任务前：${task.title}`,
        source: 'revision_task',
        content: shot.videoPrompt,
        meta: { taskId: task.id, phase: 'before' },
      })
      const res = await runAiTask({
        projectId: task.projectId,
        adaptationProjectId: script?.adaptationProjectId,
        episodeId: shot.episodeId,
        sceneId: shot.sceneId,
        shotId: shot.id,
        taskType: 'rewrite_shot_prompt',
        userInstruction: task.suggestedAction,
      })
      const updated = r.shot.getShot(db, shot.id)
      const version = r.creative.createContentVersion(db, {
        projectId: task.projectId,
        targetKind: 'shot',
        targetId: shot.id,
        label: `应用任务后：${task.title}`,
        source: 'revision_task',
        content: updated?.videoPrompt ?? shot.videoPrompt,
        meta: { taskId: task.id, aiRunId: res.aiRunId, phase: 'after' },
      })
      r.creative.updateRevisionTask(db, task.id, { status: 'applied', appliedVersionId: version.id })
      return { ok: res.ok, error: res.error, result: version }
    }

    return { ok: false, error: '当前任务目标暂不支持一键应用，请在对应页面按 suggestedAction 手动改写' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function runCreativeWorkflow(input: WorkflowInput) {
  const r = getRepos()
  const tpl = CREATIVE_WORKFLOW_TEMPLATES.find((it) => it.key === input.templateKey)
  if (!tpl) return { ok: false, error: `未知工作流：${input.templateKey}` }

  const steps: WorkflowRunStep[] = tpl.steps.map((taskType) => ({
    key: taskType,
    label: TASK_TYPE_LABELS[taskType] ?? taskType,
    taskType: taskType as NovelTaskType,
    status: 'pending',
  }))
  const run = r.creative.createWorkflowRun(r.db, {
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    templateKey: tpl.key,
    title: tpl.title,
    status: 'running',
    currentStep: steps[0]?.key,
    steps,
  })

  const currentSteps = [...steps]
  for (let i = 0; i < currentSteps.length; i++) {
    const step = currentSteps[i]
    currentSteps[i] = { ...step, status: 'running' }
    r.creative.updateWorkflowRun(r.db, run.id, { currentStep: step.key, steps: currentSteps })
    const res = await runAiTask({ ...input, taskType: step.taskType as NovelTaskType, userInstruction: input.userInstruction })
    currentSteps[i] = { ...step, status: res.ok ? 'success' : 'failed', aiRunId: res.aiRunId, error: res.error }
    r.creative.updateWorkflowRun(r.db, run.id, { steps: currentSteps })
    if (!res.ok) {
      const failed = r.creative.updateWorkflowRun(r.db, run.id, {
        status: 'failed',
        currentStep: step.key,
        steps: currentSteps,
        errorMessage: res.error,
      })
      return { ok: false, error: res.error, result: failed }
    }
  }

  const done = r.creative.updateWorkflowRun(r.db, run.id, {
    status: 'success',
    currentStep: undefined,
    steps: currentSteps,
  })
  return { ok: true, result: done }
}

async function runAiTask(input: NovelWorkflowInput) {
  const r = getRepos()
  const { provider } = resolveProviderForTask(r, input.taskType, input.templateScope)
  return runNovelWorkflow({ repos: r, provider }, input)
}
