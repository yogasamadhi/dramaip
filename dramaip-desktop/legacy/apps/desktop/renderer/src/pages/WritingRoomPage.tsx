// v0.8 多 Agent 编剧室页面（ROADMAP v0.8 §2）：选目标章节 → 勾选 Agent → 运行 → 展示各 Agent 意见 + 主编整合
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Bot, CheckCircle2, Loader2, Sparkles, Users } from 'lucide-react'
import type { AgentProfile, Chapter, Project, ProjectAgentScheme, WritingRoomResult } from '@sdns/core'
import { AGENT_ROLE_LABELS } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

function ScoreBadge({ score }: { score: number }) {
  const variant = score >= 75 ? 'default' : score >= 50 ? 'secondary' : 'destructive'
  return <Badge variant={variant as 'default' | 'secondary' | 'destructive'}>{score} 分</Badge>
}

function ReviewCard({ review }: { review: WritingRoomResult['reviews'][number] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-primary" />
            {review.agentName}
            <span className="text-xs font-normal text-muted-foreground">
              {AGENT_ROLE_LABELS[review.role] ?? review.role}
            </span>
          </CardTitle>
          <ScoreBadge score={review.score} />
        </div>
        <p className="text-sm text-muted-foreground">{review.summary}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {review.issues.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">问题</div>
            <ul className="list-inside list-disc space-y-1">
              {review.issues.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {review.suggestions.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">建议</div>
            <ul className="list-inside list-disc space-y-1">
              {review.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {review.issues.length === 0 && review.suggestions.length === 0 && (
          <p className="text-xs text-muted-foreground">该 Agent 未给出具体意见。</p>
        )}
      </CardContent>
    </Card>
  )
}

export function WritingRoomPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chapterId, setChapterId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [schemes, setSchemes] = useState<ProjectAgentScheme[]>([])
  const [schemeId, setSchemeId] = useState<string | null>(null)
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WritingRoomResult | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const p = await ipc.project.get(id)
    setProject(p ?? null)
    const cs = await ipc.chapter.list(id)
    setChapters(cs)
    setChapterId((prev) => prev ?? cs[0]?.id ?? null)
    const ags = await ipc.agent.list()
    setAgents(ags)
    const nextSchemes = await ipc.projectAgentScheme.list(id)
    const activeScheme = nextSchemes.find((scheme) => scheme.active)
    setSchemes(nextSchemes)
    setSchemeId(activeScheme?.id ?? null)
    setSelectedAgents(new Set(activeScheme?.agentIds.length ? activeScheme.agentIds : ags.filter((a) => a.enabled).map((a) => a.id)))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  function toggleAgent(agentId: string) {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  async function switchScheme(nextSchemeId: string) {
    const scheme = schemes.find((item) => item.id === nextSchemeId)
    if (!scheme) return
    const updated = await ipc.projectAgentScheme.setActive(scheme.id)
    const active = updated ?? scheme
    setSchemeId(active.id)
    setSchemes((prev) => prev.map((item) => ({ ...item, active: item.id === active.id })))
    setSelectedAgents(new Set(active.agentIds))
    toast.success('已切换项目 Agent 方案')
  }

  async function run() {
    if (!id || !chapterId) {
      toast.error('请先选择一个章节作为审稿目标')
      return
    }
    if (selectedAgents.size === 0) {
      toast.error('请至少选择一个 Agent')
      return
    }
    setBusy(true)
    const tid = toast.loading('编剧室审稿中（多 Agent 串行 + 主编整合）…')
    try {
      const res = await ipc.writingRoom.run({
        targetKind: 'chapter',
        targetId: chapterId,
        projectId: id,
        chapterId,
        agentIds: [...selectedAgents],
        userInstruction: instruction.trim() || undefined,
      })
      if (res.ok && res.result) {
        setResult(res.result)
        toast.success('审稿完成', { id: tid })
      } else {
        toast.error('审稿失败：' + (res.error ?? '未知错误'), { id: tid })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!project) {
    return <div className="p-8 text-sm text-muted-foreground">加载项目…</div>
  }

  const sortedReviews = (result?.reviews ?? []).slice().sort((a, b) => b.score - a.score)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${project.id}`)}>
          <ArrowLeft />
        </Button>
        <Users className="h-5 w-5" />
        <h1 className="text-lg font-semibold">多 Agent 编剧室</h1>
        <Badge variant="secondary">{project.title}</Badge>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：目标 + Agent 选择 */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">审稿目标</div>
              {chapters.length === 0 ? (
                <p className="text-xs text-muted-foreground">该项目暂无章节。</p>
              ) : (
                <Select value={chapterId ?? undefined} onValueChange={setChapterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择章节" />
                  </SelectTrigger>
                  <SelectContent>
                    {chapters.map((c, i) => (
                      <SelectItem key={c.id} value={c.id}>
                        {i + 1}. {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {schemes.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">项目 Agent 方案</div>
                <Select value={schemeId ?? undefined} onValueChange={(value) => void switchScheme(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择方案" />
                  </SelectTrigger>
                  <SelectContent>
                    {schemes.map((scheme) => (
                      <SelectItem key={scheme.id} value={scheme.id}>
                        {scheme.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">参与 Agent</div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedAgents(new Set(agents.map((a) => a.id)))}
                >
                  全选
                </button>
              </div>
              <div className="space-y-1">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => toggleAgent(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selectedAgents.has(a.id) ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    {selectedAgents.has(a.id) ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <Bot className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1">{a.name}</span>
                    {a.builtIn && <Badge variant="outline" className="text-xs">内置</Badge>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">额外要求（可选）</div>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="如：重点关注前 3 章留存与钩子强度"
                className="text-sm"
              />
            </div>

            <Button className="w-full" onClick={run} disabled={busy || !chapterId || selectedAgents.size === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              开始审稿（{selectedAgents.size} 个 Agent）
            </Button>
          </div>
        </aside>

        {/* 右：结果 */}
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-6">
              {!result ? (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                  选择章节与 Agent 后点击「开始审稿」，各 Agent 会从不同视角给出意见，最后由主编整合修改方案。
                </div>
              ) : (
                <>
                  {/* 主编整合 */}
                  <Card className="border-primary/40 bg-primary/5">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Sparkles className="h-4 w-4 text-primary" />
                          主编整合方案
                        </CardTitle>
                        <ScoreBadge score={result.consolidated.score} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {result.consolidated.keyIssues.length > 0 && (
                        <div>
                          <div className="mb-1 font-medium text-muted-foreground">关键问题（按优先级）</div>
                          <ol className="list-inside list-decimal space-y-1">
                            {result.consolidated.keyIssues.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <Separator />
                      <div>
                        <div className="mb-1 font-medium text-muted-foreground">整合修改方案</div>
                        <p className="whitespace-pre-wrap">{result.consolidated.revisionPlan}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="text-sm font-medium">各 Agent 审稿意见（按评分排序）</div>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {sortedReviews.map((r) => (
                      <ReviewCard key={r.agentId} review={r} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  )
}
