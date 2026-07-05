import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Bookmark, BookmarkCheck, FileInput, FilePlus2, Loader2, PenLine, Search, SendToBack, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  InspirationSchemesResultSchema,
  type Chapter,
  type InspirationCardKind,
  type InspirationCardSourceKind,
  type InspirationFavorite,
  type InspirationSchemeItem,
  type Project,
  type TextDiffPreviewPayload,
} from '@sdns/core'
import { ipc, type AiTaskInput } from '@/lib/ipc'
import {
  appendInspirationCardNote,
  buildInspirationCards,
  favoritePayloadFromCard,
  INSPIRATION_KIND_LABELS,
  INSPIRATION_SOURCE_LABELS,
  type InspirationCard,
} from '@/lib/inspirationCards'
import {
  buildInspirationSchemeInstruction,
  buildSchemeRewriteInstruction,
  normalizeInspirationSchemeForm,
  schemeToProjectSeed,
  type InspirationProjectSeed,
  type InspirationSchemeForm,
} from '@/lib/inspirationSchemes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
  onCreateProject(seed: InspirationProjectSeed): void
  onTextPreview(preview: TextDiffPreviewPayload): void
}

export function InspirationDeskSection({
  project,
  chapters,
  selectedChapter,
  version,
  onProjectUpdated,
  onChapterUpdated,
  onOpenChapter,
  onCreateProject,
  onTextPreview,
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
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importingMobile, setImportingMobile] = useState(false)
  const [schemeForm, setSchemeForm] = useState<InspirationSchemeForm>({
    genre: project.shortDramaType ?? '',
    targetAudience: project.targetAudience ?? '',
    shortDramaDirection: project.coreSellingPoint ?? '',
    brief: '',
  })
  const [schemeTemplateId, setSchemeTemplateId] = useState('')
  const [generatingSchemes, setGeneratingSchemes] = useState(false)
  const [schemes, setSchemes] = useState<InspirationSchemeItem[]>([])
  const [schemeBusyKey, setSchemeBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setTargetChapterId((current) => {
      if (current && chapters.some((chapter) => chapter.id === current)) return current
      return selectedChapter?.id ?? chapters[0]?.id ?? ''
    })
  }, [chapters, selectedChapter?.id])

  useEffect(() => {
    setSchemeForm((current) => ({
      ...current,
      genre: current.genre || project.shortDramaType || '',
      targetAudience: current.targetAudience || project.targetAudience || '',
      shortDramaDirection: current.shortDramaDirection || project.coreSellingPoint || '',
    }))
  }, [project.coreSellingPoint, project.id, project.shortDramaType, project.targetAudience])

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
  const generationTemplates = useMemo(
    () => (sourceData.templates ?? []).filter((template) => template.scope === 'generate_inspiration_schemes'),
    [sourceData.templates],
  )
  const genreOptions = useMemo(() => {
    return Array.from(new Set([
      project.shortDramaType,
      ...(sourceData.genrePresets ?? []).map((preset) => preset.name),
      schemeForm.genre,
    ].map((value) => value?.trim()).filter(Boolean) as string[]))
  }, [project.shortDramaType, schemeForm.genre, sourceData.genrePresets])

  useEffect(() => {
    if (!generationTemplates.length) {
      setSchemeTemplateId((current) => (current === 'direct' ? current : ''))
      return
    }
    setSchemeTemplateId((current) => {
      if (current === 'direct') return current
      if (current && generationTemplates.some((template) => template.id === current)) return current
      return generationTemplates[0].id
    })
  }, [generationTemplates])

  async function refreshFavorites() {
    setFavorites(await ipc.inspirationFavorite.list(project.id))
  }

  async function importMobileInspirationFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 300_000) {
      toast.error('移动灵感文件不能超过 300KB')
      return
    }

    setImportingMobile(true)
    const toastId = toast.loading('正在导入移动灵感...')
    try {
      const content = await file.text()
      const result = await ipc.inspirationFavorite.importMobile({
        projectId: project.id,
        content,
        fileName: file.name,
      })
      await refreshFavorites()
      if (result.imported > 0) {
        setSourceKind('mobile_import')
        setFavoriteOnly(false)
        const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 条` : ''
        toast.success(`已导入 ${result.imported} 条移动灵感${skipped}`, { id: toastId })
      } else {
        toast.error(result.warnings[0] ?? '没有可导入的移动灵感', { id: toastId })
      }
    } catch (error) {
      toast.error('移动灵感导入失败：' + (error instanceof Error ? error.message : String(error)), { id: toastId })
    } finally {
      setImportingMobile(false)
    }
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

  async function generateSchemes() {
    const normalized = normalizeInspirationSchemeForm(schemeForm, project)
    setSchemeForm(normalized)
    setGeneratingSchemes(true)
    const toastId = toast.loading('正在生成灵感方案...')
    try {
      const userInstruction = buildInspirationSchemeInstruction(normalized)
      let aiInput: AiTaskInput = {
        projectId: project.id,
        taskType: 'generate_inspiration_schemes' as const,
        userInstruction,
      }
      if (schemeTemplateId && schemeTemplateId !== 'direct') {
        const runRes = await ipc.template.run({
          templateId: schemeTemplateId,
          projectId: project.id,
          variables: {
            genre: normalized.genre,
            targetAudience: normalized.targetAudience,
            shortDramaDirection: normalized.shortDramaDirection,
            brief: normalized.brief ?? '',
          },
          userInstruction,
        })
        if (!runRes.ok || !runRes.aiInput) {
          toast.error('模板运行失败：' + (runRes.error ?? '未知错误'), { id: toastId })
          return
        }
        aiInput = runRes.aiInput
      }

      const res = await ipc.ai.run(aiInput)
      if (!res.ok || !res.result) {
        toast.error('灵感方案生成失败：' + (res.error ?? '未知错误'), { id: toastId })
        return
      }
      const parsed = InspirationSchemesResultSchema.safeParse(res.result.data)
      if (!parsed.success) {
        toast.error('灵感方案格式不完整，请重试', { id: toastId })
        return
      }
      setSchemes(parsed.data.schemes)
      toast.success(`已生成 ${parsed.data.schemes.length} 组灵感方案`, { id: toastId })
    } catch (error) {
      toast.error('灵感方案生成异常：' + (error instanceof Error ? error.message : String(error)), { id: toastId })
    } finally {
      setGeneratingSchemes(false)
    }
  }

  function createProjectFromScheme(scheme: InspirationSchemeItem) {
    onCreateProject(schemeToProjectSeed(scheme, normalizeInspirationSchemeForm(schemeForm, project)))
  }

  async function rewriteChapterWithScheme(scheme: InspirationSchemeItem) {
    const chapter = chapters.find((item) => item.id === targetChapterId)
    if (!chapter) {
      toast.error('请先选择目标章节')
      return
    }
    const key = schemeKey(scheme)
    setSchemeBusyKey(key)
    const toastId = toast.loading('正在生成章节改写预览...')
    try {
      const res = await ipc.ai.run({
        projectId: project.id,
        chapterId: chapter.id,
        taskType: 'rewrite_chapter',
        userInstruction: buildSchemeRewriteInstruction(scheme, chapter),
      })
      if (res.ok && res.result?.kind === 'text_preview') {
        onTextPreview(res.result.data as TextDiffPreviewPayload)
        toast.success('改写预览已生成', { id: toastId })
      } else {
        toast.error('章节改写失败：' + (res.error ?? '未返回文本预览'), { id: toastId })
      }
    } catch (error) {
      toast.error('章节改写异常：' + (error instanceof Error ? error.message : String(error)), { id: toastId })
    } finally {
      setSchemeBusyKey(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              生成灵感方案
            </div>
            <Select value={schemeTemplateId || 'direct'} onValueChange={setSchemeTemplateId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">直接生成</SelectItem>
                {generationTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={() => void generateSchemes()} disabled={generatingSchemes}>
              {generatingSchemes ? <Loader2 className="animate-spin" /> : <Sparkles />}
              生成
            </Button>
          </div>
          <div className="grid gap-2 lg:grid-cols-3">
            <Select value={schemeForm.genre || undefined} onValueChange={(value) => setSchemeForm((form) => ({ ...form, genre: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="题材" />
              </SelectTrigger>
              <SelectContent>
                {genreOptions.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={schemeForm.targetAudience}
              onChange={(event) => setSchemeForm((form) => ({ ...form, targetAudience: event.target.value }))}
              placeholder="目标受众"
            />
            <Input
              value={schemeForm.shortDramaDirection}
              onChange={(event) => setSchemeForm((form) => ({ ...form, shortDramaDirection: event.target.value }))}
              placeholder="短剧方向"
            />
          </div>
          <Textarea
            value={schemeForm.brief ?? ''}
            onChange={(event) => setSchemeForm((form) => ({ ...form, brief: event.target.value }))}
            placeholder="补充要求"
            rows={2}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-base font-semibold">灵感台</h2>
            <div className="text-xs text-muted-foreground">
              {cards.length} 张卡片，{favorites.length} 张收藏
            </div>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.md,.markdown,application/json,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => void importMobileInspirationFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="导入移动灵感 JSON/Markdown"
            onClick={() => importInputRef.current?.click()}
            disabled={importingMobile}
          >
            {importingMobile ? <Loader2 className="animate-spin" /> : <FileInput />}
            导入
          </Button>
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
        {schemes.length > 0 && (
          <div className="border-b p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">生成方案</div>
              <Badge variant="secondary">{schemes.length} 组</Badge>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {schemes.map((scheme) => {
                const key = schemeKey(scheme)
                return (
                  <InspirationSchemeItemCard
                    key={key}
                    scheme={scheme}
                    busy={schemeBusyKey === key}
                    chapterDisabled={chapters.length === 0}
                    onCreateProject={() => createProjectFromScheme(scheme)}
                    onRewriteChapter={() => void rewriteChapterWithScheme(scheme)}
                  />
                )
              })}
            </div>
          </div>
        )}
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

function schemeKey(scheme: InspirationSchemeItem): string {
  return `${scheme.title}:${scheme.coreHook}`.trim()
}

function InspirationSchemeItemCard({
  scheme,
  busy,
  chapterDisabled,
  onCreateProject,
  onRewriteChapter,
}: {
  scheme: InspirationSchemeItem
  busy: boolean
  chapterDisabled: boolean
  onCreateProject: () => void
  onRewriteChapter: () => void
}) {
  return (
    <article className="flex min-h-72 flex-col rounded-md border bg-background p-3 text-sm shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge>{scheme.genre || '灵感方案'}</Badge>
        {scheme.targetAudience && <Badge variant="outline">{scheme.targetAudience}</Badge>}
        {scheme.shortDramaDirection && <Badge variant="secondary">{scheme.shortDramaDirection}</Badge>}
      </div>
      <h3 className="break-words font-medium leading-6">{scheme.title}</h3>
      <div className="mt-2 flex-1 space-y-2">
        <p className="whitespace-pre-wrap break-words leading-6">{scheme.coreHook}</p>
        <div className="grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-2">
          <SchemeMeta label="冲突" value={scheme.conflictMechanism} />
          <SchemeMeta label="反转" value={scheme.keyReversal} />
          <SchemeMeta label="尾钩" value={scheme.cliffhanger} />
          <SchemeMeta label="画面" value={scheme.visualSellingPoint} />
        </div>
        <div className="rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
          {scheme.chapterRewriteBrief}
        </div>
        {scheme.riskNotes.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
            {scheme.riskNotes.join('；')}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCreateProject}>
          <FilePlus2 />
          创建项目
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onRewriteChapter}
          disabled={busy || chapterDisabled}
          className={cn(chapterDisabled && 'opacity-60')}
        >
          {busy ? <Loader2 className="animate-spin" /> : <PenLine />}
          改写章节
        </Button>
      </div>
    </article>
  )
}

function SchemeMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <span className="font-medium text-foreground">{label}：</span>
      {value}
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
