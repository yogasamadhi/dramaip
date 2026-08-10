import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Download, Home, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ipc } from '@/lib/ipc'
import { createRendererErrorMeta, stackFrames } from '@/lib/runtime-errors'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  exporting: boolean
  exportMessage: string | null
}

export class RendererErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    exporting: false,
    exportMessage: null,
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, exportMessage: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void ipc.log.renderer('error', 'error-boundary', 'react render error', {
      ...createRendererErrorMeta(error),
      componentStackFrames: stackFrames(info.componentStack ?? undefined, { skipFirst: false, limit: 10 }),
    }).catch(() => undefined)
  }

  private goHome = (): void => {
    this.setState({ error: null, exportMessage: null })
    window.location.hash = '#/'
  }

  private reload = (): void => {
    window.location.reload()
  }

  private exportDiagnostics = async (): Promise<void> => {
    this.setState({ exporting: true, exportMessage: null })
    try {
      const result = await ipc.diagnostic.exportPackage({ includeContent: false })
      if (result.saved) {
        this.setState({ exportMessage: '诊断包已导出。' })
      } else if (result.error) {
        this.setState({ exportMessage: result.error })
      } else {
        this.setState({ exportMessage: '已取消导出。' })
      }
    } catch (error) {
      this.setState({
        exportMessage: '诊断包导出失败：' + (error instanceof Error ? error.message : String(error)),
      })
    } finally {
      this.setState({ exporting: false })
    }
  }

  render(): ReactNode {
    const error = this.state.error
    if (!error) return this.props.children

    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-2xl rounded-md border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">页面异常</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                当前页面发生异常，应用已保留在恢复界面。可以返回首页、重载页面或导出诊断包。
              </p>
              <div className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <div>类型：{error.name || 'Error'}</div>
                <div>消息长度：{error.message.length}</div>
              </div>
              {this.state.exportMessage ? (
                <p className="mt-3 text-sm text-muted-foreground">{this.state.exportMessage}</p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={this.goHome}>
                  <Home />
                  返回首页
                </Button>
                <Button variant="outline" onClick={this.reload}>
                  <RefreshCw />
                  重载页面
                </Button>
                <Button variant="outline" onClick={() => void this.exportDiagnostics()} disabled={this.state.exporting}>
                  {this.state.exporting ? <Loader2 className="animate-spin" /> : <Download />}
                  导出诊断
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
