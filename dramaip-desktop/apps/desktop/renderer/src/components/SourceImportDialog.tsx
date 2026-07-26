import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ipc, type SourceImportPreview, type SourceImportStrategy } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface SourceImportDialogProps {
  projectId: string
  open: boolean
  onOpenChange(open: boolean): void
  onImported(result: { adaptationProjectId?: string }): void
}

export function SourceImportDialog({ projectId, open, onOpenChange, onImported }: SourceImportDialogProps) {
  const [importId, setImportId] = useState<string>()
  const [preview, setPreview] = useState<SourceImportPreview>()
  const [duplicates, setDuplicates] = useState<{ chapters: string[]; episodes: number[] }>({ chapters: [], episodes: [] })
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0)
  const [strategy, setStrategy] = useState<SourceImportStrategy>('append')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [committing, setCommitting] = useState(false)

  const selectedChapter = preview?.chapters[selectedChapterIndex]
  const hasDuplicates = duplicates.chapters.length > 0 || duplicates.episodes.length > 0
  const totalEntries = (preview?.chapters.length ?? 0) + (preview?.episodes.length ?? 0)
  const contentSummary = useMemo(() => {
    if (!preview) return ''
    if (preview.contentKind === 'script') return `识别出 ${preview.episodes.length} 集、${preview.episodes.reduce((sum, episode) => sum + episode.scenes.length, 0)} 个场景`
    return `识别出 ${preview.chapters.length} 个${preview.contentKind === 'draft' ? '草稿段落' : '章节'}`
  }, [preview])
  const writeSummary = useMemo(() => {
    if (!preview) return ''
    const duplicateCount = duplicates.chapters.length + duplicates.episodes.length
    if (strategy === 'append') return `将新建 ${totalEntries} 项，不修改已有正文或剧本。`
    const createCount = Math.max(0, totalEntries - duplicateCount)
    return `将新建约 ${createCount} 项，并${strategy === 'merge' ? '合并' : '覆盖'} ${duplicateCount} 项重复内容；每项修改前都会保存检查点。`
  }, [duplicates, preview, strategy, totalEntries])

  useEffect(() => {
    if (!open) void discardSession()
    // 仅在关闭时释放主进程中的临时内容，源文件不会被保留。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function discardSession() {
    if (importId) await ipc.sourceImport.discard(importId)
    setImportId(undefined)
    setPreview(undefined)
    setDuplicates({ chapters: [], episodes: [] })
    setSelectedChapterIndex(0)
    setStrategy('append')
    setRightsConfirmed(false)
    setDestructiveConfirmed(false)
  }

  async function chooseFile() {
    setChoosing(true)
    try {
      const result = await ipc.sourceImport.choose(projectId)
      if (result.canceled) return
      if (!result.ok || !result.preview || !result.importId) {
        toast.error(result.error ?? '无法读取导入文件')
        return
      }
      setImportId(result.importId)
      setPreview(result.preview)
      setDuplicates(result.duplicates ?? { chapters: [], episodes: [] })
      setSelectedChapterIndex(0)
      setStrategy('append')
      setRightsConfirmed(false)
      setDestructiveConfirmed(false)
    } finally {
      setChoosing(false)
    }
  }

  function updateSelectedChapter(patch: Partial<{ title: string; content: string }>) {
    if (!preview || selectedChapterIndex < 0) return
    setPreview({
      ...preview,
      chapters: preview.chapters.map((chapter, index) => index === selectedChapterIndex
        ? { ...chapter, ...patch, wordCount: [...(patch.content ?? chapter.content).replace(/\s/g, '')].length }
        : chapter),
    })
  }

  function addChapter() {
    if (!preview) return
    const next = [...preview.chapters, {
      key: `manual-${Date.now()}`,
      title: `第${preview.chapters.length + 1}章`,
      content: '',
      orderIndex: preview.chapters.length,
      wordCount: 0,
    }]
    setPreview({ ...preview, chapters: next })
    setSelectedChapterIndex(next.length - 1)
  }

  function removeSelectedChapter() {
    if (!preview || preview.chapters.length <= 1) return
    const next = preview.chapters.filter((_, index) => index !== selectedChapterIndex).map((chapter, index) => ({ ...chapter, orderIndex: index }))
    setPreview({ ...preview, chapters: next })
    setSelectedChapterIndex(Math.max(0, selectedChapterIndex - 1))
  }

  async function commit() {
    if (!importId || !preview) return
    setCommitting(true)
    try {
      const result = await ipc.sourceImport.commit({
        importId,
        projectId,
        strategy,
        rightsConfirmed: true,
        destructiveConfirmed,
        preview,
      })
      if (!result.ok || !result.result) {
        toast.error(result.error ?? '导入失败；未写入任何部分内容')
        return
      }
      const summary = result.result
      toast.success(`导入完成：新增 ${summary.createdChapters} 章、${summary.createdScripts} 集剧本${summary.checkpointCount ? `；已保存 ${summary.checkpointCount} 个检查点` : ''}`)
      setImportId(undefined)
      setPreview(undefined)
      onOpenChange(false)
      onImported({ adaptationProjectId: summary.adaptationProjectId })
    } finally {
      setCommitting(false)
    }
  }

  const canCommit = Boolean(importId && preview && totalEntries > 0 && rightsConfirmed && (strategy === 'append' || destructiveConfirmed) && !committing)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0" aria-describedby="source-import-description">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>导入小说主稿或漫剧剧本</DialogTitle>
          <DialogDescription id="source-import-description">
            支持 TXT、Markdown、DOCX、EPUB 与结构化剧本 JSON。先预览再写入；原始文件只读，不会上传或修改。
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4 px-6 py-8 text-sm">
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
              <FilePlus2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">选择拥有授权的内容文件</p>
              <p className="mt-1 text-xs text-muted-foreground">不支持 PDF OCR、DRM 绕过或抓取付费内容。</p>
              <Button className="mt-4" onClick={() => void chooseFile()} disabled={choosing}>
                {choosing ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
                选择文件并解析
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid max-h-[72vh] min-h-[32rem] grid-rows-[auto_1fr] gap-3 px-6 py-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{preview.fileName}</span>
                <Badge variant="secondary">{preview.sourceType}</Badge>
                <Badge variant="outline">{preview.contentKind === 'script' ? '结构化剧本' : preview.contentKind === 'novel' ? '小说正文' : '草稿文本'}</Badge>
                <span className="text-xs text-muted-foreground">{contentSummary} · {preview.charCount.toLocaleString('zh-CN')} 字符</span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void chooseFile()} disabled={choosing}>重新选择</Button>
              </div>
              {preview.warnings.map((warning) => <p key={warning} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">{warning}</p>)}
              {hasDuplicates && <p className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">发现重复：{duplicates.chapters.length ? `${duplicates.chapters.length} 个同名章节` : ''}{duplicates.chapters.length && duplicates.episodes.length ? '；' : ''}{duplicates.episodes.length ? `${duplicates.episodes.length} 个同集号剧本` : ''}。默认会新建，不覆盖已有内容。</p>}
              <p className="text-xs text-muted-foreground">{writeSummary}</p>
            </div>

            {preview.contentKind === 'script' ? (
              <ScrollArea className="rounded-md border">
                <div className="space-y-2 p-3">
                  {preview.episodes.map((episode) => (
                    <div key={episode.key} className="rounded border p-3 text-sm">
                      <div className="font-medium">第 {episode.episodeNumber} 集 · {episode.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{episode.scenes.length} 个场景 · {episode.content.length.toLocaleString('zh-CN')} 字符</div>
                      {episode.scenes.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{episode.scenes.map((scene) => `${scene.title}（${scene.dialogueCount} 段对白 / ${scene.actionCount} 段动作）`).join(' · ')}</div>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="grid min-h-0 grid-cols-[12rem_1fr] gap-3">
                <ScrollArea className="rounded-md border">
                  <div className="space-y-1 p-2">
                    {preview.chapters.map((chapter, index) => (
                      <button key={chapter.key} type="button" onClick={() => setSelectedChapterIndex(index)} className={`w-full rounded px-2 py-2 text-left text-xs ${index === selectedChapterIndex ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                        <span className="block truncate">{chapter.title}</span>
                        <span className="text-[10px] opacity-70">{chapter.wordCount.toLocaleString('zh-CN')} 字</span>
                      </button>
                    ))}
                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={addChapter}><Plus />新增章节</Button>
                  </div>
                </ScrollArea>
                {selectedChapter && (
                  <div className="min-h-0 space-y-2 rounded-md border p-3">
                    <div className="flex gap-2">
                      <Input aria-label="导入章节标题" value={selectedChapter.title} onChange={(event) => updateSelectedChapter({ title: event.target.value })} />
                      <Button variant="ghost" size="icon" aria-label="删除当前导入章节" title="删除当前导入章节" onClick={removeSelectedChapter} disabled={preview.chapters.length <= 1}><Trash2 /></Button>
                    </div>
                    <Textarea aria-label="导入章节正文" value={selectedChapter.content} onChange={(event) => updateSelectedChapter({ content: event.target.value })} className="h-[20rem] resize-none font-mono text-xs" />
                    <p className="text-xs text-muted-foreground">可直接剪切、拆分或新增章节以修正边界；空章节不会写入。</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
              <label className="flex items-start gap-2"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-0.5" />我确认拥有此内容的使用权，或已取得必要授权。</label>
              <label className="flex items-center gap-2">重复内容策略：
                <select value={strategy} onChange={(event) => { setStrategy(event.target.value as SourceImportStrategy); setDestructiveConfirmed(false) }} className="h-8 rounded border bg-background px-2">
                  <option value="append">默认新建（不覆盖）</option>
                  <option value="merge">合并到同名内容</option>
                  <option value="replace">覆盖同名内容</option>
                </select>
              </label>
              {strategy !== 'append' && <label className="flex items-start gap-2 text-amber-800 dark:text-amber-200"><input type="checkbox" checked={destructiveConfirmed} onChange={(event) => setDestructiveConfirmed(event.target.checked)} className="mt-0.5" />我理解这会修改已有内容；系统会先创建可恢复的检查点。</label>}
              <p className="text-muted-foreground">写入在一个事务中完成：取消、解析失败或中途出错都不会留下部分章节、分集或场景。导入后只提供建议，绝不自动采用人物、大纲或故事设定。</p>
            </div>
          </div>
        )}

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          {preview && <Button onClick={() => void commit()} disabled={!canCommit}>{committing ? <Loader2 className="animate-spin" /> : <FilePlus2 />}确认导入</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
