import { useEffect, useMemo, useState } from 'react'
import { Bookmark, BookmarkCheck, FileInput, Loader2, Search, SendToBack, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { Chapter, InspirationCardKind, InspirationCardSourceKind, InspirationFavorite, Project } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import {
  appendInspirationCardNote,
  buildInspirationCards,
  favoritePayloadFromCard,
  INSPIRATION_KIND_LABELS,
  INSPIRATION_SOURCE_LABELS,
  type InspirationCard,
} from '@/lib/inspirationCards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type KindFilter = InspirationCardKind | 'all'
type SourceFilter = InspirationCardSourceKind | 'all'

interface InspirationDeskSectionProps {
  project: Project
  chapters: Chapter[]
  selectedChapter: Chapter | null
  version: number
  onProjectUpdated(project: Project): void
  onChapterUpdated(chapter: Chapter): void
  onOpenChapter(chapterId: string): void
}

export function InspirationDeskSection({
  project,
  chapters,
  selectedChapter,
  version,
  onProjectUpdated,
  onChapterUpdated,
  onOpenChapter,
}: InspirationDeskSectionProps) {
  const [loading, setLoading] = useState(true)
  const [favorites, setFavorites] = useState<InspirationFavorite[]>([])
  const [sourceData, setSourceData] = useState<Parameters<typeof buildInspirationCards>[0]>({})
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sourceKind, setSourceKind] = useState<SourceFilter>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [targetChapterId, setTargetChapterId] = useState(selectedChapter?.id ?? chapters[0]?.id ?? '')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setTargetChapterId((current) => {
      if (current && chapters.some((chapter) => chapter.id === current)) return current
      return selectedChapter?.id ?? chapters[0]?.id ?? ''
    })
  }, [chapters, selectedChapter?.id])

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      try {
        const [genrePresets, templates, caseStudies, projectAntiTrope, chapterAntiTrope, nextFavorites] =
          await Promise.all([
            ipc.genrePreset.list(),
            ipc.template.list(),
            ipc.caseStudy.list(),
            ipc.creative.listAntiTropeByTarget('project', project.id),
            targetChapterId ? ipc.creative.listAntiTropeByTarget('chapter', targetChapterId) : Promise.resolve([]),
            ipc.inspirationFavorite.list(project.id),
          ])
        if (!alive) return
        setFavorites(nextFavorites)
        setSourceData({
          genrePresets,
          templates,
          caseStudies,
          antiTropeVariants: [...projectAntiTrope, ...chapterAntiTrope],
        })
      } catch (error) {
        if (alive) toast.error('加载灵感台失败：' + (error instanceof Error ? error.message : String(error)))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [project.id, targetChapterId, version])

  const cards = useMemo(
    () => buildInspirationCards({ ...sourceData, favorites }),
    [favorites, sourceData],
  )
  const filteredCards = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return cards.filter((card) => {
      if (kind !== 'all' && card.kind !== kind) return false
      if (sourceKind !== 'all' && card.sourceKind !== sourceKind) return false
      if (favoriteOnly && !card.favorite) return false
      if (!needle) return true
      return [card.title, card.pattern, card.applyTo, card.sourceTitle].some((value) =>
        value.toLowerCase().includes(needle),
      )
    })
  }, [cards, favoriteOnly, kind, query, sourceKind])

  const counts = useMemo(() => {
    return Object.keys(INSPIRATION_KIND_LABELS).map((key) => {
      const cardKind = key as InspirationCardKind
      return { kind: cardKind, count: cards.filter((card) => card.kind === cardKind).length }
    })
  }, [cards])

  async function refreshFavorites() {
    setFavorites(await ipc.inspirationFavorite.list(project.id))
  }

  async function toggleFavorite(card: InspirationCard) {
    setBusyKey(card.key)
    try {
      if (card.favorite) {
        await ipc.inspirationFavorite.remove(card.favorite.id)
        toast.success('已取消收藏')
      } else {
        await ipc.inspirationFavorite.upsert(favoritePayloadFromCard(project.id, card))
        toast.success('已收藏')
      }
      await refreshFavorites()
    } catch (error) {
      toast.error('收藏操作失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusyKey(null)
    }
  }

  async function adoptToProject(card: InspirationCard) {
    setBusyKey(card.key)
    try {
      const patch: Partial<Project> = {
        styleGuide: appendInspirationCardNote(project.styleGuide, card),
      }
      if (card.kind === 'visual' && !project.visualStyleDirection?.trim()) patch.visualStyleDirection = card.pattern.slice(0, 240)
      const updated = await ipc.project.update(project.id, patch)
      if (updated) onProjectUpdated(updated)
      toast.success('已插入项目设定')
    } catch (error) {
      toast.error('插入项目设定失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusyKey(null)
    }
  }

  async function adoptToChapter(card: InspirationCard) {
    const chapter = chapters.find((item) => item.id === targetChapterId)
    if (!chapter) {
      toast.error('请先选择目标章节')
      return
    }
    setBusyKey(card.key)
    try {
      const patch: Partial<Chapter> = {
        shortDramaNote: appendInspirationCardNote(chapter.shortDramaNote, card),
      }
      if (card.kind === 'opening' && !chapter.hook) patch.hook = card.pattern
      if (card.kind === 'conflict' && !chapter.mainConflict) patch.mainConflict = card.pattern
      if (card.kind === 'reversal' && !chapter.reversal) patch.reversal = card.pattern
      if (card.kind === 'cliffhanger' && !chapter.cliffhanger) patch.cliffhanger = card.pattern
      if (card.kind === 'visual') patch.aiVideoNote = appendInspirationCardNote(chapter.aiVideoNote, card)
      const updated = await ipc.chapter.update(chapter.id, patch)
      if (updated) onChapterUpdated(updated)
      toast.success('已插入章节要求')
    } catch (error) {
      toast.error('插入章节要求失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-base font-semibold">灵感台</h2>
            <div className="text-xs text-muted-foreground">
              {cards.length} 张卡片，{favorites.length} 张收藏
            </div>
          </div>
          <Select value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(INSPIRATION_KIND_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceKind} onValueChange={(value) => setSourceKind(value as SourceFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {Object.entries(INSPIRATION_SOURCE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={favoriteOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFavoriteOnly((value) => !value)}
          >
            {favoriteOnly ? <BookmarkCheck /> : <Bookmark />}
            收藏
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、模式、来源"
              className="pl-8"
            />
          </div>
          <Select value={targetChapterId || 'none'} onValueChange={(value) => setTargetChapterId(value === 'none' ? '' : value)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chapters.length === 0 && <SelectItem value="none">暂无章节</SelectItem>}
              {chapters.map((chapter, index) => (
                <SelectItem key={chapter.id} value={chapter.id}>
                  {index + 1}. {chapter.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetChapterId && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChapter(targetChapterId)}>
              <SendToBack />
              打开章节
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {counts.map((item) => (
            <Badge key={item.kind} variant={item.count > 0 ? 'secondary' : 'outline'}>
              {INSPIRATION_KIND_LABELS[item.kind]} {item.count}
            </Badge>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载灵感卡片...
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            暂无匹配卡片
          </div>
        ) : (
          <div className="grid gap-3 p-4 xl:grid-cols-2">
            {filteredCards.map((card) => (
              <InspirationCardItem
                key={card.key}
                card={card}
                busy={busyKey === card.key}
                chapterDisabled={chapters.length === 0}
                onFavorite={() => void toggleFavorite(card)}
                onAdoptProject={() => void adoptToProject(card)}
                onAdoptChapter={() => void adoptToChapter(card)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function InspirationCardItem({
  card,
  busy,
  chapterDisabled,
  onFavorite,
  onAdoptProject,
  onAdoptChapter,
}: {
  card: InspirationCard
  busy: boolean
  chapterDisabled: boolean
  onFavorite: () => void
  onAdoptProject: () => void
  onAdoptChapter: () => void
}) {
  return (
    <article className="flex min-h-64 flex-col rounded-md border bg-background p-3 text-sm shadow-sm">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge>{INSPIRATION_KIND_LABELS[card.kind]}</Badge>
            <Badge variant="outline">{INSPIRATION_SOURCE_LABELS[card.sourceKind]}</Badge>
            {card.favorite && <Badge variant="secondary">已收藏</Badge>}
          </div>
          <h3 className="break-words font-medium leading-6">{card.title}</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{card.sourceTitle}</div>
        </div>
        <Button
          type="button"
          variant={card.favorite ? 'default' : 'ghost'}
          size="icon"
          title={card.favorite ? '取消收藏' : '收藏'}
          onClick={onFavorite}
          disabled={busy}
        >
          {card.favorite ? <BookmarkCheck /> : <Bookmark />}
        </Button>
      </div>
      <div className="flex-1 space-y-2">
        <p className="whitespace-pre-wrap break-words leading-6">{card.pattern}</p>
        <div className="rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">可用于：</span>
          {card.applyTo}
        </div>
        {card.risk && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
            {card.risk}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAdoptProject} disabled={busy}>
          <FileInput />
          项目设定
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onAdoptChapter}
          disabled={busy || chapterDisabled}
          className={cn(chapterDisabled && 'opacity-60')}
        >
          {busy ? <Loader2 className="animate-spin" /> : <SendToBack />}
          章节要求
        </Button>
      </div>
    </article>
  )
}
