import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  insertScriptBlock,
  moveScriptBlock,
  parseScriptMarkdown,
  removeScriptBlock,
  replaceScriptBlock,
  scriptBlockLabel,
  serializeScriptMarkdown,
  type ScriptBlock,
  type ScriptBlockKind,
} from '@sdns/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface StructuredScriptEditorProps {
  content: string
  disabled?: boolean
  onChange: (content: string) => void
}

const BLOCK_OPTIONS: Array<{ kind: ScriptBlockKind; label: string; shortcut: string }> = [
  { kind: 'scene_heading', label: '场景', shortcut: '⌥1' },
  { kind: 'action', label: '动作', shortcut: '⌥2' },
  { kind: 'character', label: '人物', shortcut: '⌥3' },
  { kind: 'dialogue', label: '对白', shortcut: '⌥4' },
  { kind: 'transition', label: '转场', shortcut: '⌥5' },
]

const BLOCK_KIND_LABEL: Record<ScriptBlockKind, string> = Object.fromEntries(
  BLOCK_OPTIONS.map((item) => [item.kind, item.label]),
) as Record<ScriptBlockKind, string>

/**
 * 不引入新的持久化格式的结构化剧本编辑器。每次变更都重新序列化到 Markdown，
 * 因而自动保存、AI 预览采用、版本恢复和现有导出仍走同一个可靠通道。
 */
export function StructuredScriptEditor({ content, disabled = false, onChange }: StructuredScriptEditorProps) {
  const document = useMemo(() => parseScriptMarkdown(content), [content])
  const blockRefs = useRef(new Map<number, HTMLElement>())
  const focusIndexRef = useRef<number | null>(null)

  useEffect(() => {
    const index = focusIndexRef.current
    if (index === null) return
    focusIndexRef.current = null
    const timer = window.setTimeout(() => {
      const target = blockRefs.current.get(index)?.querySelector<HTMLElement>('input, textarea, select')
      target?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [content])

  function update(next: ReturnType<typeof parseScriptMarkdown>) {
    onChange(serializeScriptMarkdown(next))
  }

  function insert(afterId: string | undefined, kind: ScriptBlockKind, focusIndex?: number) {
    focusIndexRef.current = focusIndex ?? document.blocks.length
    update(insertScriptBlock(document, afterId, kind))
  }

  function handleBlockShortcut(event: KeyboardEvent<HTMLElement>, block: ScriptBlock, index: number) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      insert(block.id, 'action', index + 1)
      return
    }
    if (!event.altKey) return
    const option = BLOCK_OPTIONS.find((item) => item.shortcut.endsWith(event.key))
    if (!option) return
    event.preventDefault()
    update(replaceScriptBlock(document, block.id, { kind: option.kind, speaker: option.kind === 'dialogue' ? (block.speaker || '人物') : undefined }))
  }

  const sceneOutline = document.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind === 'scene_heading')

  return (
    <div className="grid gap-3 xl:grid-cols-[11rem_minmax(0,1fr)]" data-script-editor="structured">
      <aside className="order-2 rounded-md border bg-muted/20 p-2 xl:order-none xl:sticky xl:top-3 xl:h-fit">
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">场景大纲</p>
        {sceneOutline.length ? (
          <div className="flex gap-1 overflow-x-auto xl:block xl:space-y-1 xl:overflow-visible">
            {sceneOutline.map(({ block, index }, sceneIndex) => (
              <button
                key={block.id}
                type="button"
                className="shrink-0 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block xl:w-full"
                onClick={() => blockRefs.current.get(index)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })}
              >
                场 {sceneIndex + 1} · {block.text || '未命名'}
              </button>
            ))}
          </div>
        ) : <p className="px-1 text-xs text-muted-foreground">添加场景标题后会在这里形成大纲。</p>}
      </aside>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2" aria-label="插入剧本块">
          {BLOCK_OPTIONS.map((option) => (
            <Button key={option.kind} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => insert(document.blocks.at(-1)?.id, option.kind)} title={`添加${option.label}（${option.shortcut}）`}>
              <Plus className="h-3.5 w-3.5" />{option.label}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">⌘/Ctrl+Enter 新动作 · ⌥1–5 改变块类型</span>
        </div>

        <div className="space-y-2">
          {document.blocks.map((block, index) => (
            <article
              key={block.id}
              ref={(node) => { if (node) blockRefs.current.set(index, node); else blockRefs.current.delete(index) }}
              className={cn('group rounded-md border bg-background p-2.5 shadow-sm transition-colors motion-reduce:transition-none', block.kind === 'scene_heading' && 'border-primary/35 bg-primary/[0.035]', block.kind === 'dialogue' && 'border-iris/25')}
              data-script-block={block.kind}
              data-script-block-index={index}
              onKeyDown={(event) => handleBlockShortcut(event, block, index)}
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <label className="text-xs font-medium text-muted-foreground" htmlFor={`script-block-kind-${block.id}`}>块类型</label>
                <select
                  id={`script-block-kind-${block.id}`}
                  value={block.kind}
                  disabled={disabled}
                  onChange={(event) => update(replaceScriptBlock(document, block.id, { kind: event.target.value as ScriptBlockKind, speaker: event.target.value === 'dialogue' ? (block.speaker || '人物') : undefined }))}
                  className="h-7 rounded border bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${scriptBlockLabel(block)}的块类型`}
                >
                  {BLOCK_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">{BLOCK_KIND_LABEL[block.kind]}</span>
                <div className="ml-auto flex items-center gap-0.5 opacity-80 group-hover:opacity-100 focus-within:opacity-100">
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || index === 0} onClick={() => update(moveScriptBlock(document, block.id, -1))} title="上移块"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || index === document.blocks.length - 1} onClick={() => update(moveScriptBlock(document, block.id, 1))} title="下移块"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={disabled} onClick={() => update(removeScriptBlock(document, block.id))} title="删除块"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <BlockFields block={block} disabled={disabled} onChange={(patch) => update(replaceScriptBlock(document, block.id, patch))} />
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

function BlockFields({ block, disabled, onChange }: { block: ScriptBlock; disabled: boolean; onChange: (patch: Partial<Omit<ScriptBlock, 'id'>>) => void }) {
  if (block.kind === 'scene_heading' || block.kind === 'transition' || block.kind === 'character') {
    const placeholder = block.kind === 'scene_heading' ? '例如：医院走廊 · 夜' : block.kind === 'transition' ? '例如：切至下一场' : '人物名'
    return <Input value={block.text} disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} placeholder={placeholder} aria-label={`${BLOCK_KIND_LABEL[block.kind]}内容`} />
  }
  if (block.kind === 'dialogue') {
    return (
      <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Input value={block.speaker ?? ''} disabled={disabled} onChange={(event) => onChange({ speaker: event.target.value })} placeholder="人物名" aria-label="对白人物" />
        <Textarea value={block.text} disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} rows={2} placeholder="对白内容" aria-label={`${block.speaker || '人物'}的对白`} />
      </div>
    )
  }
  return <Textarea value={block.text} disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} rows={3} placeholder="动作、画面或旁白描述" aria-label="动作内容" />
}
