import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, Plus, Trash2, Video } from 'lucide-react'
import type { VideoProviderConfig } from '@sdns/core'
import { VIDEO_PROVIDER_KINDS, VIDEO_PROVIDER_KIND_LABELS } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { SecretStorageHealthBanner } from '@/components/SecretStorageHealthBanner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FormState {
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  model: string
  defaultParams: string
  isDefault: boolean
}

const EMPTY: FormState = {
  name: '',
  kind: 'mock',
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultParams: '',
  isDefault: false,
}

const PROVIDER_DEFAULTS: Record<string, Partial<Pick<FormState, 'name' | 'baseUrl' | 'model' | 'defaultParams'>>> = {
  openai_sora: {
    name: 'OpenAI Sora',
    baseUrl: 'https://api.openai.com/v1',
    model: 'sora-2',
    defaultParams: '{"size":"720x1280","seconds":"8"}',
  },
}

function isKnownDefault(field: keyof typeof PROVIDER_DEFAULTS['openai_sora'], value: string): boolean {
  return Object.values(PROVIDER_DEFAULTS).some((defaults) => defaults[field] === value)
}

function defaultedValue(
  current: string,
  field: keyof typeof PROVIDER_DEFAULTS['openai_sora'],
  defaults: Partial<Pick<FormState, 'name' | 'baseUrl' | 'model' | 'defaultParams'>>,
): string {
  if (current.trim() && !isKnownDefault(field, current)) return current
  return defaults[field] ?? ''
}

export function VideoProviderSettingsPage() {
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<VideoProviderConfig[]>([])
  const [defaultId, setDefaultId] = useState<string | undefined>(undefined)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [secretStatus, setSecretStatus] = useState<Awaited<ReturnType<typeof ipc.security.getSecretStorageStatus>> | null>(null)

  async function reload() {
    const list = await ipc.videoProvider.list()
    setConfigs(list)
    const def = await ipc.videoProvider.getDefault()
    setDefaultId(def?.id)
  }

  async function reloadSecretStatus() {
    setSecretStatus(await ipc.security.getSecretStorageStatus())
  }

  useEffect(() => {
    void reload()
    void reloadSecretStatus()
  }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  function handleKindChange(kind: string) {
    setForm((f) => {
      const defaults = PROVIDER_DEFAULTS[kind] ?? {}
      return {
        ...f,
        kind,
        name: defaultedValue(f.name, 'name', defaults),
        baseUrl: defaultedValue(f.baseUrl, 'baseUrl', defaults),
        model: defaultedValue(f.model, 'model', defaults),
        defaultParams: defaultedValue(f.defaultParams, 'defaultParams', defaults),
      }
    })
  }

  async function handleAdd() {
    if (!form.name.trim()) {
      toast.error('请填写名称')
      return
    }
    try {
      await ipc.videoProvider.create({ ...form, isDefault: form.isDefault || configs.length === 0 })
      toast.success('已添加视频 Provider 配置')
      setForm({ ...EMPTY, isDefault: configs.length === 0 })
      await reload()
      await reloadSecretStatus()
    } catch (e) {
      toast.error('添加失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">视频生成设置</h1>
        <p className="text-sm text-muted-foreground">AI 视频平台 Provider · Key 仅本地保存</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 p-6 md:grid-cols-2">
            <SecretStorageHealthBanner status={secretStatus} className="md:col-span-2" />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">新增视频 Provider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：默认视频生成" />
                </div>
                <div className="space-y-2">
                  <Label>Provider 种类</Label>
                  <Select value={form.kind} onValueChange={handleKindChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_PROVIDER_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {VIDEO_PROVIDER_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => set('baseUrl', e.target.value)}
                    placeholder={form.kind === 'openai_sora' ? 'https://api.openai.com/v1' : 'https://open.volcengineapi.com/...（mock 可留空）'}
                    disabled={form.kind === 'mock'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => set('apiKey', e.target.value)}
                    placeholder="sk-...（mock 可留空）"
                    disabled={form.kind === 'mock'}
                  />
                </div>
                {form.kind !== 'mock' && secretStatus?.keychainAvailable === false && (
                  <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                    <div className="flex items-center gap-2 font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      系统凭据管理器不可用
                    </div>
                    <p className="text-muted-foreground">
                      为避免 API Key 落入 SQLite，本应用不会使用明文降级。请恢复系统钥匙串/凭据管理器后再保存。
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>默认模型</Label>
                  <Input
                    value={form.model}
                    onChange={(e) => set('model', e.target.value)}
                    placeholder={form.kind === 'openai_sora' ? 'sora-2' : '如 kling-v2 / runway-gen4（mock 可留空）'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>默认参数（JSON，可选）</Label>
                  <Input
                    value={form.defaultParams}
                    onChange={(e) => set('defaultParams', e.target.value)}
                    placeholder={form.kind === 'openai_sora' ? '{"size":"720x1280","seconds":"8"}' : '{"aspect_ratio":"9:16","duration":5}'}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => set('isDefault', e.target.checked)}
                  />
                  设为默认视频 Provider
                </label>
                <Button onClick={handleAdd} className="w-full">
                  <Plus />
                  添加
                </Button>
                <p className="text-xs text-muted-foreground">
                  提示：选「Mock」可在无账号时跑通提交/轮询/保存结果全链路；OpenAI Sora 已内置提交与轮询映射，其他真实平台仍需按开放接口补齐。
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">已配置 Provider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {configs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">尚未配置任何视频 Provider。</p>
                ) : (
                  configs.map((c) => (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">{c.name}</span>
                          {c.id === defaultId && (
                            <Badge>
                              <Check className="h-3 w-3" />
                              默认
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {c.id !== defaultId && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await ipc.videoProvider.setDefault(c.id)
                                await reload()
                              }}
                            >
                              设为默认
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={async () => {
                              await ipc.videoProvider.remove(c.id)
                              toast.success('已删除')
                              await reload()
                              await reloadSecretStatus()
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <div>{VIDEO_PROVIDER_KIND_LABELS[c.kind] ?? c.kind} · {c.model || '（默认模型）'}</div>
                        {c.baseUrl && <div className="truncate">{c.baseUrl}</div>}
                      </div>
                      <Separator />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
