import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { Bold, Eraser, Heading2, Italic, List, Quote } from 'lucide-react'
import type { Chapter } from '@sdns/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChapterEditorProps {
  chapter: Chapter
  onContentChange: (markdown: string) => void
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onContentChange)
  onChangeRef.current = onContentChange

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
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => onChangeRef.current(md), 700)
    },
  })

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

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
