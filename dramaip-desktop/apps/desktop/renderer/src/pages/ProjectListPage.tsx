import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, BookText, Clapperboard, FileText, FolderOpen, Library, LibraryBig, MoreHorizontal, Plus, Search, Settings, Sparkles, Star, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectHomeSummary } from '@sdns/core'
import { useProjectsStore } from '@/stores/useProjectsStore'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const PINNED_PROJECTS_KEY = 'sdns-pinned-projects-v1'
type SortMode = 'recent' | 'title'

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return iso }
}

function stageLabel(summary: ProjectHomeSummary): string {
  return summary.stage === 'setup' ? '待设定' : summary.stage === 'writing' ? '小说创作' : '短剧制作'
}

function readPinned(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_PROJECTS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function ProjectListPage() {
  const navigate = useNavigate()
  const { summaries, loading, fetch, remove } = useProjectsStore()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [pinned, setPinned] = useState<string[]>(readPinned)

  useEffect(() => { void fetch() }, [fetch])
  useEffect(() => { window.localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(pinned)) }, [pinned])

  const visibleSummaries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return [...summaries]
      .filter(({ project, latestChapter }) => !normalized || [project.title, project.shortDramaType, project.synopsis, latestChapter?.title].some((value) => value?.toLocaleLowerCase().includes(normalized)))
      .sort((left, right) => {
        const pin = Number(pinned.includes(right.project.id)) - Number(pinned.includes(left.project.id))
        if (pin) return pin
        return sort === 'title'
          ? left.project.title.localeCompare(right.project.title, 'zh-CN')
          : right.project.updatedAt.localeCompare(left.project.updatedAt)
      })
  }, [pinned, query, sort, summaries])

  function togglePinned(id: string) {
    setPinned((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function importProject() {
    const toastId = toast.loading('正在导入项目包…')
    const result = await ipc.project.importPackage()
    if (result.ok && result.project) {
      toast.success(`已导入「${result.project.title}」`, { id: toastId })
      await fetch()
      navigate(`/projects/${result.project.id}`)
    } else if (result.canceled) toast.dismiss(toastId)
    else toast.error('导入失败：' + (result.error ?? '未知错误'), { id: toastId })
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`确认删除项目「${title}」？此操作不可恢复。`)) return
    await remove(id)
    toast.success('已删除项目')
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <BookText className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0"><h1 className="truncate text-lg font-semibold">项目工作台</h1><p className="text-xs text-muted-foreground">从一个明确的下一步继续创作</p></div>
        </div>
        <div className="ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <Button variant="ghost" size="icon" aria-label="全局搜索" title="全局搜索" onClick={() => navigate('/search')}><Search /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="更多项目操作" title="更多项目操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void importProject()}><Upload />导入项目包</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/adaptations/new')}><Clapperboard />创建改编</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/genres')}><Library />类型库</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/case-studies')}><LibraryBig />样本库</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/templates')}><FileText />模板</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}><Settings />设置</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => navigate('/projects/new')}><Plus />新建项目</Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full"><div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
          <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><h2 className="font-semibold">继续创作</h2><p className="text-sm text-muted-foreground">项目卡会显示当前阶段、阻塞项与最合适的下一步。</p></div>
            <div className="flex gap-2"><div className="relative flex-1 sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、类型或最近章节" className="pl-9" /></div><Button variant="outline" size="icon" aria-label="切换排序" title={sort === 'recent' ? '按更新时间排序' : '按名称排序'} onClick={() => setSort((current) => current === 'recent' ? 'title' : 'recent')}><ArrowUpDown /></Button></div>
          </section>
          {loading && summaries.length === 0 ? <ProjectCardSkeleton /> : summaries.length === 0 ? (
            <section className="rounded-xl border border-dashed p-10 text-center"><Sparkles className="mx-auto mb-3 h-7 w-7 text-primary" /><h2 className="font-semibold">从一个名字开始</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">先创建空白项目，或在创建页带入灵感；之后可随时补齐类型、人物和故事方向。</p><Button className="mt-5" onClick={() => navigate('/projects/new')}><Plus />新建第一个项目</Button></section>
          ) : visibleSummaries.length === 0 ? <section className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">没有匹配的项目。试试更短的关键词，或清空搜索。</section> : (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{visibleSummaries.map((summary) => <ProjectCard key={summary.project.id} summary={summary} pinned={pinned.includes(summary.project.id)} onPin={() => togglePinned(summary.project.id)} onOpen={() => navigate(summary.nextAction.path)} onDelete={() => void handleDelete(summary.project.id, summary.project.title)} />)}</section>
          )}
        </div></ScrollArea>
      </main>
    </div>
  )
}

function ProjectCard({ summary, pinned, onPin, onOpen, onDelete }: { summary: ProjectHomeSummary; pinned: boolean; onPin: () => void; onOpen: () => void; onDelete: () => void }) {
  const { project } = summary
  return <Card className="studio-card-interactive flex min-h-72 flex-col overflow-hidden"><CardHeader className="space-y-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><CardTitle className="line-clamp-2 text-base">{project.title}</CardTitle><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.synopsis || '还没有简介；先写下一个让人想继续看的开场。'}</p></div><Button variant={pinned ? 'secondary' : 'ghost'} size="icon" aria-label={pinned ? '取消置顶' : '置顶项目'} title={pinned ? '取消置顶' : '置顶项目'} onClick={onPin}><Star className={pinned ? 'fill-current' : undefined} /></Button></div><div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{project.shortDramaType}</Badge><Badge variant="outline">{stageLabel(summary)}</Badge>{summary.blockerCount > 0 && <Badge variant="destructive">{summary.blockerCount} 项阻塞</Badge>}</div></CardHeader><CardContent className="flex-1 space-y-3 text-sm"><div className="rounded-lg bg-muted/50 p-3"><div className="text-xs text-muted-foreground">当前下一步</div><div className="mt-1 font-medium">{summary.nextAction.label}</div><div className="mt-1 truncate text-xs text-muted-foreground">{summary.latestChapter ? `最近：${summary.latestChapter.title}` : '先补充项目设定，AI 才能给出可用的创作建议。'}</div></div><div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>{summary.chapterCount} 章 · {summary.wordCount.toLocaleString()} 字</span><span className="text-right">更新 {formatDate(project.updatedAt)}</span>{summary.adaptation && <span className="col-span-2 truncate">改编：{summary.adaptation.title} · {summary.adaptation.episodeCount} 集</span>}</div></CardContent><CardFooter className="gap-2"><Button size="sm" className="flex-1" onClick={onOpen}><FolderOpen />{summary.nextAction.label}</Button><Button variant="ghost" size="icon" aria-label="删除项目" title="删除项目" onClick={onDelete}><Trash2 className="text-destructive" /></Button></CardFooter></Card>
}

function ProjectCardSkeleton() { return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((index) => <div key={index} className="h-72 rounded-xl border bg-card p-5"><div className="studio-skeleton h-5 w-2/3 rounded" /><div className="studio-skeleton mt-3 h-10 rounded" /><div className="studio-skeleton mt-5 h-20 rounded" /></div>)}</div> }
