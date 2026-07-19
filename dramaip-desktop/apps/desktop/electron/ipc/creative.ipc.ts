// v1.1 创意诊断与反套路迭代系统 IPC
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import {
  CREATIVE_WORKFLOW_TEMPLATES,
  TASK_TYPE_LABELS,
  type CreativeWorkflowTemplateStep,
  type ContentVersion,
  type TextDiffPreviewPayload,
  type VideoGenerationTask,
  type WorkflowRunStep,
} from '@sdns/core'
import { resolveProviderForTask, runNovelWorkflow, type NovelWorkflowInput } from '@sdns/ai'
import { getRepos } from '../db'
import { assertReadableImportFile, truncateImportedText } from '../file-security'
import { normalizeCaseStudyText, parseCaseStudyChapters } from '../case-study-import'
import { startBatchLongTask } from './task.ipc'
import { isStructureSnapshot, restoreSceneShotsSnapshot, restoreScriptScenesSnapshot } from '../structure-snapshot-restore'

type WorkflowInput = {
  templateKey: string
  projectId?: string
  chapterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  userInstruction?: string
  pauseAfterStep?: boolean
}

type WorkflowResumeInput = {
  runId: string
  pauseAfterStep?: boolean
}

type WorkflowRetryStepInput = {
  runId: string
  stepKey: string
  pauseAfterStep?: boolean
}

export function registerCreativeIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('caseStudy:list', () => repos().creative.listCaseStudies(repos().db))
  ipcMain.handle('caseStudy:listDocuments', () => repos().creative.listCaseStudyDocuments(repos().db))
  ipcMain.handle('caseStudy:importDocuments', async () => importCaseStudyDocuments())
  ipcMain.handle('caseStudy:createDocument', (_e, data: unknown) =>
    repos().creative.createCaseStudyDocument(repos().db, data as never),
  )
  ipcMain.handle('caseStudy:updateDocumentChapter', (_e, id: string, patch: unknown) =>
    repos().creative.updateCaseStudyDocumentChapter(repos().db, id, patch as never),
  )
  ipcMain.handle('caseStudy:deleteDocument', (_e, id: string) => {
    repos().creative.deleteCaseStudyDocument(repos().db, id)
    return true
  })
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
  ipcMain.handle('revisionTask:preview', async (_e, id: string) => previewRevisionTask(id))
  ipcMain.handle('revisionTask:adopt', (_e, id: string) => repos().revisionAdoption.adoptRevisionTask(repos().db, id))
  ipcMain.handle('revisionTask:undo', (_e, id: string) => repos().revisionAdoption.undoRevisionTask(repos().db, id))
  // 兼容旧 renderer：两条旧命令均进入同一原子采用事务，不能再单独写正文或标任务完成。
  ipcMain.handle('revisionTask:complete', (_e, id: string) => repos().revisionAdoption.adoptRevisionTask(repos().db, id))
  ipcMain.handle('revisionTask:apply', (_e, id: string) => repos().revisionAdoption.adoptRevisionTask(repos().db, id))

  ipcMain.handle('contentVersion:listByTarget', (_e, targetKind: string, targetId: string) =>
    repos().creative.listContentVersionsByTarget(repos().db, targetKind, targetId),
  )
  ipcMain.handle('contentVersion:create', (_e, data: unknown) =>
    repos().creative.createContentVersion(repos().db, data as never),
  )
  ipcMain.handle('contentVersion:restore', (_e, id: string) => restoreContentVersion(id))

  ipcMain.handle('workflow:list', (_e, projectId?: string) => repos().creative.listWorkflowRuns(repos().db, projectId))
  ipcMain.handle('workflow:run', async (_e, input: WorkflowInput) => runCreativeWorkflow(input))
  ipcMain.handle('workflow:resume', async (_e, input: WorkflowResumeInput) => resumeCreativeWorkflow(input))
  ipcMain.handle('workflow:retryStep', async (_e, input: WorkflowRetryStepInput) => retryWorkflowStep(input))
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
      if (isStructureSnapshot(version, 'script_scenes')) {
        return restoreScriptScenesSnapshot(r, version, script)
      }
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

    if (version.targetKind === 'scene') {
      const scene = r.scene.getScene(db, version.targetId)
      if (!scene) return { ok: false, error: '未找到场景' }
      if (isStructureSnapshot(version, 'scene_shots')) {
        return restoreSceneShotsSnapshot(r, version, scene)
      }
      return { ok: false, error: '当前场景版本不是可恢复的结构快照' }
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
          chapters: [],
          parseWarnings: [],
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
  const cleaned = normalizeCaseStudyText(text)
  const truncated = truncateImportedText('caseStudyDocument', cleaned)
  const parsed = parseCaseStudyChapters(truncated.text, fileName)
  const parseWarnings = [...parsed.warnings]
  if (truncated.truncated) parseWarnings.unshift('文档较长，已按导入安全策略截取前 80000 字符用于拆章。')
  return {
    fileName,
    path: filePath,
    sourceType: ext.slice(1),
    text: truncated.text,
    truncated: truncated.truncated,
    chapters: parsed.chapters,
    parseWarnings,
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

async function previewRevisionTask(id: string) {
  const r = getRepos()
  const db = r.db
  const task = r.creative.listRevisionTasks(db).find((it) => it.id === id)
  if (!task) return { ok: false, error: '未找到修稿任务' }
  if (task.status === 'applied') return { ok: false, error: '修稿任务已应用' }
  if (task.status === 'preview_ready' && task.preview) return { ok: true, preview: task.preview }

  try {
    if (task.targetKind === 'chapter' && task.targetId) {
      const chapter = r.chapter.getChapter(db, task.targetId)
      if (!chapter) return { ok: false, error: '未找到章节' }
      const res = await runAiTask({ projectId: chapter.projectId, chapterId: chapter.id, taskType: 'rewrite_chapter', userInstruction: task.suggestedAction })
      return revisionTaskPreviewResult(task.id, res)
    }

    if (task.targetKind === 'script' && task.targetId) {
      const script = r.script.getScript(db, task.targetId)
      if (!script) return { ok: false, error: '未找到剧本' }
      const res = await runAiTask({
        projectId: task.projectId,
        adaptationProjectId: script.adaptationProjectId,
        episodeId: script.episodeId,
        taskType: 'rewrite_ai_drama_script',
        userInstruction: task.suggestedAction,
      })
      return revisionTaskPreviewResult(task.id, res)
    }

    if (task.targetKind === 'shot' && task.targetId) {
      const shot = r.shot.getShot(db, task.targetId)
      if (!shot) return { ok: false, error: '未找到镜头' }
      const scene = r.scene.getScene(db, shot.sceneId)
      const script = scene ? r.script.getScript(db, scene.scriptId) : undefined
      const res = await runAiTask({
        projectId: task.projectId,
        adaptationProjectId: script?.adaptationProjectId,
        episodeId: shot.episodeId,
        sceneId: shot.sceneId,
        shotId: shot.id,
        taskType: 'rewrite_shot_prompt',
        userInstruction: task.suggestedAction,
      })
      return revisionTaskPreviewResult(task.id, res)
    }

    return { ok: false, error: '当前任务目标暂不支持生成改写预览，请在对应页面按 suggestedAction 手动改写' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function revisionTaskPreviewResult(
  taskId: string,
  res: Awaited<ReturnType<typeof runAiTask>>,
): { ok: boolean; error?: string; preview?: TextDiffPreviewPayload; aiRunId?: string } {
  if (!res.ok) return { ok: false, error: res.error }
  if (res.result?.kind !== 'text_preview') {
    return { ok: false, error: '修稿任务未生成可采用的文本预览' }
  }
  const r = getRepos()
  try {
    const preview = res.result.data as TextDiffPreviewPayload
    r.revisionAdoption.saveRevisionTaskPreview(r.db, taskId, preview)
    return { ok: true, preview, aiRunId: res.aiRunId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function runCreativeWorkflow(input: WorkflowInput) {
  const r = getRepos()
  const tpl = CREATIVE_WORKFLOW_TEMPLATES.find((it) => it.key === input.templateKey)
  if (!tpl) return { ok: false, error: `未知工作流：${input.templateKey}` }

  const steps: WorkflowRunStep[] = tpl.steps.map((step) => workflowStepFromTemplate(step, input))
  const run = r.creative.createWorkflowRun(r.db, {
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    templateKey: tpl.key,
    title: tpl.title,
    status: 'running',
    currentStep: steps[0]?.key,
    steps,
  })

  return advanceWorkflowRun(run.id, { pauseAfterStep: input.pauseAfterStep })
}

async function resumeCreativeWorkflow(input: WorkflowResumeInput) {
  const r = getRepos()
  const run = r.creative.listWorkflowRuns(r.db).find((it) => it.id === input.runId)
  if (!run) return { ok: false, error: '未找到工作流记录' }
  if (run.status === 'success') return { ok: false, error: '工作流已完成，无需继续' }
  return advanceWorkflowRun(run.id, { pauseAfterStep: input.pauseAfterStep })
}

async function retryWorkflowStep(input: WorkflowRetryStepInput) {
  const r = getRepos()
  const run = r.creative.listWorkflowRuns(r.db).find((it) => it.id === input.runId)
  if (!run) return { ok: false, error: '未找到工作流记录' }
  const stepIndex = run.steps.findIndex((step) => step.key === input.stepKey)
  if (stepIndex < 0) return { ok: false, error: '未找到工作流步骤' }
  const steps = run.steps.map((step, index) => (index >= stepIndex ? resetWorkflowStep(step) : step))
  r.creative.updateWorkflowRun(r.db, run.id, {
    status: 'running',
    currentStep: steps[stepIndex]?.key,
    steps,
    errorMessage: undefined,
  })
  return advanceWorkflowRun(run.id, { pauseAfterStep: input.pauseAfterStep })
}

async function advanceWorkflowRun(runId: string, options: { pauseAfterStep?: boolean }) {
  const r = getRepos()
  const run = r.creative.listWorkflowRuns(r.db).find((it) => it.id === runId)
  if (!run) return { ok: false, error: '未找到工作流记录' }
  const currentSteps = [...run.steps]
  const startIndex = currentSteps.findIndex((step) => step.status !== 'success')
  if (startIndex < 0) {
    const done = r.creative.updateWorkflowRun(r.db, run.id, { status: 'success', currentStep: undefined, steps: currentSteps })
    return { ok: true, result: done }
  }

  r.creative.updateWorkflowRun(r.db, run.id, { status: 'running', currentStep: currentSteps[startIndex]?.key, steps: currentSteps })

  for (let i = startIndex; i < currentSteps.length; i++) {
    const step = currentSteps[i]
    currentSteps[i] = {
      ...step,
      status: 'running',
      error: undefined,
      resultSummary: undefined,
    }
    r.creative.updateWorkflowRun(r.db, run.id, { status: 'running', currentStep: step.key, steps: currentSteps })
    const res = await executeWorkflowStep(r, run.id, currentSteps[i])
    currentSteps[i] = {
      ...currentSteps[i],
      status: res.ok ? 'success' : 'failed',
      aiRunId: res.aiRunId,
      longTaskId: res.longTaskId,
      videoTaskIds: res.videoTaskIds,
      resultSummary: res.resultSummary,
      error: res.error,
    }
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

    const nextStep = currentSteps.slice(i + 1).find((it) => it.status !== 'success')
    const templateStep = templateStepForRun(run.templateKey, step.key)
    if (nextStep && (options.pauseAfterStep || templateStep?.pauseAfter)) {
      const paused = r.creative.updateWorkflowRun(r.db, run.id, {
        status: 'paused',
        currentStep: nextStep.key,
        steps: currentSteps,
      })
      return { ok: true, result: paused }
    }
  }

  const done = r.creative.updateWorkflowRun(r.db, run.id, {
    status: 'success',
    currentStep: undefined,
    steps: currentSteps,
  })
  return { ok: true, result: done }
}

function workflowStepFromTemplate(step: CreativeWorkflowTemplateStep, input: WorkflowInput): WorkflowRunStep {
  return {
    key: step.key,
    label: step.label,
    kind: step.kind,
    taskType: step.taskType,
    batchKind: step.batchKind,
    status: 'pending',
    context: workflowContext(input),
    resultSummary: step.description,
  }
}

function workflowContext(input: WorkflowInput): NonNullable<WorkflowRunStep['context']> {
  return {
    projectId: input.projectId,
    chapterId: input.chapterId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    userInstruction: input.userInstruction,
  }
}

function resetWorkflowStep(step: WorkflowRunStep): WorkflowRunStep {
  return {
    ...step,
    status: 'pending',
    aiRunId: undefined,
    longTaskId: undefined,
    videoTaskIds: undefined,
    resultSummary: undefined,
    error: undefined,
  }
}

function templateStepForRun(templateKey: string, stepKey: string): CreativeWorkflowTemplateStep | undefined {
  return CREATIVE_WORKFLOW_TEMPLATES.find((tpl) => tpl.key === templateKey)?.steps.find((step) => step.key === stepKey)
}

type StepExecutionResult = {
  ok: boolean
  error?: string
  aiRunId?: string
  longTaskId?: string
  videoTaskIds?: string[]
  resultSummary?: string
}

async function executeWorkflowStep(
  r: ReturnType<typeof getRepos>,
  runId: string,
  step: WorkflowRunStep,
): Promise<StepExecutionResult> {
  const kind = step.kind ?? (step.taskType ? 'ai' : undefined)
  if (kind === 'ai') return executeAiWorkflowStep(step)
  if (kind === 'batch') return executeBatchWorkflowStep(r, step)
  if (kind === 'video_tasks') return executeVideoTaskDraftStep(r, runId, step)
  return { ok: false, error: '工作流步骤缺少可执行类型' }
}

async function executeAiWorkflowStep(step: WorkflowRunStep): Promise<StepExecutionResult> {
  if (!step.taskType) return { ok: false, error: 'AI 步骤缺少 taskType' }
  const res = await runAiTask({ ...step.context, taskType: step.taskType, userInstruction: step.context?.userInstruction })
  return {
    ok: res.ok,
    error: res.error,
    aiRunId: res.aiRunId,
    resultSummary: res.ok ? `AI 步骤已完成：${TASK_TYPE_LABELS[step.taskType] ?? step.taskType}` : undefined,
  }
}

async function executeBatchWorkflowStep(
  r: ReturnType<typeof getRepos>,
  step: WorkflowRunStep,
): Promise<StepExecutionResult> {
  if (!step.batchKind) return { ok: false, error: '批量步骤缺少 batchKind' }
  const adaptationProjectId = resolveWorkflowAdaptationProjectId(r, step.context)
  if (!adaptationProjectId) return { ok: false, error: '请先创建或选择改编项目，再运行剧本/分镜批量步骤' }
  const result = await startBatchLongTask(r, {
    kind: step.batchKind,
    projectId: step.context?.projectId,
    adaptationProjectId,
    episodeIds: step.context?.episodeId ? [step.context.episodeId] : undefined,
    sceneIds: step.context?.sceneId ? [step.context.sceneId] : undefined,
  })
  return {
    ok: result.ok,
    error: result.error,
    longTaskId: result.longTaskId,
    resultSummary: result.ok ? `${step.label}已完成，可在任务队列查看明细。` : undefined,
  }
}

async function executeVideoTaskDraftStep(
  r: ReturnType<typeof getRepos>,
  runId: string,
  step: WorkflowRunStep,
): Promise<StepExecutionResult> {
  const config = r.videoProviderConfig.getDefaultVideoProviderConfig(r.db)
  if (!config) return { ok: false, error: '请先在视频生成设置中配置默认 Provider' }
  const shots = collectWorkflowShots(r, step.context)
  if (shots.length === 0) return { ok: false, error: '没有可创建视频任务的镜头，请先完成分镜步骤' }

  const adaptationProjectId = resolveWorkflowAdaptationProjectId(r, step.context)
  const adaptation = adaptationProjectId ? r.adaptationProject.getAdaptationProject(r.db, adaptationProjectId) : undefined
  const projectId = step.context?.projectId ?? adaptation?.sourceProjectId
  const created: VideoGenerationTask[] = []

  for (const shot of shots) {
    const existing = r.videoTask.listVideoTasksByShot(r.db, shot.id).find((task) => task.note?.includes(`workflow:${runId}`))
    if (existing) {
      created.push(existing)
      continue
    }
    created.push(r.videoTask.createVideoTask(r.db, {
      projectId,
      episodeId: shot.episodeId,
      sceneId: shot.sceneId,
      shotId: shot.id,
      provider: config.name,
      model: config.model ?? 'default',
      prompt: shot.videoPrompt || shot.visualDescription,
      negativePrompt: shot.negativePrompt,
      referenceImageUrls: [],
      status: 'pending',
      note: `工作流草稿 workflow:${runId}`,
    }))
  }

  return {
    ok: true,
    videoTaskIds: created.map((task) => task.id),
    resultSummary: `已创建/复用 ${created.length} 个视频任务草稿，进入视频页后可逐条提交。`,
  }
}

function resolveWorkflowAdaptationProjectId(
  r: ReturnType<typeof getRepos>,
  context?: WorkflowRunStep['context'],
): string | undefined {
  if (context?.adaptationProjectId) return context.adaptationProjectId
  if (!context?.projectId) return undefined
  const adaptations = r.adaptationProject.listAdaptationsByProject(r.db, context.projectId)
  return adaptations[adaptations.length - 1]?.id
}

function collectWorkflowShots(
  r: ReturnType<typeof getRepos>,
  context?: WorkflowRunStep['context'],
) {
  if (context?.shotId) {
    const shot = r.shot.getShot(r.db, context.shotId)
    return shot ? [shot] : []
  }
  if (context?.sceneId) return r.shot.listShotsByScene(r.db, context.sceneId)
  if (context?.episodeId) return r.shot.listShotsByEpisode(r.db, context.episodeId)

  const adaptationProjectId = resolveWorkflowAdaptationProjectId(r, context)
  if (!adaptationProjectId) return []
  return r.script
    .listScripts(r.db, adaptationProjectId)
    .flatMap((script) => r.scene.listScenesByScript(r.db, script.id))
    .flatMap((scene) => r.shot.listShotsByScene(r.db, scene.id))
}

async function runAiTask(input: NovelWorkflowInput) {
  const r = getRepos()
  const { provider } = resolveProviderForTask(r, input.taskType, input.templateScope, input.projectId)
  return runNovelWorkflow({ repos: r, provider }, input)
}
