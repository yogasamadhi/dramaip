import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { GlobalRail } from '@/components/shell/WorkspaceShell'
import { TaskDock } from '@/components/TaskDock'

/**
 * 全局布局根：所有页面共享的左侧全局导航栏（GlobalRail）和任务浮窗（TaskDock）。
 * 通过 React Router 的 layout route 挂载，子路由经 <Outlet /> 渲染。
 *
 * GlobalRail 提供 项目/搜索/任务/设置/云账户 导航和主题切换，在所有页面一致可用。
 * TaskDock 为 fixed 定位，脱离文档流，不影响布局。
 * 断网时顶部显示 banner 提示，避免用户在云端 AI 任务上空等超时。
 */
export function RootLayout() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return (
    <div className="flex h-screen min-w-0 overflow-hidden bg-background text-foreground">
      <GlobalRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!online && (
          <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive" role="status">
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
            网络已断开，云端 AI 任务将无法执行；本地项目和自有 API Key 模型不受影响。
          </div>
        )}
        <Outlet />
      </div>
      <TaskDock />
    </div>
  )
}

