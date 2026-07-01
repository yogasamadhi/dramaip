import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCcw } from 'lucide-react'
import type { Chapter } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import {
  chaptersWithoutMemory,
  failedLongTasks,
  isHighRiskShot,
  needsScriptReview,
  summarizeQualityGateIssues,
  type QualityGateIssue,
} from '@/lib/qualityGateDashboard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

type IssueTarget =
  | { type: 'workspace'; section: string; chapterId?: string }
  | { type: 'route'; path: string }

interface DashboardIssue extends QualityGateIssue {
  actionLabel: string
  target: IssueTarget
}

export function QualityGateDashboardSection({
  projectId,
  chapters,
  onOpenWorkspaceTarget,
}: {
  projectId: string
  chapters: Chapter[]
  onOpenWorkspaceTarget: (section: string, chapterId?: string) => void
}) {
  const navigate = useNavigate()
  const [issues, setIssues] = useState<DashboardIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = useMemo(() => summarizeQualityGateIssues(issues), [issues])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [memories, adaptations, tasks] = await Promise.all([
        ipc.chapterMemory.list(projectId),
        ipc.adaptationProject.listByProject(projectId),
        ipc.longTask.list(projectId),
      ])
      const next: DashboardIssue[] = chaptersWithoutMemory(chapters, memories).map((chapter) => ({
        id: `memory:${chapter.id}`,
        kind: 'chapter_memory',
        severity: 'warn',
        title: `缺少章节记忆：${chapter.title}`,
        detail: '该章节尚未生成长篇一致性记忆，后续 AI 上下文可能缺少事件、人物变化与视觉要点。',
        actionLabel: '生成记忆',
        target: { type: 'workspace', section: 'memory', chapterId: chapter.id },
      }))

      for (const adaptation of adaptations) {
        const scripts = await ipc.script.list(adaptation.id)
        const reviews = await Promise.all(scripts.map((script) => ipc.scriptReview.get(script.id)))
        scripts.forEach((script, index) => {
          if (!needsScriptReview(script, reviews[index])) return
          next.push({
            id: `script:${script.id}`,
            kind: 'script_review',
            severity: 'warn',
            title: `未审稿剧本：第 ${script.episodeNumber} 集`,
            detail: `${adaptation.title} / ${script.title} 尚未生成剧本审稿，可能遗漏对白、冲突、画面和 AI 视频可生成性问题。`,
            actionLabel: '打开剧本',
            target: { type: 'route', path: `/adaptations/${adaptation.id}/scripts` },
          })
        })

        for (const script of scripts) {
          const scenes = await ipc.scene.listByScript(script.id)
          for (const scene of scenes) {
            const shots = await ipc.shot.listByScene(scene.id)
            const shotReviews = await Promise.all(shots.map((shot) => ipc.shotReview.get(shot.id)))
            shots.forEach((shot, index) => {
              const review = shotReviews[index]
              if (!isHighRiskShot(shot, review)) return
              next.push({
                id: `shot:${shot.id}`,
                kind: 'shot_risk',
                severity: 'block',
                title: `高风险镜头：第 ${shot.shotNumber} 镜`,
                detail: `${adaptation.title} / ${script.title} / ${scene.title}，难度 ${review?.aiVideoDifficulty ?? shot.aiVideoDifficulty ?? '未知'}，综合分 ${review?.overallScore ?? '未审查'}。`,
                actionLabel: '打开分镜',
                target: {
                  type: 'route',
                  path: `/adaptations/${adaptation.id}/shots?episode=${shot.episodeId}&scene=${scene.id}&shot=${shot.id}`,
                },
              })
            })
          }
        }
      }

      failedLongTasks(tasks).forEach((task) => {
        next.push({
          id: `task:${task.id}`,
          kind: 'failed_task',
          severity: 'block',
          title: `失败任务：${task.title}`,
          detail: task.errorMessage ?? `${task.kind} / ${task.taskType ?? '未标记任务类型'} 在 ${formatTime(task.updatedAt)} 失败。`,
          actionLabel: '查看任务',
          target: { type: 'route', path: '/settings/tasks' },
        })
      })

      setIssues(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [chapters, projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  function openIssue(issue: DashboardIssue) {
    if (issue.target.type === 'workspace') {
      onOpenWorkspaceTarget(issue.target.section, issue.target.chapterId)
      return
    }
    navigate(issue.target.path)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">质量闸门</h2>
        <Badge variant={summary.block > 0 ? 'destructive' : summary.warn > 0 ? 'secondary' : 'default'}>
          {summary.total} 项
        </Badge>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
            <RefreshCcw className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-4 gap-2 text-sm">
            <Metric label="全部" value={summary.total} />
            <Metric label="阻塞" value={summary.block} tone="danger" />
            <Metric label="提醒" value={summary.warn} />
            <Metric label="信息" value={summary.info} />
          </div>

          {error && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

          {!loading && issues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              当前项目没有发现待处理质量项。
            </div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue) => (
                <div key={issue.id} className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={issue.severity === 'block' ? 'mt-0.5 h-4 w-4 text-destructive' : 'mt-0.5 h-4 w-4 text-amber-600'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{issue.title}</span>
                        <Badge variant={issue.severity === 'block' ? 'destructive' : 'secondary'}>{severityLabel(issue.severity)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{issue.detail}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openIssue(issue)}>
                      {issue.actionLabel}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === 'danger' ? 'text-lg font-semibold text-destructive' : 'text-lg font-semibold'}>{value}</div>
    </div>
  )
}

function severityLabel(severity: QualityGateIssue['severity']): string {
  if (severity === 'block') return '阻塞'
  if (severity === 'warn') return '提醒'
  return '信息'
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}
