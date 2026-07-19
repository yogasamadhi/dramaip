import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckSquare, ChevronRight, Focus, Home, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search, Settings, Sun, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/ThemeProvider'
import {
  clampWorkspacePanelWidth,
  DEFAULT_WORKSPACE_SHELL_PREFERENCES,
  type ContextPanelMode,
  normalizeWorkspaceShellPreferences,
  type WorkspacePanel,
  type WorkspaceShellPreferences,
  WORKSPACE_SHELL_STORAGE_KEY,
  workspaceShellLayout,
} from '@/lib/workspaceShell'
import { cn } from '@/lib/utils'

interface WorkspaceShellProps {
  title: string
  breadcrumbs: string[]
  badge?: ReactNode
  actions?: ReactNode
  context: (mode: ContextPanelMode) => ReactNode
  inspector?: ReactNode
  children: ReactNode
}

function readPreferences(): WorkspaceShellPreferences {
  try {
    return normalizeWorkspaceShellPreferences(JSON.parse(window.localStorage.getItem(WORKSPACE_SHELL_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_WORKSPACE_SHELL_PREFERENCES
  }
}

function useWorkspaceShellPreferences() {
  const [preferences, setPreferences] = useState<WorkspaceShellPreferences>(readPreferences)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const updatePreferences = useCallback((update: Partial<WorkspaceShellPreferences>) => {
    setPreferences((current) => ({ ...current, ...update }))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_SHELL_STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  return { preferences, updatePreferences, viewportWidth }
}

export function GlobalRail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const items = [
    { label: '项目', icon: Home, path: '/' },
    { label: '全局搜索', icon: Search, path: '/search' },
    { label: '任务中心', icon: CheckSquare, path: '/settings/tasks' },
    { label: '设置', icon: Settings, path: '/settings' },
    { label: '云账户', icon: UserRound, path: '/settings/cloud-account' },
  ]

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r bg-muted/30 px-1.5 py-2" aria-label="全局导航">
      <div className="mb-2 flex h-9 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground" aria-label="短剧 IP 工作台">
        IP
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {items.map(({ label, icon: Icon, path }) => (
          <Button
            key={path}
            variant={(path === '/' ? location.pathname === '/' || location.pathname.startsWith('/projects/') || location.pathname.startsWith('/adaptations/') : location.pathname === path) ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={label}
            title={label}
            onClick={() => navigate(path)}
          >
            <Icon />
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="切换明暗主题"
        title={`切换明暗主题（当前${resolvedTheme === 'dark' ? '暗夜' : '明亮'}）`}
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      >
        {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </aside>
  )
}

function ResizeHandle({ panel, onResize }: { panel: WorkspacePanel; onResize: (nextWidth: number) => void }) {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    event.currentTarget.setPointerCapture(event.pointerId)
    const direction = panel === 'context' ? 1 : -1
    const onPointerMove = (moveEvent: PointerEvent) => onResize(startWidth + (moveEvent.clientX - startX) * direction)
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <div
      role="separator"
      aria-label={panel === 'context' ? '调整上下文侧栏宽度' : '调整检查器宽度'}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const delta = event.key === 'ArrowRight' ? 16 : -16
        onResize((event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0) + (panel === 'context' ? delta : -delta))
      }}
      className={cn(
        'absolute z-10 top-0 h-full w-2 cursor-col-resize touch-none outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/25',
        panel === 'context' ? '-right-1' : '-left-1',
      )}
    />
  )
}

export function WorkspaceShell({ title, breadcrumbs, badge, actions, context, inspector, children }: WorkspaceShellProps) {
  const { preferences, updatePreferences, viewportWidth } = useWorkspaceShellPreferences()
  const layout = useMemo(() => workspaceShellLayout(preferences, viewportWidth), [preferences, viewportWidth])

  function resizePanel(panel: WorkspacePanel, width: number) {
    updatePreferences(panel === 'context'
      ? { contextWidth: clampWorkspacePanelWidth(panel, width) }
      : { inspectorWidth: clampWorkspacePanelWidth(panel, width) })
  }

  const isFocusMode = preferences.focusMode
  return (
    <div className="flex h-screen min-w-0 overflow-hidden bg-background text-foreground">
      <GlobalRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0">
            <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <span className="flex min-w-0 items-center gap-1" key={`${crumb}-${index}`}>
                  {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{crumb}</span>
                </span>
              ))}
            </nav>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              {badge}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant={isFocusMode ? 'secondary' : 'ghost'}
              size="icon"
              aria-label={isFocusMode ? '退出专注模式' : '进入专注模式'}
              title={isFocusMode ? '退出专注模式' : '进入专注模式'}
              onClick={() => updatePreferences({ focusMode: !isFocusMode })}
            >
              {isFocusMode ? <Focus /> : <Focus className="opacity-60" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={layout.contextMode === 'hidden' ? '显示上下文侧栏' : '隐藏上下文侧栏'}
              title={layout.contextMode === 'hidden' ? '显示上下文侧栏' : '隐藏上下文侧栏'}
              onClick={() => updatePreferences({ contextCollapsed: !preferences.contextCollapsed, focusMode: false })}
            >
              {layout.contextMode === 'hidden' ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            {inspector && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={layout.inspectorVisible ? '隐藏检查器' : '显示检查器'}
                title={layout.inspectorVisible ? '隐藏检查器' : viewportWidth < 1180 ? '窗口宽度不足时自动隐藏检查器' : '显示检查器'}
                onClick={() => updatePreferences({ inspectorCollapsed: !preferences.inspectorCollapsed, focusMode: false })}
              >
                {layout.inspectorVisible ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            )}
            {actions}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {layout.contextMode !== 'hidden' && (
            <aside
              className="relative shrink-0 overflow-hidden border-r"
              style={{ width: layout.contextMode === 'compact' ? 64 : preferences.contextWidth }}
              data-context-mode={layout.contextMode}
            >
              {context(layout.contextMode)}
              {layout.contextMode === 'full' && <ResizeHandle panel="context" onResize={(width) => resizePanel('context', width)} />}
            </aside>
          )}
          <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
          {inspector && layout.inspectorVisible && (
            <aside className="relative shrink-0 overflow-hidden border-l" style={{ width: preferences.inspectorWidth }}>
              <ResizeHandle panel="inspector" onResize={(width) => resizePanel('inspector', width)} />
              {inspector}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceShellState({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md space-y-2 rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-base font-semibold">{title}</h1>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}
