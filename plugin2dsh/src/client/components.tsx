import { useMemo } from 'react'
import { diffLines } from 'diff'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(
    () => diffLines(before, after, { timeout: 200, maxEditLength: 10000 }),
    [before, after],
  )
  if (!parts)
    return (
      <div>
        <p>差异较大，改为显示完整原稿与建议稿。</p>
        <h3>原稿</h3>
        <pre className="dip-diff">{before}</pre>
        <h3>建议稿</h3>
        <pre className="dip-diff">{after}</pre>
      </div>
    )
  return (
    <pre className="dip-diff" aria-label="逐行差异">
      {parts.map((part, i) => (
        <span key={i} className={part.added ? 'dip-add' : part.removed ? 'dip-remove' : ''}>
          {part.value.split('\n').map((line, n, lines) =>
            n === lines.length - 1 && line === '' ? null : (
              <span className="dip-diff-line" key={n}>
                {part.added ? '+ ' : part.removed ? '− ' : '  '}
                {line}
                {'\n'}
              </span>
            ),
          )}
        </span>
      ))}
    </pre>
  )
}
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false }), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'style', 'form', 'input'],
      }),
    [text],
  )
  return <div className="dip-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
