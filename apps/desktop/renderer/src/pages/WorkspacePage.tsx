import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Download, FilePlus2, Loader2, Settings, Sparkles, Trash2 } from 'lucide-react'
import type { AiRun, Chapter, Project } from '@sdns/core'
import { TASK_TYPE_LABELS, WORKSPACE_NAV } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AiAssistantPanel } from '@/components/AiAssistantPanel'
import { GeneratePreviewDialog, type PreviewTaskType } from '@/components/GeneratePreviewDialog'
import { CharactersSection } from '@/components/sections/CharactersSection'
import { ChatSection } from '@/components/sections/ChatSection'
import { OutlineSection } from '@/components/sections/OutlineSection'
import { EvaluationSection } from '@/components/sections/EvaluationSection'
import { MemorySection } from '@/components/sections/MemorySection'
import { CharacterStateSection } from '@/components/sections/CharacterStateSection'
import { VisualProfileSection } from '@/components/sections/VisualProfileSection'
import { VisualSettingSection } from '@/components/sections/VisualSettingSection'
import { TimelineSection } from '@/components/sections/TimelineSection'
import { ForeshadowingSection } from '@/components/sections/ForeshadowingSection'
import { ConsistencySection } from '@/components/sections/ConsistencySection'
import { AiDashboardSection } from '@/components/sections/AiDashboardSection'
import { BeatSection } from '@/components/sections/BeatSection'
import { HighlightSection } from '@/components/sections/HighlightSection'
import { AiVideoFeasibilitySection } from '@/components/sections/AiVideoFeasibilitySection'
import { CreativeDiagnosisSection } from '@/components/sections/CreativeDiagnosisSection'
import { cn } from '@/lib/utils'

const ChapterEditor = lazy(() =>
  import('@/components/editor/ChapterEditor').then((m) => ({ default: m.ChapterEditor })),
)

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [section, setSection] = useState<string>('chapters')
  const [editorNonce, setEditorNonce] = useState(0)
  const [aiRuns, setAiRuns] = useState<AiRun[]>([])
  const [preview, setPreview] = useState<{
    open: boolean
    taskType: PreviewTaskType
    data: unknown
    characterId?: string
  }>({
    open: false,
    taskType: 'generate_project',
    data: null,
  })
  const [generating, setGenerating] = useState<PreviewTaskType | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [generateIdea, setGenerateIdea] = useState('')

  const loadProject = useCallback(async () => {
    if (!id) return
    const p = await ipc.project.get(id)
    setProject(p ?? null)
    const cs = await ipc.chapter.list(id)
    setChapters(cs)
    setSelectedId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : (cs[0]?.id ?? null)))
  }, [id])

  const loadAiRuns = useCallback(async () => {
    if (!id) return
    setAiRuns(await ipc.aiRun.list(id))
  }, [id])

  useEffect(() => {
    void loadProject()
  }, [loadProject])
  useEffect(() => {
    if (section === 'ai-runs') void loadAiRuns()
  }, [section, loadAiRuns])

  const selected = chapters.find((c) => c.id === selectedId) ?? null

  async function createChapter() {
    if (!id) return
    const c = await ipc.chapter.create({ projectId: id, title: `第 ${chapters.length + 1} 章` })
    setChapters((prev) => [...prev, c])
    setSelectedId(c.id)
    setSection('chapters')
    setEditorNonce((n) => n + 1)
  }

  async function deleteChapter(chapterId: string) {
    if (!window.confirm('删除该章节？')) return
    await ipc.chapter.remove(chapterId)
    setChapters((prev) => {
      const next = prev.filter((c) => c.id !== chapterId)
      if (selectedId === chapterId) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }

  async function renameChapter(title: string) {
    if (!selected) return
    const updated = await ipc.chapter.update(selected.id, { title })
    if (updated) setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  async function onContentChange(md: string) {
    if (!selected) return
    await ipc.chapter.updateContent(selected.id, md)
    // 静默更新本地，不触发 nonce（避免编辑器重载导致光标丢失）
    setChapters((prev) => prev.map((c) => (c.id === selected.id ? { ...c, content: md } : c)))
  }

  async function onChapterUpdated() {
    if (!selected) return
    const fresh = await ipc.chapter.get(selected.id)
    if (fresh) setChapters((prev) => prev.map((c) => (c.id === fresh.id ? fresh : c)))
    setEditorNonce((n) => n + 1)
    if (section === 'ai-runs') void loadAiRuns()
  }

  async function handleExport(kind: 'md' | 'json') {
    if (!id) return
    try {
      const res = kind === 'md' ? await ipc.export.projectMarkdown(id) : await ipc.export.projectJson(id)
      if (res.saved) toast.success('已导出：' + res.path)
      else toast.message('已取消导出')
    } catch (e) {
      toast.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // v1.0：完整项目包导出（含全部关联数据，可在另一库重新导入）
  async function handleExportPackage() {
    if (!id) return
    try {
      const res = await ipc.export.projectPackage(id)
      if (res.saved) toast.success('已导出项目包：' + res.path)
      else toast.message('已取消导出')
    } catch (e) {
      toast.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // generate 类：AI 生成 → 预览 → 用户确认后落库（§11.1-11.4 / v0.2 视觉档案/设定）
  async function runGenerate(taskType: PreviewTaskType, userInstruction?: string, characterId?: string) {
    if (!project) return
    setGenerating(taskType)
    const label = TASK_TYPE_LABELS[taskType]
    const id = toast.loading(`正在${label}…`)
    try {
      const res = await ipc.ai.run({
        projectId: project.id,
        taskType,
        characterId,
        userInstruction: userInstruction?.trim() || undefined,
      })
      if (res.ok && res.result) {
        toast.success(`${label}完成，请确认`, { id })
        setPreview({ open: true, taskType, data: res.result.data, characterId })
      } else {
        toast.error(`${label}失败：${res.error ?? '未知错误'}`, { id })
      }
    } catch (e) {
      toast.error(`${label}异常：${e instanceof Error ? e.message : String(e)}`, { id })
    } finally {
      setGenerating(null)
    }
  }

  async function handleAdopt() {
    if (!project) return
    const res = await ipc.ai.applyResult({
      projectId: project.id,
      taskType: preview.taskType,
      data: preview.data,
      characterId: preview.characterId,
    })
    if (res.ok) {
      toast.success('已保存到项目')
      setPreview((p) => ({ ...p, open: false }))
      if (preview.taskType === 'generate_project') {
        void loadProject()
        setGenerateIdea('')
      } else {
        setDataVersion((v) => v + 1)
      }
    } else {
      toast.error('保存失败：' + (res.error ?? '未知错误'))
    }
  }

  if (!project) {
    return <div className="p-8 text-sm text-muted-foreground">加载项目…</div>
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{project.title}</h1>
        <Badge variant="secondary">{project.shortDramaType}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('md')}>导出项目 Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('json')}>导出项目 JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportPackage()}>
                导出完整项目包（.sdnspkg）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <Settings />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：项目导航 */}
        <nav className="w-52 shrink-0 border-r p-2">
          {WORKSPACE_NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                // v0.8：编剧室是独立页面
                if (item.key === 'writing-room') {
                  void navigate(`/projects/${project.id}/writing-room`)
                  return
                }
                setSection(item.key)
              }}
              className={cn(
                'mb-0.5 flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors',
                section === item.key
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'hover:bg-accent/60',
              )}
            >
              {item.label}
            </button>
          ))}
          <Separator className="my-2" />
          <Button variant="outline" size="sm" className="w-full" onClick={createChapter}>
            <FilePlus2 />
            新建章节
          </Button>
        </nav>

        {/* 中：主区 */}
        <section className="flex flex-1 flex-col overflow-hidden border-r">
          {section === 'chapters' && (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                {chapters.length > 0 ? (
                  <Select value={selectedId ?? undefined} onValueChange={(v) => { setSelectedId(v); setEditorNonce((n) => n + 1) }}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="选择章节" />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c, i) => (
                        <SelectItem key={c.id} value={c.id}>
                          {i + 1}. {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm text-muted-foreground">还没有章节</span>
                )}
                <Button size="sm" variant="outline" onClick={createChapter}>
                  <FilePlus2 />
                  新建
                </Button>
                {selected && (
                  <Button size="icon" variant="ghost" title="删除章节" onClick={() => deleteChapter(selected.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              {selected ? (
                <>
                  <div className="border-b px-4 py-2">
                    <Input
                      defaultValue={selected.title}
                      key={selected.id + '-title'}
                      onBlur={(e) => renameChapter(e.target.value)}
                      className="border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">加载编辑器...</div>}>
                      <ChapterEditor
                        key={selected.id + ':' + editorNonce}
                        chapter={selected}
                        onContentChange={onContentChange}
                      />
                    </Suspense>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  点击「新建章节」开始写作。
                </div>
              )}
            </>
          )}

          {section === 'overview' && (
            <ScrollArea className="h-full">
              <div className="space-y-3 p-6 text-sm">
                <h2 className="text-lg font-semibold">{project.title}</h2>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">AI 生成 / 补全项目设定</span>
                  </div>
                  <Textarea
                    value={generateIdea}
                    onChange={(e) => setGenerateIdea(e.target.value)}
                    placeholder="一句话描述你的想法（可选），留空则根据现有类型生成…"
                    rows={2}
                    className="mb-2 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => runGenerate('generate_project', generateIdea)}
                    disabled={generating !== null}
                  >
                    {generating === 'generate_project' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    生成项目设定
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-y-2">
                  <Meta label="短剧类型" value={project.shortDramaType} />
                  <Meta label="目标受众" value={project.targetAudience} />
                  <Meta label="目标字数" value={project.targetWordCount} />
                  <Meta label="目标集数" value={project.targetEpisodeCount} />
                  <Meta label="一句话卖点" value={project.coreHook} />
                  <Meta label="情绪主轴" value={project.emotionalCore} />
                  <Meta label="核心爽点" value={project.coreSellingPoint} />
                  <Meta label="视觉风格方向" value={project.visualStyleDirection} />
                </div>
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">故事简介</div>
                  <p className="whitespace-pre-wrap">{project.synopsis || '（暂无）'}</p>
                </div>
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">小说风格要求</div>
                  <p className="whitespace-pre-wrap">{project.styleGuide || '（暂无）'}</p>
                </div>
              </div>
            </ScrollArea>
          )}

          {section === 'ai-runs' && (
            <ScrollArea className="h-full">
              <div className="p-4">
                {aiRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 AI 调用记录。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">时间</th>
                        <th className="pr-3">类型</th>
                        <th className="pr-3">模型</th>
                        <th className="pr-3">状态</th>
                        <th className="pr-3">耗时</th>
                        <th className="pr-3">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiRuns.map((r) => (
                        <tr key={r.id} className="border-b align-top">
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{formatTime(r.createdAt)}</td>
                          <td className="pr-3">{r.type}</td>
                          <td className="pr-3 text-xs">{r.model}</td>
                          <td className="pr-3">
                            <Badge variant={r.status === 'success' ? 'default' : 'destructive'}>
                              {r.status === 'success' ? '成功' : '失败'}
                            </Badge>
                          </td>
                          <td className="pr-3 text-xs">{r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</td>
                          <td className="pr-3 text-xs">{r.tokenUsage ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </ScrollArea>
          )}

          {section === 'chat' && (
            <ChatSection
              projectId={project.id}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'characters' && (
            <CharactersSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'outline' && (
            <OutlineSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'evaluation' && <EvaluationSection projectId={project.id} chapter={selected} />}

          {section === 'memory' && <MemorySection projectId={project.id} chapter={selected} />}

          {section === 'character-state' && (
            <CharacterStateSection projectId={project.id} version={dataVersion} />
          )}

          {section === 'visual-profile' && (
            <VisualProfileSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'visual-setting' && (
            <VisualSettingSection
              projectId={project.id}
              version={dataVersion}
              onGenerate={runGenerate}
              generating={generating}
            />
          )}

          {section === 'timeline' && (
            <TimelineSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'foreshadowing' && (
            <ForeshadowingSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'consistency' && <ConsistencySection projectId={project.id} chapter={selected} />}

          {section === 'ai-dashboard' && <AiDashboardSection projectId={project.id} />}

          {section === 'creative-diagnosis' && (
            <CreativeDiagnosisSection projectId={project.id} chapter={selected} />
          )}

          {section === 'beats' && (
            <BeatSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'highlights' && (
            <HighlightSection projectId={project.id} chapter={selected} version={dataVersion} />
          )}

          {section === 'ai-video' && (
            <AiVideoFeasibilitySection projectId={project.id} chapter={selected} version={dataVersion} />
          )}
        </section>

        {/* 右：AI 助手 / 信息 */}
        <aside className="w-80 shrink-0 overflow-hidden border-l bg-muted/20">
          {section === 'chapters' ? (
            <ScrollArea className="h-full">
              <AiAssistantPanel
                projectId={project.id}
                chapter={selected}
                onChapterUpdated={onChapterUpdated}
              />
            </ScrollArea>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              在「章节」中使用 AI 写作助手（生成 / 续写 / 润色 / 扩写 / 增强冲突与爽点与 AI 短剧感）。
              <br />
              <br />
              v0.2 新增「长篇一致性」能力：记忆面板、人物状态、人物视觉档案、视觉设定、事件时间线、伏笔、一致性检查，帮助长篇创作保持设定统一。
            </div>
          )}
        </aside>
      </div>

      <GeneratePreviewDialog
        open={preview.open}
        taskType={preview.taskType}
        data={preview.data}
        onAdopt={handleAdopt}
        onCancel={() => setPreview((p) => ({ ...p, open: false }))}
      />
    </div>
  )
}

function Meta({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}：</span>
      <span>{value ?? '—'}</span>
    </div>
  )
}
