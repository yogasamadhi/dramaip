import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, Image, Plus, Trash2 } from 'lucide-react'
import type { ImageProviderConfigRecord } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SecretStorageHealthBanner } from '@/components/SecretStorageHealthBanner'

interface FormState {
  name: string
  apiKey: string
  model: string
  featureEnabled: boolean
}

const EMPTY: FormState = { name: 'OpenAI Image', apiKey: '', model: 'gpt-image-2', featureEnabled: false }

export function ImageProviderSettingsPage() {
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<ImageProviderConfigRecord[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [secretStatus, setSecretStatus] = useState<Awaited<ReturnType<typeof ipc.security.getSecretStorageStatus>> | null>(null)

  async function reload() {
    const [nextConfigs, status] = await Promise.all([ipc.imageProvider.list(), ipc.security.getSecretStorageStatus()])
    setConfigs(nextConfigs)
    setSecretStatus(status)
  }

  useEffect(() => { void reload().catch((error) => toast.error(`读取图片 Provider 设置失败：${error instanceof Error ? error.message : String(error)}`)) }, [])

  async function add() {
    if (!form.name.trim()) return toast.error('请填写配置名称')
    if (!form.apiKey.trim()) return toast.error('请填写 OpenAI API Key；不会写入 SQLite 或日志。')
    setBusy(true)
    try {
      await ipc.imageProvider.create({ ...form, name: form.name.trim(), apiKey: form.apiKey.trim(), kind: 'openai_image', isDefault: configs.length === 0 })
      setForm(EMPTY)
      await reload()
      toast.success('已保存到系统凭据管理器；生产开关默认关闭。')
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function toggle(config: ImageProviderConfigRecord) {
    setBusy(true)
    try {
      await ipc.imageProvider.update(config.id, { featureEnabled: !config.featureEnabled })
      await reload()
      toast.success(config.featureEnabled ? '已关闭图片 Provider；不会再提交新请求。' : '已启用图片 Provider；请仅提交已授权的测试或生产任务。')
    } catch (error) {
      toast.error(`更新失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function remove(config: ImageProviderConfigRecord) {
    setBusy(true)
    try {
      await ipc.imageProvider.remove(config.id)
      await reload()
      toast.success('已移除图片 Provider 设置和对应的系统凭据引用。已有图片资产与任务历史不会删除。')
    } catch (error) {
      toast.error(`移除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function setDefault(config: ImageProviderConfigRecord) {
    setBusy(true)
    try {
      await ipc.imageProvider.setDefault(config.id)
      await reload()
      toast.success(`已将「${config.name}」设为默认图片 Provider。`)
    } catch (error) {
      toast.error(`更新默认图片 Provider 失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  return <div className="flex h-screen flex-col">
    <header className="flex items-center gap-3 border-b px-6 py-4">
      <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} aria-label="返回设置"><ArrowLeft /></Button>
      <Image className="h-5 w-5" />
      <div><h1 className="text-lg font-semibold">图片生成设置</h1><p className="text-sm text-muted-foreground">OpenAI Image · Key 仅保存在系统凭据管理器</p></div>
    </header>
    <main className="flex-1 overflow-hidden"><ScrollArea className="h-full"><div className="mx-auto grid max-w-4xl gap-6 p-6 md:grid-cols-2">
      <SecretStorageHealthBanner status={secretStatus} className="md:col-span-2" />
      <Card>
        <CardHeader><CardTitle className="text-base">新增 OpenAI Image 配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">此配置只接通官方同步文生图端点。图生图、参考图上传、远端取消和声音/人物克隆不会被显示为可用能力。</p>
          <div className="space-y-2"><Label htmlFor="image-provider-name">名称</Label><Input id="image-provider-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="space-y-2"><Label htmlFor="image-provider-key">OpenAI API Key</Label><Input id="image-provider-key" type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="sk-..." autoComplete="off" /></div>
          <div className="space-y-2"><Label htmlFor="image-provider-model">模型</Label><Input id="image-provider-model" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} /></div>
          {secretStatus?.keychainAvailable === false && <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" />系统凭据管理器不可用</div><p className="mt-1 text-muted-foreground">应用会拒绝保存 Key，不会降级到 SQLite 明文。</p></div>}
          <label className="flex items-start gap-2 rounded border p-3 text-xs"><input type="checkbox" checked={form.featureEnabled} onChange={(event) => setForm((current) => ({ ...current, featureEnabled: event.target.checked }))} className="mt-0.5" /><span><strong>我已确认该账号可产生费用。</strong><br />未勾选时即使已经保存 Key，也绝不会提交图片请求。</span></label>
          <Button className="w-full" onClick={() => void add()} disabled={busy || secretStatus?.keychainAvailable === false}><Plus />保存配置</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">已保存配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">{configs.length === 0 ? <p className="text-sm text-muted-foreground">尚未配置。仍可复制分镜图片任务，交由人工或其他已授权流程制作。</p> : configs.map((config) => <div key={config.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{config.name}</span>{config.isDefault && <Badge>默认</Badge>}<Badge variant={config.featureEnabled ? 'destructive' : 'secondary'}>{config.featureEnabled ? '已启用计费请求' : '已关闭'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{config.model} · Key：{config.apiKey || '未保存'}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant={config.featureEnabled ? 'outline' : 'default'} disabled={busy} onClick={() => void toggle(config)}>{config.featureEnabled ? '关闭请求' : <><Check />确认后启用</>}</Button>{!config.isDefault && <Button size="sm" variant="outline" disabled={busy} onClick={() => void setDefault(config)}>设为默认</Button>}<Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove(config)}><Trash2 />移除</Button></div></div>)}</CardContent>
      </Card>
    </div></ScrollArea></main>
  </div>
}
