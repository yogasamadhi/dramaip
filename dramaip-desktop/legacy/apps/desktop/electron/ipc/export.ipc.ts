// 导出 Markdown / JSON（项目说明.md §15）—— 主进程走保存对话框写文件
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { getRepos } from '../db'
import {
  exportAdaptationJson,
  exportAdaptationMarkdown,
  exportChapterMarkdown,
  exportProjectJson,
  exportProjectMarkdown,
  exportNovelSubmissionJson,
  exportNovelSubmissionMarkdown,
  exportDramaEpisodeDeliveryJson,
  exportDramaEpisodeDeliveryMarkdown,
  exportDramaProposalJson,
  exportDramaProposalMarkdown,
  exportDramaShotDeliveryCsv,
  exportDramaShotDeliveryJson,
  exportDramaShotDeliveryMarkdown,
  exportScriptJson,
  exportScriptMarkdown,
  exportScriptsJson,
  exportScriptsMarkdown,
  exportShotsCsv,
  exportShotsJson,
  exportShotsMarkdown,
  collectProjectPackage,
  serializeProjectPackage,
  previewProjectPackage,
  importProjectPackage,
  type ProjectPackageOptions,
  type DramaDeliveryExportData,
  type DramaDeliveryExportOptions,
  type NovelSubmissionExportData,
  type NovelSubmissionExportOptions,
} from '@sdns/export'
import { assertReadableImportFile } from '../file-security'

export function registerExportIpc(): void {
  const repos = () => getRepos()

  async function saveFile(defaultName: string, content: string, filters: Electron.FileFilter[]) {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters,
    })
    if (res.canceled || !res.filePath) return { saved: false as const }
    try {
      await writeFile(res.filePath, content, 'utf-8')
      return { saved: true as const, path: res.filePath }
    } catch (e) {
      return { saved: false as const, error: '写盘失败：' + (e instanceof Error ? e.message : String(e)) }
    }
  }

  /** v1.0：统一把「未找到实体」转为结构化错误结果，而非抛异常 */
  function notFound(what: string) {
    return { saved: false as const, error: `未找到${what}` }
  }

  function projectPackagePreviewDetail(preview: ReturnType<typeof previewProjectPackage>): string {
    const c = preview.counts
    return [
      `包版本：v${preview.version}`,
      `导出时间：${preview.exportedAt}`,
      `项目名：${preview.projectTitle}`,
      `数据规模：共 ${c.totalRecords} 条记录`,
      `人物 ${c.characters}，章节 ${c.chapters}，大纲 ${c.outlines}，评分 ${c.evaluations}`,
      `改编 ${c.adaptations}，分集 ${c.episodes}，剧本 ${c.scripts}，场景 ${c.scenes}`,
      `记忆/分析 ${c.memories}，创意诊断 ${c.creativeReports}，内容版本 ${c.contentVersions}`,
      `AI 记录 ${c.aiRuns}，样本 ${c.caseStudies}，工作流 ${c.workflowRuns}，资产 ${c.assets}`,
    ].join('\n')
  }

  function collectNovelSubmissionData(projectId: string): NovelSubmissionExportData | undefined {
    const r = repos()
    const project = r.project.getProject(r.db, projectId)
    if (!project) return undefined
    return {
      project,
      characters: r.character.listCharacters(r.db, projectId),
      outlines: r.outline.listOutlines(r.db, projectId),
      chapters: r.chapter.listChapters(r.db, projectId),
      evaluations: r.evaluation.listEvaluations(r.db, projectId),
      qualityGateReports: r.creative.listQualityGateReports(r.db, projectId),
    }
  }

  function collectDramaDeliveryData(adaptationId: string): DramaDeliveryExportData | undefined {
    const r = repos()
    const adaptation = r.adaptationProject.getAdaptationProject(r.db, adaptationId)
    if (!adaptation) return undefined
    const project = adaptation.sourceProjectId ? r.project.getProject(r.db, adaptation.sourceProjectId) : undefined
    const characters = adaptation.sourceProjectId ? r.character.listCharacters(r.db, adaptation.sourceProjectId) : []
    const episodes = r.episode.listEpisodes(r.db, adaptationId)
    const scripts = r.script.listScripts(r.db, adaptationId)
    const scenes = scripts.flatMap((script) => r.scene.listScenesByScript(r.db, script.id))
    const shots = scenes.flatMap((scene) => r.shot.listShotsByScene(r.db, scene.id))
    const videoTasks = episodes.flatMap((episode) => r.videoTask.listVideoTasksByEpisode(r.db, episode.id))
    const videoResults = videoTasks.flatMap((task) => r.videoResult.listVideoResultsByTask(r.db, task.id))
    const visualAssetVersions = adaptation.sourceProjectId ? r.visualAsset.listVisualAssetVersionsByProject(r.db, adaptation.sourceProjectId) : []
    const shotVisualAssetLocks = adaptation.sourceProjectId ? r.visualAsset.listShotVisualAssetLocksByProject(r.db, adaptation.sourceProjectId) : []
    const assets = adaptation.sourceProjectId ? r.asset.listProjectAssets(r.db, adaptation.sourceProjectId) : []
    const assetRightsRecords = adaptation.sourceProjectId ? r.rights.listAssetRightsByProject(r.db, adaptation.sourceProjectId) : []
    return {
      project,
      adaptation,
      characters,
      episodes,
      episodeAnalysis: r.episodeAnalysis.getEpisodeAnalysis(r.db, adaptationId),
      scripts,
      scenes,
      shots,
      videoTasks,
      videoResults,
      visualAssetVersions,
      shotVisualAssetLocks,
      assets,
      assetRightsRecords,
      scriptReviews: scripts
        .map((script) => r.scriptReview.getScriptReview(r.db, script.id))
        .filter((review): review is NonNullable<typeof review> => Boolean(review)),
      shotReviews: shots
        .map((shot) => r.shotReview.getShotReview(r.db, shot.id))
        .filter((review): review is NonNullable<typeof review> => Boolean(review)),
    }
  }

  ipcMain.handle('export:projectMarkdown', async (_e, projectId: string) => {
    const db = repos().db
    const project = repos().project.getProject(db, projectId)
    if (!project) return notFound('项目')
    const characters = repos().character.listCharacters(db, projectId)
    const outlines = repos().outline.listOutlines(db, projectId)
    const chapters = repos().chapter.listChapters(db, projectId)
    const md = exportProjectMarkdown({ project, characters, outlines, chapters })
    return saveFile(`${project.title}.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:projectJson', async (_e, projectId: string) => {
    const db = repos().db
    const project = repos().project.getProject(db, projectId)
    if (!project) return notFound('项目')
    const characters = repos().character.listCharacters(db, projectId)
    const outlines = repos().outline.listOutlines(db, projectId)
    const chapters = repos().chapter.listChapters(db, projectId)
    const evaluations = repos().evaluation.listEvaluations(db, projectId)
    const json = exportProjectJson({ project, characters, outlines, chapters, evaluations })
    return saveFile(`${project.title}.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:novelSubmissionMarkdown', async (_e, projectId: string, options?: NovelSubmissionExportOptions) => {
    const data = collectNovelSubmissionData(projectId)
    if (!data) return notFound('项目')
    const md = exportNovelSubmissionMarkdown(data, options)
    return saveFile(`${data.project.title}-小说投稿包.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:novelSubmissionJson', async (_e, projectId: string, options?: NovelSubmissionExportOptions) => {
    const data = collectNovelSubmissionData(projectId)
    if (!data) return notFound('项目')
    const json = exportNovelSubmissionJson(data, options)
    return saveFile(`${data.project.title}-小说投稿包.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:dramaProposalMarkdown', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const md = exportDramaProposalMarkdown(data, options)
    return saveFile(`${data.adaptation.title}-短剧提案包.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:dramaProposalJson', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const json = exportDramaProposalJson(data, options)
    return saveFile(`${data.adaptation.title}-短剧提案包.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:dramaEpisodeDeliveryMarkdown', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const md = exportDramaEpisodeDeliveryMarkdown(data, options)
    return saveFile(`${data.adaptation.title}-分集交付包.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:dramaEpisodeDeliveryJson', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const json = exportDramaEpisodeDeliveryJson(data, options)
    return saveFile(`${data.adaptation.title}-分集交付包.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:dramaShotDeliveryMarkdown', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const md = exportDramaShotDeliveryMarkdown(data, options)
    return saveFile(`${data.adaptation.title}-分镜交付包.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:dramaShotDeliveryJson', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const json = exportDramaShotDeliveryJson(data, options)
    return saveFile(`${data.adaptation.title}-分镜交付包.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:dramaShotDeliveryCsv', async (_e, adaptationId: string, options?: DramaDeliveryExportOptions) => {
    const data = collectDramaDeliveryData(adaptationId)
    if (!data) return notFound('改编项目')
    const csv = exportDramaShotDeliveryCsv(data, options)
    return saveFile(`${data.adaptation.title}-分镜交付表.csv`, csv, [{ name: 'CSV', extensions: ['csv'] }])
  })

  ipcMain.handle('export:chapterMarkdown', async (_e, chapterId: string) => {
    const db = repos().db
    const chapter = repos().chapter.getChapter(db, chapterId)
    if (!chapter) return notFound('章节')
    const md = exportChapterMarkdown(chapter)
    return saveFile(`${chapter.title}.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:adaptationMarkdown', async (_e, adaptationId: string) => {
    const db = repos().db
    const adaptation = repos().adaptationProject.getAdaptationProject(db, adaptationId)
    if (!adaptation) return notFound('改编项目')
    const episodes = repos().episode.listEpisodes(db, adaptationId)
    const md = exportAdaptationMarkdown(adaptation, episodes)
    return saveFile(`${adaptation.title}-分集大纲.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:adaptationJson', async (_e, adaptationId: string) => {
    const db = repos().db
    const adaptation = repos().adaptationProject.getAdaptationProject(db, adaptationId)
    if (!adaptation) return notFound('改编项目')
    const episodes = repos().episode.listEpisodes(db, adaptationId)
    const json = exportAdaptationJson(adaptation, episodes)
    return saveFile(`${adaptation.title}-分集大纲.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  // v0.5：单集剧本导出（含场景清单）
  ipcMain.handle('export:scriptMarkdown', async (_e, scriptId: string) => {
    const db = repos().db
    const script = repos().script.getScript(db, scriptId)
    if (!script) return notFound('剧本')
    const scenes = repos().scene.listScenesByScript(db, scriptId)
    const md = exportScriptMarkdown(script, scenes)
    return saveFile(`${script.title}-第${script.episodeNumber}集剧本.md`, md, [
      { name: 'Markdown', extensions: ['md'] },
    ])
  })

  ipcMain.handle('export:scriptJson', async (_e, scriptId: string) => {
    const db = repos().db
    const script = repos().script.getScript(db, scriptId)
    if (!script) return notFound('剧本')
    const scenes = repos().scene.listScenesByScript(db, scriptId)
    const json = exportScriptJson(script, scenes)
    return saveFile(`${script.title}-第${script.episodeNumber}集剧本.json`, json, [
      { name: 'JSON', extensions: ['json'] },
    ])
  })

  // v0.5：整本剧本导出（改编项目下全部剧本）
  ipcMain.handle('export:scriptsMarkdown', async (_e, adaptationId: string) => {
    const db = repos().db
    const adaptation = repos().adaptationProject.getAdaptationProject(db, adaptationId)
    if (!adaptation) return notFound('改编项目')
    const scripts = repos().script.listScripts(db, adaptationId)
    const md = exportScriptsMarkdown(adaptation.title, scripts)
    return saveFile(`${adaptation.title}-剧本.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:scriptsJson', async (_e, adaptationId: string) => {
    const db = repos().db
    const adaptation = repos().adaptationProject.getAdaptationProject(db, adaptationId)
    if (!adaptation) return notFound('改编项目')
    const scripts = repos().script.listScripts(db, adaptationId)
    const json = exportScriptsJson(scripts)
    return saveFile(`${adaptation.title}-剧本.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  // v0.6：场景分镜导出（Markdown / JSON / CSV）
  ipcMain.handle('export:shotsMarkdown', async (_e, sceneId: string) => {
    const db = repos().db
    const scene = repos().scene.getScene(db, sceneId)
    if (!scene) return notFound('场景')
    const shots = repos().shot.listShotsByScene(db, sceneId)
    const md = exportShotsMarkdown(scene.title, shots)
    return saveFile(`${scene.title}-分镜.md`, md, [{ name: 'Markdown', extensions: ['md'] }])
  })

  ipcMain.handle('export:shotsJson', async (_e, sceneId: string) => {
    const db = repos().db
    const scene = repos().scene.getScene(db, sceneId)
    if (!scene) return notFound('场景')
    const shots = repos().shot.listShotsByScene(db, sceneId)
    const json = exportShotsJson(scene.title, shots)
    return saveFile(`${scene.title}-分镜.json`, json, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('export:shotsCsv', async (_e, sceneId: string) => {
    const db = repos().db
    const scene = repos().scene.getScene(db, sceneId)
    if (!scene) return notFound('场景')
    const shots = repos().shot.listShotsByScene(db, sceneId)
    const csv = exportShotsCsv(shots)
    return saveFile(`${scene.title}-镜头Prompt.csv`, csv, [{ name: 'CSV', extensions: ['csv'] }])
  })

  // v1.0：完整项目包导出 / 导入（ROADMAP v1.0-2）
  ipcMain.handle('export:projectPackage', async (_e, projectId: string, options?: ProjectPackageOptions) => {
    const r = repos()
    try {
      const project = r.project.getProject(r.db, projectId)
      if (!project) return { ok: false, error: '未找到项目' }
      const pkg = collectProjectPackage(r, projectId, options)
      const content = serializeProjectPackage(pkg)
      const res = await saveFile(`${project.title}.sdnspkg`, content, [
        { name: '项目包', extensions: ['sdnspkg'] },
      ])
      return res
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('project:importPackage', async () => {
    const r = repos()
    try {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const open = await dialog.showOpenDialog(win!, {
        title: '选择项目包文件',
        filters: [{ name: '项目包', extensions: ['sdnspkg', 'json'] }],
        properties: ['openFile'],
      })
      if (open.canceled || open.filePaths.length === 0) return { ok: false, canceled: true }
      const { readFile } = await import('node:fs/promises')
      const filePath = open.filePaths[0]
      await assertReadableImportFile('projectPackage', filePath)
      const content = await readFile(filePath, 'utf-8')
      const preview = previewProjectPackage(content)
      const confirm = await dialog.showMessageBox(win!, {
        type: 'question',
        buttons: ['导入', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '确认导入项目包',
        message: `导入「${preview.projectTitle}」？`,
        detail: projectPackagePreviewDetail(preview),
      })
      if (confirm.response !== 0) return { ok: false, canceled: true }
      const project = importProjectPackage(r, content)
      return { ok: true, project }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
