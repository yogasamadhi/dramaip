import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import type { GlobalSearchResult, GlobalSearchResultKind } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const KIND_LABELS: Record<GlobalSearchResultKind, string> = {
  project: '项目',
  character: '人物',
  chapter: '章节',
  script: '剧本',
  scene: '场景',
  shot: '镜头',
  ai_run: 'AI 记录',
}

export function SearchPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = query.trim()
  const grouped = useMemo(() => groupResults(results), [results])

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!trimmed) {
        setResults([])
        setError(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      void ipc.search.global({ query: trimmed, limit: 10 })
        .then((response) => setResults(response.results))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [trimmed])

  function submit() {
    setParams(trimmed ? { q: trimmed } : {})
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">全局搜索</h1>
        <div className="ml-auto flex w-[min(560px,60vw)] items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            placeholder="搜索项目、人物、章节、剧本、场景、镜头 Prompt、AI 记录"
            autoFocus
          />
          <Button onClick={submit} disabled={!trimmed || loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            搜索
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
          {error && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
          {!trimmed ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">输入关键词后开始搜索。</div>
          ) : !loading && results.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">没有匹配结果。</div>
          ) : (
            grouped.map(([kind, items]) => (
              <section key={kind} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{KIND_LABELS[kind]}</h2>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={() => navigate(item.route)}
                      className="block w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.title}</span>
                        {item.subtitle && <span className="text-xs text-muted-foreground">{item.subtitle}</span>}
                      </div>
                      {item.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.snippet}</p>}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function groupResults(results: GlobalSearchResult[]): Array<[GlobalSearchResultKind, GlobalSearchResult[]]> {
  const order: GlobalSearchResultKind[] = ['project', 'character', 'chapter', 'script', 'scene', 'shot', 'ai_run']
  return order
    .map((kind) => [kind, results.filter((result) => result.kind === kind)] as [GlobalSearchResultKind, GlobalSearchResult[]])
    .filter(([, items]) => items.length > 0)
}
