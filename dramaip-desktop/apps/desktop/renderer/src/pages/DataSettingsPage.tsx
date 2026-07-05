import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, DatabaseBackup, HardDrive, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import type { DatabaseBackupInfo } from '@/lib/ipc'
import { ipc } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function backupKindLabel(kind: DatabaseBackupInfo['kind']): string {
  if (kind === 'manual') return '手动'
  if (kind === 'pre_restore') return '恢复前'
  if (kind === 'auto') return '自动'
  return '未知'
}

export function DataSettingsPage() {
  const navigate = useNavigate()
  const [backups, setBackups] = useState<DatabaseBackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'create' | `restore:${string}` | null>(null)

  async function reload() {
    setLoading(true)
    try {
      setBackups(await ipc.dataBackup.list())
    } catch (error) {
      toast.error('备份列表读取失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const summary = useMemo(() => {
    const totalBytes = backups.reduce((sum, item) => sum + item.sizeBytes, 0)
    const latest = backups[0]
    return { totalBytes, latest }
  }, [backups])

  async function handleCreateBackup() {
    setBusy('create')
    try {
      const result = await ipc.dataBackup.create()
      if (!result.ok) {
        toast.error('备份失败：' + (result.error ?? '未知错误'))
        if (result.backups) setBackups(result.backups)
        return
      }
      setBackups(result.backups ?? [])
      toast.success(`已创建备份：${result.backup?.fileName ?? '完成'}`)
    } catch (error) {
      toast.error('备份失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(null)
    }
  }

  async function handleRestore(backup: DatabaseBackupInfo) {
    const confirmed = window.confirm(
      `确定恢复备份 ${backup.fileName}？\n恢复前会自动创建一份当前数据库备份，恢复成功后应用会刷新。`,
    )
    if (!confirmed) return

    setBusy(`restore:${backup.path}`)
    try {
      const result = await ipc.dataBackup.restore(backup.path)
      if (!result.ok) {
        toast.error('恢复失败：' + (result.error ?? '未知错误'))
        if (result.backups) setBackups(result.backups)
        return
      }
      setBackups(result.backups ?? [])
      toast.success(`已恢复备份，安全备份：${result.safetyBackup?.fileName ?? '已创建'}`)
      window.setTimeout(() => window.location.reload(), 700)
    } catch (error) {
      toast.error('恢复失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <DatabaseBackup className="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">数据与备份</h1>
          <p className="truncate text-sm text-muted-foreground">本机 SQLite 备份与恢复</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw />
            刷新
          </Button>
          <Button size="sm" onClick={() => void handleCreateBackup()} disabled={busy !== null}>
            {busy === 'create' ? <Loader2 className="animate-spin" /> : <DatabaseBackup />}
            手动备份
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-5xl space-y-6 p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <HardDrive className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-xs text-muted-foreground">备份数量</div>
                    <div className="text-2xl font-semibold">{backups.length}</div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-xs text-muted-foreground">占用空间</div>
                    <div className="text-2xl font-semibold">{formatBytes(summary.totalBytes)}</div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">最近备份</div>
                  <div className="mt-1 truncate text-sm font-medium">
                    {summary.latest ? formatDate(summary.latest.createdAt) : '暂无'}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{summary.latest?.fileName ?? '尚未生成备份'}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">备份列表</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                ) : backups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无数据库备份。</p>
                ) : (
                  <div className="space-y-3">
                    {backups.map((backup) => {
                      const restoring = busy === `restore:${backup.path}`
                      return (
                        <div
                          key={backup.path}
                          className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{backup.fileName}</span>
                              <Badge variant="secondary">{backupKindLabel(backup.kind)}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>{formatDate(backup.createdAt)}</span>
                              <span>{formatBytes(backup.sizeBytes)}</span>
                              <span className="min-w-0 max-w-full truncate">{backup.path}</span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRestore(backup)}
                            disabled={busy !== null}
                          >
                            {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            恢复
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
