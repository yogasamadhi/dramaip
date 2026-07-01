import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, Bug, ChevronRight, Cpu, DatabaseBackup, Settings, TimerReset, Users, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

const SETTINGS_ITEMS = [
  {
    title: '模型设置',
    description: '配置 API、默认模型与任务模型绑定',
    path: '/settings/models',
    icon: Cpu,
  },
  {
    title: '视频生成设置',
    description: '管理 AI 视频 Provider、模型与默认参数',
    path: '/settings/video',
    icon: Video,
  },
  {
    title: '数据与备份',
    description: '查看数据库备份、手动备份与恢复',
    path: '/settings/data',
    icon: DatabaseBackup,
  },
  {
    title: '任务队列',
    description: '查看 AI 与视频长任务状态',
    path: '/settings/tasks',
    icon: TimerReset,
  },
  {
    title: 'Agent 配置',
    description: '调整内置与自定义 Agent 的 Prompt 和启用状态',
    path: '/settings/agents',
    icon: Users,
  },
  {
    title: 'Token 与耗时统计',
    description: '查看 AI 调用的 Token、耗时、成功与失败统计',
    path: '/settings/usage',
    icon: BarChart3,
  },
  {
    title: 'AI 诊断',
    description: '查看上下文摘要并导出调试 JSON',
    path: '/settings/diagnostics',
    icon: Bug,
  },
]

export function SettingsPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <Settings className="h-5 w-5" />
        <h1 className="text-lg font-semibold">设置</h1>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {SETTINGS_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="flex min-h-28 items-center gap-4 rounded-md border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
