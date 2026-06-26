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
  exportScriptJson,
  exportScriptMarkdown,
  exportScriptsJson,
  exportScriptsMarkdown,
  exportShotsCsv,
  exportShotsJson,
  exportShotsMarkdown,
  collectProjectPackage,
  serializeProjectPackage,
  importProjectPackage,
} from '@sdns/export'

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
  ipcMain.handle('export:projectPackage', async (_e, projectId: string) => {
    const r = repos()
    try {
      const project = r.project.getProject(r.db, projectId)
      if (!project) return { ok: false, error: '未找到项目' }
      const pkg = collectProjectPackage(r, projectId)
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
      const content = await readFile(open.filePaths[0], 'utf-8')
      const project = importProjectPackage(r, content)
      return { ok: true, project }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
