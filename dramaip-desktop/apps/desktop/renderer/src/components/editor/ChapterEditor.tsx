import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { Bold, Eraser, Heading2, Italic, List, Quote } from 'lucide-react'
import type { Chapter } from '@sdns/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAutosaveDraft, type DraftSaveState } from '@/hooks/useAutosaveDraft'

interface ChapterEditorProps {
  chapter: Chapter
  onContentChange: (markdown: string) => Promise<boolean>
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
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function ChapterEditor({ chapter, onContentChange }: ChapterEditorProps) {
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
        class: 'tiptap-content mx-auto max-w-3xl px-8 py-6 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown?.getMarkdown?.() ?? editor.getText()
      updateDraftContent(md)
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-muted/30 px-3 py-1.5">
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
        <div className="ml-auto" />
        <DraftStateBadge status={status} />
        {status === 'recovered' && (
          <Button type="button" size="sm" variant="ghost" onClick={discardRecovery}>放弃恢复草稿</Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => void flush()} disabled={status === 'clean' || status === 'saved'}>
          保存
        </Button>
        <ToolbarButton isActive={false} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="清除格式">
          <Eraser />
        </ToolbarButton>
      </div>
      <div className={cn('flex-1 overflow-auto bg-background')}>
        <EditorContent editor={editor} />
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
  return <span className={cn('px-2 text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{label[status]}</span>
}
