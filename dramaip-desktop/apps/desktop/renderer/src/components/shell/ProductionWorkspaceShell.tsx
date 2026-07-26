import { type ReactNode, useMemo } from 'react'
import { ChevronDown, Download, LayoutDashboard } from 'lucide-react'
import type { AdaptationProject } from '@sdns/core'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  buildProductionStageSummaries,
  productionStageLabel,
  productionStagePath,
  type ProductionStage,
  type ProductionWorkspaceCounts,
} from '@/lib/productionWorkspace'
import { cn } from '@/lib/utils'

export interface ProductionExportAction {
  label: string
  onSelect: () => unknown | Promise<unknown>
}

interface ProductionWorkspaceShellProps {
  adaptation: AdaptationProject
  stage: ProductionStage
  counts: ProductionWorkspaceCounts
  activeEpisodeId?: string | null
  activeEpisodeLabel?: string
  actions?: ReactNode
  exports?: ProductionExportAction[]
  children: ReactNode
}

const STATE_LABEL = {
  complete: '完成',
  in_progress: '进行中',
  blocked: '待前序',
} as const

export function ProductionWorkspaceShell({
  adaptation,
  stage,
  counts,
  activeEpisodeId,
  activeEpisodeLabel,
  actions,
  exports = [],
  children,
}: ProductionWorkspaceShellProps) {
  const navigate = useNavigate()
  const stages = useMemo(() => buildProductionStageSummaries(counts), [counts])
  const projectPath = adaptation.sourceProjectId ? `/projects/${adaptation.sourceProjectId}` : '/'

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-background text-foreground" data-production-stage={stage}>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:px-5">
            <div className="min-w-0">
              <nav aria-label="生产面包屑" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <button className="truncate hover:text-foreground" onClick={() => navigate(projectPath)}>项目</button>
                <span aria-hidden>›</span>
                <button className="truncate hover:text-foreground" onClick={() => navigate(productionStagePath(adaptation.id, 'overview'))}>改编</button>
                <span aria-hidden>›</span>
                <span className="truncate">{productionStageLabel(stage)}</span>
                {activeEpisodeLabel && <><span aria-hidden>›</span><span className="truncate">{activeEpisodeLabel}</span></>}
              </nav>
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold">{adaptation.title}</h1>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">第 {adaptation.seasonNumber ?? 1} 季</span>
              </div>
            </div>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {actions}
              {exports.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" aria-label="导出当前改编交付物">
                      <Download /> 导出 <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {exports.map((item) => (
                      <DropdownMenuItem key={item.label} onSelect={() => void item.onSelect()}>{item.label}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <nav aria-label="改编生产阶段" className="production-stepper overflow-x-auto border-t px-3 lg:px-5">
            <ol className="flex min-w-max items-stretch py-2">
              {stages.map((item, index) => {
                const active = item.key === stage
                return (
                  <li key={item.key} className="flex items-center" data-stage-state={item.state} data-active={active || undefined}>
                    <button
                      className={cn(
                        'group flex min-w-[104px] flex-col rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:bg-accent',
                        active && 'bg-accent',
                      )}
                      onClick={() => navigate(productionStagePath(adaptation.id, item.key, activeEpisodeId))}
                      aria-current={active ? 'step' : undefined}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <span className={cn('h-2 w-2 rounded-full', item.state === 'complete' && 'bg-emerald-500', item.state === 'in_progress' && 'bg-primary', item.state === 'blocked' && 'bg-muted-foreground/45')} />
                        {item.label}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">{active ? '当前阶段' : `${STATE_LABEL[item.state]} · ${item.detail}`}</span>
                    </button>
                    {index < stages.length - 1 && <span className="production-stepper__connector" aria-hidden />}
                  </li>
                )
              })}
            </ol>
          </nav>
        </header>
        <main className="studio-page-enter flex min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}

export function ProductionEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <LayoutDashboard className="h-5 w-5 text-muted-foreground/70" />
      <div>{children}</div>
    </div>
  )
}
