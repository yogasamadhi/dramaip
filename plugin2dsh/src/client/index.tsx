/**
 * Client face of the DramaIP DSH plugin: a sidebar entry and its main panel.
 * React comes from the page's module table (the installed DSH ships React
 * 18); the bundle never carries its own copy.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { textStats } from '../shared/stats.ts'

const PANEL_ID = 'dramaip.text-stats'

/** The slot registry this plugin uses; `inject` names it. */
interface SlotRegistry {
  inject(slot: string, contribute: () => unknown): void
  register(options: Record<string, unknown>, component: (props: never) => ReactNode): unknown
}

interface ClientContext {
  readonly slots: SlotRegistry
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, TextStatsPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 60,
    label: () => '尽意 · 文本统计',
  }, PanelIcon))
}

function PanelIcon({ size = 16 }: { readonly size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 2.5h7l3 3v8H3z" strokeLinejoin="round" />
      <path d="M5.5 8h5M5.5 10.5h3.5" strokeLinecap="round" />
    </svg>
  )
}

const LABELS: ReadonlyArray<readonly [keyof ReturnType<typeof textStats>, string]> = [
  ['characters', '字符（不含空白）'],
  ['cjkCharacters', '中日韩文字'],
  ['latinWords', '英文词'],
  ['paragraphs', '段落'],
  ['dialogueLines', '对白行'],
  ['readingMinutes', '阅读时长（分钟）'],
]

const page: CSSProperties = { padding: '24px 28px', maxWidth: 760, display: 'grid', gap: 16, color: 'inherit' }
const muted: CSSProperties = { margin: 0, opacity: 0.7, fontSize: 13, lineHeight: 1.6 }
const area: CSSProperties = {
  width: '100%', minHeight: 180, boxSizing: 'border-box', padding: 12, font: 'inherit', fontSize: 14, lineHeight: 1.7,
  color: 'inherit', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: 8, resize: 'vertical',
}
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, margin: 0 }
const cell: CSSProperties = { padding: '10px 12px', border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: 8 }

function TextStatsPanel(): ReactNode {
  const [text, setText] = useState('')
  const stats = useMemo(() => textStats(text), [text])
  return (
    <section style={page} data-dramaip-panel={PANEL_ID}>
      <header>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>尽意 DramaIP · 文本统计</h2>
        <p style={muted}>
          第三方插件占位面板。粘贴章节、场景或剧本片段即可查看统计；
          对话中可让 Agent 调用 <code>dramaip_text_stats</code> 工具得到同样的结果。
        </p>
      </header>
      <textarea
        style={area}
        value={text}
        placeholder="在此粘贴正文……"
        aria-label="正文"
        onChange={event => setText(event.target.value)}
      />
      <dl style={grid}>
        {LABELS.map(([key, label]) => (
          <div key={key} style={cell}>
            <dt style={muted}>{label}</dt>
            <dd style={{ margin: '4px 0 0', fontSize: 20, fontVariantNumeric: 'tabular-nums' }} data-stat={key}>{stats[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
