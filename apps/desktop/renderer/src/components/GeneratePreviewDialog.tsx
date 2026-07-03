// GeneratePreviewDialog —— generate 类 AI 产物的预览弹窗（§11.1-11.4）
// 「采用并保存」→ onAdopt（经 IPC ai:applyResult 落库）；「丢弃」→ onCancel（不入库）
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type {
  EpisodesResult,
  GenerateChapterOutlinesResult,
  GenerateCharactersResult,
  GenerateProjectResult,
  GenerateStoryArcOutlineResult,
  VisualProfileResult,
  VisualSettingResult,
} from '@sdns/core'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type PreviewTaskType =
  | 'generate_project'
  | 'generate_characters'
  | 'generate_book_outline'
  | 'generate_chapter_outline'
  | 'generate_story_arc_outline'
  | 'generate_character_visual_profile'
  | 'generate_visual_setting'
  | 'convert_novel_to_episodes'

interface Props {
  open: boolean
  taskType: PreviewTaskType
  data: unknown
  onAdopt: () => Promise<void>
  onCancel: () => void
}

const TITLE: Record<PreviewTaskType, string> = {
  generate_project: 'AI 生成的项目设定',
  generate_characters: 'AI 生成的人物卡',
  generate_book_outline: 'AI 生成的全书大纲',
  generate_chapter_outline: 'AI 生成的章节大纲',
  generate_story_arc_outline: 'AI 生成的卷/单元规划',
  generate_character_visual_profile: 'AI 生成的人物视觉档案',
  generate_visual_setting: 'AI 生成的视觉设定',
  convert_novel_to_episodes: 'AI 生成的分集大纲',
}

export function GeneratePreviewDialog({ open, taskType, data, onAdopt, onCancel }: Props) {
  const [saving, setSaving] = useState(false)

  async function handleAdopt() {
    setSaving(true)
    try {
      await onAdopt()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onCancel()
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{TITLE[taskType]}</DialogTitle>
          <DialogDescription>预览生成结果，确认后写入项目；不满意可丢弃后重新生成。</DialogDescription>
        </DialogHeader>

        <div className="-mr-2 flex-1 overflow-auto pr-2 text-sm">
          {taskType === 'generate_project' && <ProjectPreview data={data as GenerateProjectResult} />}
          {taskType === 'generate_characters' && (
            <CharactersPreview data={data as GenerateCharactersResult} />
          )}
          {taskType === 'generate_book_outline' && <TextPreview text={String(data ?? '')} />}
          {taskType === 'generate_chapter_outline' && (
            <ChapterOutlinesPreview data={data as GenerateChapterOutlinesResult} />
          )}
          {taskType === 'generate_story_arc_outline' && (
            <StoryArcOutlinesPreview data={data as GenerateStoryArcOutlineResult} />
          )}
          {taskType === 'generate_character_visual_profile' && (
            <VisualProfilePreview data={data as VisualProfileResult} />
          )}
          {taskType === 'generate_visual_setting' && (
            <VisualSettingPreview data={data as VisualSettingResult} />
          )}
          {taskType === 'convert_novel_to_episodes' && (
            <EpisodesPreview data={data as EpisodesResult} />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            丢弃
          </Button>
          <Button onClick={handleAdopt} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            采用并保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectPreview({ data }: { data: GenerateProjectResult }) {
  return (
    <div className="space-y-2">
      <Field label="作品标题" value={data.title} strong />
      <Field label="一句话卖点" value={data.coreHook} />
      <Field label="情绪主轴" value={data.emotionalCore} />
      <Field label="核心爽点" value={data.coreSellingPoint} />
      <Field label="目标集数" value={String(data.targetEpisodeCount)} />
      <Field label="视觉风格方向" value={data.visualStyleDirection} />
      <Field label="故事简介" value={data.synopsis} block />
      <Field label="风格要求" value={data.styleGuide} block />
    </div>
  )
}

function CharactersPreview({ data }: { data: GenerateCharactersResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">将新增 {data.length} 个人物</p>
      {data.map((c, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{c.name}</span>
            <Badge variant="secondary">{c.role}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {c.identity && <span>身份：{c.identity}</span>}
            {c.personality && <span>性格：{c.personality}</span>}
            {c.desire && <span>欲望：{c.desire}</span>}
            {c.weakness && <span>弱点：{c.weakness}</span>}
            {c.arc && <span>弧光：{c.arc}</span>}
            {c.shortDramaFunction && <span>短剧功能：{c.shortDramaFunction}</span>}
          </div>
          {(c.visualDescription || c.appearancePrompt) && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {c.visualDescription && <span className="block">视觉：{c.visualDescription}</span>}
              {c.appearancePrompt && <span className="block">外观 Prompt：{c.appearancePrompt}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ChapterOutlinesPreview({ data }: { data: GenerateChapterOutlinesResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">将新增 {data.length} 条章节大纲</p>
      {data.map((c, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-1 font-medium">
            第 {i + 1} 章 · {c.title}
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {c.objective && <span className="block">本章目标：{c.objective}</span>}
            {c.mainConflict && <span className="block">核心冲突：{c.mainConflict}</span>}
            {c.sellingPoint && <span className="block">爽点：{c.sellingPoint}</span>}
            {c.reversal && <span className="block">反转：{c.reversal}</span>}
            {c.cliffhanger && <span className="block">结尾钩子：{c.cliffhanger}</span>}
            {c.shortDramaNote && <span className="block">AI短剧备注：{c.shortDramaNote}</span>}
            {c.keyVisuals && <span className="block">关键画面：{c.keyVisuals}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function StoryArcOutlinesPreview({ data }: { data: GenerateStoryArcOutlineResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">将新增 {data.length} 条长篇规划</p>
      {data.map((arc, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{storyArcKindLabel(arc.kind)}</Badge>
            <span className="font-medium">{arc.title}</span>
            {arc.parentTitle && <span className="text-xs text-muted-foreground">上级：{arc.parentTitle}</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {arc.targetWordCount && <span>目标字数：{arc.targetWordCount}</span>}
            {arc.targetChapterCount && <span>目标章节：{arc.targetChapterCount}</span>}
            {(arc.chapterStart || arc.chapterEnd) && (
              <span>章节范围：{arc.chapterStart ?? '?'}-{arc.chapterEnd ?? '?'}</span>
            )}
          </div>
          {arc.summary && <p className="mt-1 text-xs text-muted-foreground">{arc.summary}</p>}
          {arc.coreConflict && <Field label="核心矛盾" value={arc.coreConflict} />}
          {arc.keyHighlights?.length ? <Field label="关键爽点" value={arc.keyHighlights.join('；')} /> : null}
          {arc.foreshadowingPayoffs?.length ? <Field label="伏笔回收" value={arc.foreshadowingPayoffs.join('；')} /> : null}
        </div>
      ))}
    </div>
  )
}

function storyArcKindLabel(kind: GenerateStoryArcOutlineResult[number]['kind']): string {
  if (kind === 'volume') return '卷'
  if (kind === 'unit') return '单元'
  return '剧情阶段'
}

function TextPreview({ text }: { text: string }) {
  return <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs">{text}</pre>
}

function VisualProfilePreview({ data }: { data: VisualProfileResult }) {
  return (
    <div className="space-y-2">
      <Field label="外观 Prompt" value={data.appearancePrompt} block strong />
      <Field label="脸部描述" value={data.faceDescription} />
      <Field label="发型" value={data.hairstyle} />
      <Field label="服装风格" value={data.clothingStyle} />
      <Field label="体型" value={data.bodyType} />
      <Field label="年龄感" value={data.ageLook} />
      <Field label="气质" value={data.temperament} />
      <Field label="配色方案" value={data.colorPalette} />
      <Field label="负面 Prompt" value={data.negativePrompt} block />
    </div>
  )
}

function VisualSettingPreview({ data }: { data: VisualSettingResult }) {
  return (
    <div className="space-y-2">
      <Field label="名称" value={data.title} strong />
      <div className="flex gap-1.5">
        <span className="shrink-0 text-muted-foreground">类型：</span>
        <Badge variant="secondary">{data.type}</Badge>
      </div>
      <Field label="视觉 Prompt" value={data.visualPrompt} block />
      <Field label="负面 Prompt" value={data.negativePrompt} block />
      <Field label="备注" value={data.notes} block />
    </div>
  )
}

function Field({ label, value, block, strong }: { label: string; value?: string; block?: boolean; strong?: boolean }) {
  if (!value) return null
  return (
    <div className={block ? '' : 'flex gap-1.5'}>
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className={`${block ? 'whitespace-pre-wrap' : ''} ${strong ? 'font-medium' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function EpisodesPreview({ data }: { data: EpisodesResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">将生成 {data.length} 集分集大纲（采用后会覆盖已有分集）</p>
      <ScrollArea className="max-h-[55vh]">
        <div className="space-y-2 pr-2">
          {data.map((e, i) => (
            <div key={i} className="rounded-md border p-2">
              <div className="mb-0.5 flex items-center gap-1.5">
                <Badge variant="outline">第 {i + 1} 集</Badge>
                <span className="text-sm font-medium">{e.title}</span>
              </div>
              <p className="text-xs text-muted-foreground">{e.summary}</p>
              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                <div>钩子：{e.hook}</div>
                <div>冲突：{e.mainConflict}</div>
                <div>悬念：{e.cliffhanger}</div>
                {e.keyVisuals.length > 0 && <div>关键画面：{e.keyVisuals.join('；')}</div>}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
