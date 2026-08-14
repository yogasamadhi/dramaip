import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Clock3, Command, Heart, Search, Sparkles, Star } from 'lucide-react'
import type { Chapter, NovelTaskType } from '@sdns/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AI_COMMAND_CATEGORIES,
  buildAiCommandCatalog,
  commandStorageKey,
  filterAiCommands,
  normalizeAiCommandActivity,
  recordRecentCommand,
  recommendAiCommands,
  toggleFavoriteCommand,
  type AiCommandActivity,
  type AiCommandCategory,
  type AiCommandDefinition,
} from '@/lib/aiCommandCatalog'
import { cn } from '@/lib/utils'

type PaletteMode = 'recommended' | 'all' | 'favorites' | 'recent'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  chapter: Chapter | null
  onRunChapterTask: (taskType: NovelTaskType) => void
  onOpenExistingTask: (command: AiCommandDefinition) => void
}

function readActivity(projectId: string): AiCommandActivity {
  try {
    return normalizeAiCommandActivity(JSON.parse(window.localStorage.getItem(commandStorageKey(projectId)) ?? 'null'))
  } catch {
    return { favorites: [], recent: [] }
  }
}

export function AiCommandPalette({
  open,
  onOpenChange,
  projectId,
  chapter,
  onRunChapterTask,
  onOpenExistingTask,
}: Props) {
  const catalog = useMemo(buildAiCommandCatalog, [])
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PaletteMode>('recommended')
  const [category, setCategory] = useState<AiCommandCategory | 'all'>('all')
  const [activity, setActivity] = useState<AiCommandActivity>(() => readActivity(projectId))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setActivity(readActivity(projectId))
    setQuery('')
    setMode('recommended')
    setCategory('all')
  }, [projectId])
  useEffect(() => {
    window.localStorage.setItem(commandStorageKey(projectId), JSON.stringify(activity))
  }, [activity, projectId])
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const recommended = useMemo(() => recommendAiCommands(catalog, chapter), [catalog, chapter])
  const listed = useMemo(() => {
    // 默认页只给三项推荐；一旦开始输入，搜索必须覆盖完整注册表，不能把作者困在推荐里。
    const base = query.trim()
      ? catalog
      : mode === 'recommended'
      ? recommended
      : mode === 'favorites'
        ? catalog.filter((command) => activity.favorites.includes(command.taskType))
        : mode === 'recent'
          ? activity.recent.map((taskType) => catalog.find((command) => command.taskType === taskType)).filter((command): command is AiCommandDefinition => Boolean(command))
          : catalog
    return filterAiCommands(category === 'all' ? base : base.filter((command) => command.category === category), query)
  }, [activity, catalog, category, mode, query, recommended])

  function remember(taskType: NovelTaskType) {
    setActivity((current) => recordRecentCommand(current, taskType))
  }

  function run(command: AiCommandDefinition) {
    remember(command.taskType)
    if (command.chapterDirect) {
      onRunChapterTask(command.taskType)
      onOpenChange(false)
      return
    }
    onOpenExistingTask(command)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] max-w-2xl flex-col overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-4 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base"><Command className="h-4 w-4 text-primary" />AI 命令面板</DialogTitle>
          <p className="text-xs text-muted-foreground">搜索全部既有任务；写入策略会在执行前明确显示。</p>
        </DialogHeader>
        <div className="space-y-3 px-4 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="搜索任务、能力或写入策略…" aria-label="搜索 AI 命令" />
          </div>
          <div className="flex flex-wrap gap-1" aria-label="AI 命令筛选">
            {([
              ['recommended', '当前推荐'],
              ['all', `全部任务 ${catalog.length}`],
              ['favorites', `收藏 ${activity.favorites.length}`],
              ['recent', `最近 ${activity.recent.length}`],
            ] as Array<[PaletteMode, string]>).map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={mode === value ? 'secondary' : 'ghost'} className="h-7 text-xs" onClick={() => setMode(value)}>{label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" aria-label="AI 命令分类">
            <Button type="button" size="sm" variant={category === 'all' ? 'outline' : 'ghost'} className="h-7 text-xs" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部分类</Button>
            {AI_COMMAND_CATEGORIES.map((item) => (
              <Button key={item.id} type="button" size="sm" variant={category === item.id ? 'outline' : 'ghost'} className="h-7 text-xs" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</Button>
            ))}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <div className="space-y-1 pt-3">
            {listed.map((command) => {
              const favorite = activity.favorites.includes(command.taskType)
              const needsChapter = command.chapterDirect && !chapter
              return (
                <div key={command.taskType} className={cn('group flex items-center gap-2 rounded-lg border p-2.5 transition-colors hover:bg-accent/50', needsChapter && 'border-warn/40 bg-warn-soft/40')}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => run(command)} disabled={needsChapter}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{command.label}</span>
                      <Badge variant="outline" className="text-[10px]">{command.categoryLabel}</Badge>
                      <Badge variant={command.writePolicy.policy === 'preview_then_adopt' ? 'secondary' : command.writePolicy.policy === 'auto_write' || command.writePolicy.policy === 'snapshot_then_auto_write' ? 'destructive' : 'outline'} className="text-[10px]">{command.writePolicy.label}</Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{command.description}</div>
                    {needsChapter && <div className="mt-1 text-xs text-warn">请先选择或新建章节；这里不会直接调用 AI。</div>}
                    {!command.chapterDirect && <div className="mt-1 text-xs text-muted-foreground">在原有「{command.groupLabel}」工作区继续操作</div>}
                  </button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={favorite ? `取消收藏 ${command.label}` : `收藏 ${command.label}`} onClick={() => setActivity((current) => toggleFavoriteCommand(current, command.taskType))}>
                    {favorite ? <Heart className="h-4 w-4 fill-primary text-primary" /> : <Star className="h-4 w-4" />}
                  </Button>
                  {command.chapterDirect ? <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </div>
              )
            })}
            {listed.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {mode === 'favorites' ? '还没有收藏；可在任意任务右侧点星标。' : mode === 'recent' ? '还没有最近执行的 AI 命令。' : '没有匹配的 AI 命令。'}
              </div>
            )}
          </div>
        </ScrollArea>
        {chapter ? <div className="border-t px-4 py-2 text-xs text-muted-foreground"><Clock3 className="mr-1 inline h-3.5 w-3.5" />当前上下文：第 {chapter.orderIndex + 1} 章 · {chapter.title}</div> : <div className="border-t px-4 py-2 text-xs text-warn">尚未选择章节：章节类命令已禁用，避免只用 Toast 解释阻塞。</div>}
      </DialogContent>
    </Dialog>
  )
}
