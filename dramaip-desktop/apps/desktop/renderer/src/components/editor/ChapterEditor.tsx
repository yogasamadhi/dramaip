import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { AlignJustify, Bold, Crosshair, Eraser, Heading2, Italic, List, Quote, Sparkles, Target, Type } from 'lucide-react'
import type { Chapter } from '@sdns/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAutosaveDraft, type DraftSaveState } from '@/hooks/useAutosaveDraft'

const PREFERENCES_KEY = 'sdns-chapter-editor-preferences-v1'

interface ChapterEditorPreferences {
  fontSize: 16 | 18 | 20
  lineHeight: 1.65 | 1.85 | 2.05
  contentWidth: 680 | 760 | 880
  wordGoal: number
  typewriterMode: boolean
}

const DEFAULT_PREFERENCES: ChapterEditorPreferences = {
  fontSize: 18,
  lineHeight: 1.85,
  contentWidth: 760,
  wordGoal: 1500,
  typewriterMode: false,
}

function readPreferences(): ChapterEditorPreferences {
  try {
    const candidate = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<ChapterEditorPreferences> | null
    const fontSize = candidate?.fontSize === 16 || candidate?.fontSize === 18 || candidate?.fontSize === 20 ? candidate.fontSize : DEFAULT_PREFERENCES.fontSize
    const lineHeight = candidate?.lineHeight === 1.65 || candidate?.lineHeight === 1.85 || candidate?.lineHeight === 2.05 ? candidate.lineHeight : DEFAULT_PREFERENCES.lineHeight
    const contentWidth = candidate?.contentWidth === 680 || candidate?.contentWidth === 760 || candidate?.contentWidth === 880 ? candidate.contentWidth : DEFAULT_PREFERENCES.contentWidth
    const wordGoal = Number.isFinite(candidate?.wordGoal) ? Math.min(100000, Math.max(100, Math.round(Number(candidate?.wordGoal)))) : DEFAULT_PREFERENCES.wordGoal
    return { fontSize, lineHeight, contentWidth, wordGoal, typewriterMode: candidate?.typewriterMode === true }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

interface ChapterEditorProps {
  chapter: Chapter
  onContentChange: (markdown: string) => Promise<boolean>
  onSaveStateChange?: (status: DraftSaveState) => void
  onSelectedTextAi?: (selectedText: string) => void
}

function ToolbarButton({
  isActive,
  onClick,
  title,
  children,
}: {
  isActive: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={isActive ? 'secondary' : 'ghost'}
      size="icon"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function ChapterEditor({ chapter, onContentChange, onSaveStateChange, onSelectedTextAi }: ChapterEditorProps) {
  const {
    value: draftContent,
    updateValue: updateDraftContent,
    flush,
    discardRecovery,
    status,
  } = useAutosaveDraft({
    targetKey: `chapter:${chapter.id}`,
    initialValue: chapter.content || '',
    serialize: (value) => value,
    deserialize: (value) => value,
    save: onContentChange,
  })
  const [preferences, setPreferences] = useState<ChapterEditorPreferences>(readPreferences)
  const [selectedText, setSelectedText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  }, [preferences])

  useEffect(() => {
    onSaveStateChange?.(status)
  }, [onSaveStateChange, status])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder: '开始写作本章正文…（存储为 Markdown）' }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: chapter.content || '',
    editorProps: {
      attributes: {
        class: 'tiptap-content mx-auto min-h-full px-8 py-7 focus:outline-none',
        'aria-label': '章节正文编辑器',
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown?.getMarkdown?.() ?? editor.getText()
      updateDraftContent(md)
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      setSelectedText(from === to ? '' : editor.state.doc.textBetween(from, to, ' '))
      if (!preferencesRef.current.typewriterMode || from === to) return
      window.requestAnimationFrame(() => {
        const container = scrollRef.current
        const domSelection = window.getSelection()
        const anchor = domSelection?.anchorNode?.parentElement
        if (!container || !anchor) return
        const containerRect = container.getBoundingClientRect()
        const anchorRect = anchor.getBoundingClientRect()
        const desiredTop = container.scrollTop + anchorRect.top - containerRect.top - containerRect.height * 0.42
        container.scrollTo({ top: Math.max(0, desiredTop), behavior: 'smooth' })
      })
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown?.getMarkdown?.() ?? editor.getText()
    if (current !== draftContent) editor.commands.setContent(draftContent, false)
  }, [draftContent, editor])

  if (!editor) {
    return <div className="p-8 text-sm text-muted-foreground">编辑器加载中…</div>
  }

  const wordCount = draftContent.replace(/\s/g, '').length
  const goalProgress = Math.min(100, Math.round((wordCount / preferences.wordGoal) * 100))

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-1.5">
        <ToolbarButton isActive={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="加粗">
          <Bold />
        </ToolbarButton>
        <ToolbarButton isActive={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体">
          <Italic />
        </ToolbarButton>
        <ToolbarButton isActive={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="标题">
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton isActive={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用">
          <Quote />
        </ToolbarButton>
        <ToolbarButton isActive={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="列表">
          <List />
        </ToolbarButton>
        <span className="mx-1 h-5 border-l" aria-hidden="true" />
        <label className="flex items-center gap-1 rounded px-1 text-xs text-muted-foreground" title="正文字号">
          <Type className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">正文字号</span>
          <select
            aria-label="正文字号"
            value={preferences.fontSize}
            onChange={(event) => setPreferences((current) => ({ ...current, fontSize: Number(event.target.value) as ChapterEditorPreferences['fontSize'] }))}
            className="h-7 bg-transparent text-xs outline-none"
          >
            <option value="16">16px</option>
            <option value="18">18px</option>
            <option value="20">20px</option>
          </select>
        </label>
        <label className="flex items-center gap-1 rounded px-1 text-xs text-muted-foreground" title="行距">
          <AlignJustify className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">行距</span>
          <select
            aria-label="正文行距"
            value={preferences.lineHeight}
            onChange={(event) => setPreferences((current) => ({ ...current, lineHeight: Number(event.target.value) as ChapterEditorPreferences['lineHeight'] }))}
            className="h-7 max-w-16 bg-transparent text-xs outline-none"
          >
            <option value="1.65">紧凑</option>
            <option value="1.85">舒适</option>
            <option value="2.05">宽松</option>
          </select>
        </label>
        <label className="flex items-center gap-1 rounded px-1 text-xs text-muted-foreground" title="正文宽度">
          <span className="sr-only">正文宽度</span>
          <select
            aria-label="正文宽度"
            value={preferences.contentWidth}
            onChange={(event) => setPreferences((current) => ({ ...current, contentWidth: Number(event.target.value) as ChapterEditorPreferences['contentWidth'] }))}
            className="h-7 max-w-16 bg-transparent text-xs outline-none"
          >
            <option value="680">窄</option>
            <option value="760">标准</option>
            <option value="880">宽</option>
          </select>
        </label>
        <ToolbarButton
          isActive={preferences.typewriterMode}
          onClick={() => setPreferences((current) => ({ ...current, typewriterMode: !current.typewriterMode }))}
          title="打字机滚动"
        >
          <Crosshair />
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-1.5">
          {selectedText.trim() && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelectedTextAi?.(selectedText)}
              title="对选中文本打开 AI 润色预览"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 润色所选
            </Button>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="本章字数目标">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">本章字数目标</span>
            <input
              aria-label="本章字数目标"
              type="number"
              min="100"
              max="100000"
              value={preferences.wordGoal}
              onChange={(event) => setPreferences((current) => ({ ...current, wordGoal: Math.min(100000, Math.max(100, Number(event.target.value) || 100)) }))}
              className="h-7 w-16 rounded border bg-background px-1 text-right text-xs tabular-nums"
            />
          </label>
          <div className="w-16" aria-label={`字数目标：${wordCount}/${preferences.wordGoal}`} title={`字数目标：${wordCount}/${preferences.wordGoal}`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${goalProgress}%` }} />
            </div>
            <div className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">{wordCount}/{preferences.wordGoal}</div>
          </div>
          <DraftStateBadge status={status} />
          {status === 'recovered' && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={discardRecovery}>放弃恢复草稿</Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void flush()} disabled={status === 'clean' || status === 'saved'}>
            保存
          </Button>
          <ToolbarButton isActive={false} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="清除格式">
            <Eraser />
          </ToolbarButton>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={cn('chapter-editor-scroll flex-1 overflow-auto bg-background')}
        style={{
          '--chapter-content-width': `${preferences.contentWidth}px`,
          '--chapter-font-size': `${preferences.fontSize}px`,
          '--chapter-line-height': String(preferences.lineHeight),
        } as CSSProperties}
      >
        <EditorContent
          editor={editor}
        />
      </div>
    </div>
  )
}

function DraftStateBadge({ status }: { status: DraftSaveState }) {
  const label: Record<DraftSaveState, string> = {
    clean: '已保存',
    dirty: '待保存',
    saving: '保存中',
    saved: '已保存',
    error: '保存失败',
    recovered: '已恢复草稿',
  }
  return <span className={cn('px-1 text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{label[status]}</span>
}
