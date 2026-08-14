import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BarChart3, Cloud, Copy, DatabaseBackup, HardDrive, KeyRound, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import type { Project } from '@sdns/core'
import type { CloudProjectSnapshot, DatabaseBackupInfo } from '@/lib/ipc'
import { ipc } from '@/lib/ipc'
import { confirmAction, promptAction } from '@/components/ConfirmActionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [cloudSnapshots, setCloudSnapshots] = useState<CloudProjectSnapshot[]>([])
  const [cloudLoading, setCloudLoading] = useState(true)
  const [cloudSignedIn, setCloudSignedIn] = useState(false)
  const [cloudNotice, setCloudNotice] = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [analyticsConsent, setAnalyticsConsent] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [busy, setBusy] = useState<'create' | 'cloud-create' | `restore:${string}` | `cloud-restore:${string}` | `cloud-delete:${string}` | null>(null)

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

  async function reloadCloudSnapshots() {
    setCloudLoading(true)
    try {
      const [nextProjects, cloudStatus] = await Promise.all([ipc.project.list(), ipc.cloudAuth.status()])
      setProjects(nextProjects)
      setSelectedProjectId((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? '')
      setCloudSignedIn(Boolean(cloudStatus.signedIn))
      if (!cloudStatus.signedIn) {
        setCloudSnapshots([])
        setCloudNotice(cloudStatus.enabled === false ? '云端登录尚未启用；本机备份不受影响。' : '登录云端账号后可创建和查看加密快照。')
        return
      }
      const nextSnapshots = await ipc.cloudSnapshot.list()
      setCloudSnapshots(nextSnapshots)
      setCloudNotice('')
    } catch (error) {
      toast.error('云端快照读取失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setCloudLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    void reloadCloudSnapshots()
    void ipc.analytics.getConsent().then((settings) => setAnalyticsConsent(settings.consent)).catch(() => undefined)
  }, [])

  async function updateAnalyticsConsent(consent: 'granted' | 'denied') {
    try {
      const settings = await ipc.analytics.setConsent(consent)
      setAnalyticsConsent(settings.consent)
      toast.success(consent === 'granted' ? '匿名产品分析已开启' : '匿名产品分析已关闭，待发送队列已清空')
    } catch (error) {
      toast.error('分析偏好保存失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

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
    const confirmed = await confirmAction({
      title: `恢复备份「${backup.fileName}」？`,
      description: '恢复前会自动创建当前数据库备份。恢复会替换当前本地数据并刷新应用，可通过新备份再次恢复。',
      confirmLabel: '恢复备份',
      destructive: true,
    })
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

  async function handleCreateCloudSnapshot() {
    if (!cloudSignedIn) {
      navigate('/settings/cloud-account')
      return
    }
    if (!selectedProjectId) {
      toast.error('请先创建或选择一个项目')
      return
    }
    setBusy('cloud-create')
    try {
      const created = await ipc.cloudSnapshot.create({ projectId: selectedProjectId })
      setRecoveryKey(created.recoveryKey)
      await reloadCloudSnapshots()
      toast.success('已创建端到端加密云端快照')
    } catch (error) {
      toast.error('创建云端快照失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(null)
    }
  }

  async function handleRestoreCloudSnapshot(snapshot: CloudProjectSnapshot) {
    const confirmed = await confirmAction({
      title: '恢复为新项目？',
      description: '恢复会校验加密快照并导入为一个新的本地项目，不会覆盖当前项目或本机备份。',
      confirmLabel: '恢复为新项目',
    })
    if (!confirmed) return
    const suppliedRecoveryKey = snapshot.recoveryKeyAvailable ? undefined : await promptAction({
      title: '需要恢复密钥',
      description: '此设备的本地凭据文件中没有该密钥。请输入创建快照时保存的恢复密钥；它不会被上传或保存到项目数据。',
      inputLabel: '恢复密钥',
      placeholder: '粘贴恢复密钥',
      confirmLabel: '验证并恢复',
    })
    if (!snapshot.recoveryKeyAvailable && !suppliedRecoveryKey) return
    setBusy(`cloud-restore:${snapshot.id}`)
    try {
      const restored = await ipc.cloudSnapshot.restore({ snapshotId: snapshot.id, recoveryKey: suppliedRecoveryKey ?? undefined })
      toast.success(`已恢复为新项目「${restored.title}」`)
    } catch (error) {
      toast.error('恢复云端快照失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(null)
    }
  }

  async function handleDeleteCloudSnapshot(snapshot: CloudProjectSnapshot) {
    const confirmed = await confirmAction({
      title: '删除云端快照？',
      description: '将清除远端唯一的加密信封，并移除此设备本地凭据文件中的恢复密钥；删除后不能下载或恢复。',
      confirmLabel: '删除云端快照',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(`cloud-delete:${snapshot.id}`)
    try {
      await ipc.cloudSnapshot.remove({ snapshotId: snapshot.id })
      await reloadCloudSnapshots()
      toast.success('已删除云端快照')
    } catch (error) {
      toast.error('删除云端快照失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(null)
    }
  }

  async function copyRecoveryKey() {
    if (!recoveryKey) return
    try {
      await navigator.clipboard.writeText(recoveryKey)
      toast.success('恢复密钥已复制；请保存到自己的密码管理器')
    } catch {
      toast.error('无法复制，请手动保存恢复密钥')
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} aria-label="返回设置">
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-primary" />匿名产品分析</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">默认关闭。开启后只发送随机安装标识、版本、OS、白名单事件、耗时区间和标准错误码；不发送用户/项目 ID、标题、Prompt、素材名、路径或媒体。关闭会立即清空未发送队列。</p>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant={analyticsConsent === 'granted' ? 'default' : 'outline'} onClick={() => void updateAnalyticsConsent('granted')}>开启</Button>
                  <Button size="sm" variant={analyticsConsent === 'denied' ? 'default' : 'outline'} onClick={() => void updateAnalyticsConsent('denied')}>关闭</Button>
                </div>
              </CardContent>
            </Card>
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
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Cloud className="h-4 w-4 text-primary" />端到端加密云端快照</CardTitle>
				  <p className="mt-2 text-sm font-normal text-muted-foreground">手动创建；项目包先在本机加密，云端只保留密文 30 天。大于 8 MiB 的密文会安全分片，网络中断后再次选择同一项目即可续传；恢复始终导入为新项目。</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void reloadCloudSnapshots()} disabled={cloudLoading || busy !== null}><RefreshCw />刷新</Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-4 md:flex-row md:items-center">
                  <label className="min-w-0 flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">要创建快照的本地项目</span>
                    <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={busy !== null || projects.length === 0}>
                      {projects.length === 0 ? <option value="">暂无项目</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                    </select>
                  </label>
                  <Button onClick={() => void handleCreateCloudSnapshot()} disabled={busy !== null || !selectedProjectId}>
                    {busy === 'cloud-create' ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {cloudSignedIn ? '创建加密快照' : '登录后创建'}
                  </Button>
                </div>
                {cloudLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />读取云端快照…</div>
                ) : cloudNotice ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground"><span>{cloudNotice}</span><Button variant="outline" size="sm" onClick={() => navigate('/settings/cloud-account')}>管理云端账号</Button></div>
                ) : cloudSnapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无云端快照。它不是实时同步，只有你点击创建时才会上传密文。</p>
                ) : (
                  <div className="space-y-3">
                    {cloudSnapshots.map((snapshot) => {
                      const restoring = busy === `cloud-restore:${snapshot.id}`
                      const deleting = busy === `cloud-delete:${snapshot.id}`
                      return <div key={snapshot.id} className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{formatDate(snapshot.createdAt)}</span><Badge variant={snapshot.recoveryKeyAvailable ? 'secondary' : 'outline'}>{snapshot.recoveryKeyAvailable ? '本机密钥可用' : '需要恢复密钥'}</Badge></div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{formatBytes(snapshot.encryptedBytes)}</span><span>到期：{formatDate(snapshot.expiresAt)}</span><span className="font-mono">{snapshot.encryptedSha256.slice(0, 12)}…</span></div>
                        </div>
                        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void handleRestoreCloudSnapshot(snapshot)} disabled={busy !== null}>{restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}恢复为新项目</Button><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="删除云端快照" onClick={() => void handleDeleteCloudSnapshot(snapshot)} disabled={busy !== null}>{deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}</Button></div>
                      </div>
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

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
      <Dialog open={Boolean(recoveryKey)} onOpenChange={(open) => { if (!open) setRecoveryKey(undefined) }}>
        <DialogContent aria-describedby="snapshot-recovery-key-description">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />保存恢复密钥</DialogTitle><DialogDescription id="snapshot-recovery-key-description">此密钥不会上传到云端。它已保存在本机用户数据目录的加密凭据文件中，但请同时保存到自己的密码管理器；换设备或清除应用数据后恢复需要它。</DialogDescription></DialogHeader>
          <code className="break-all rounded-md border bg-muted p-3 text-xs leading-5">{recoveryKey}</code>
          <DialogFooter><Button variant="outline" onClick={() => void copyRecoveryKey()}><Copy />复制密钥</Button><Button onClick={() => setRecoveryKey(undefined)}>我已安全保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
