import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, Cloud, Loader2, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AiBudgetSettings, TaskModelBinding } from '@sdns/core'
import { TASK_GROUPS } from '@sdns/core'
import { useModelStore } from '@/stores/useModelStore'
import { type CloudAIModel, type CloudAuthStatus, type CloudContext, ipc } from '@/lib/ipc'
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
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  isDefault: boolean
}

interface BudgetFormState {
  singleRunTokenLimit: string
  dailyTokenLimit: string
  singleRunCostLimit: string
  dailyCostLimit: string
  costPer1kTokens: string
  currency: string
}

const EMPTY: FormState = {
  name: '',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4-pro',
  isDefault: false,
}

const EMPTY_BUDGET: BudgetFormState = {
  singleRunTokenLimit: '',
  dailyTokenLimit: '',
  singleRunCostLimit: '',
  dailyCostLimit: '',
  costPer1kTokens: '0',
  currency: 'USD',
}

interface ProviderPreset {
  /** Select 的 value，同时写入配置的 provider 字段 */
  value: string
  /** 下拉展示名 */
  label: string
  baseUrl: string
  /** 推荐模型；留空表示 model 填接入点 ID 等用户专属值，不预填 */
  model: string
  /** model 输入框占位提示（留空用默认） */
  modelPlaceholder?: string
}

// 常见 OpenAI-compatible Provider 预设，选中后自动填充 Base URL 与推荐模型。
// 推荐模型为各厂商 2026-07 最新旗舰（已联网核实）；火山方舟的 model 是用户开通后生成的
// 接入点 ID（ep-xxx）而非固定模型名，故不预填。
const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'deepseek', label: 'DeepSeek 深度求索', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' },
  { value: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' },
  { value: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
  { value: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' },
  { value: 'qwen', label: '阿里通义千问（百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-max' },
  { value: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3' },
  { value: 'mimo', label: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { value: 'doubao', label: '火山方舟 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', modelPlaceholder: '填接入点 ID，如 ep-2024xxxx-xxxxx' },
  { value: 'custom', label: '自定义', baseUrl: '', model: '' },
]

function findPreset(provider: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.value === provider)
}

const CLOUD_PROVIDER_ID = 'dramaip-cloud'

export function ModelSettingsPage() {
  const navigate = useNavigate()
  const { configs, defaultId, fetch, create, remove, setDefault } = useModelStore()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [bindings, setBindings] = useState<TaskModelBinding[]>([])
  const [budget, setBudget] = useState<BudgetFormState>(EMPTY_BUDGET)
  const [testing, setTesting] = useState<string | null>(null)
  const [secretStatus, setSecretStatus] = useState<Awaited<ReturnType<typeof ipc.security.getSecretStorageStatus>> | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudAuthStatus | undefined>()
  const [cloudContext, setCloudContext] = useState<CloudContext | undefined>()
  const [cloudModels, setCloudModels] = useState<CloudAIModel[]>([])
  const [cloudBusy, setCloudBusy] = useState(false)

  async function reloadBindings() {
    setBindings(await ipc.model.listTaskBindings())
  }

  async function reloadSecretStatus() {
    setSecretStatus(await ipc.security.getSecretStorageStatus())
  }

  async function reloadBudget() {
    setBudget(toBudgetForm(await ipc.model.getBudgetSettings()))
  }

  async function reloadCloud() {
    setCloudBusy(true)
    try {
      const status = await ipc.cloudAuth.status()
      setCloudStatus(status)
      if (!status.signedIn) {
        setCloudContext(undefined)
        setCloudModels([])
        return
      }
      const [context, models] = await Promise.all([ipc.cloudAuth.context(), ipc.cloudAI.models()])
      setCloudContext(context)
      setCloudModels(models)
    } catch (error) {
      setCloudModels([])
      toast.error('无法读取云端模型：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setCloudBusy(false)
    }
  }

  useEffect(() => {
    void fetch()
    void reloadBindings()
    void reloadSecretStatus()
    void reloadBudget()
    void reloadCloud()
  }, [fetch])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))
  const setBudgetField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) =>
    setBudget((f) => ({ ...f, [key]: value }))

  // 选择 Provider 后自动填充 Base URL 与推荐模型。仅当当前值仍属于其他预设
  // （或为空）时才覆盖，避免抹掉用户已手动编辑的内容。
  function selectProvider(provider: string) {
    const preset = findPreset(provider)
    if (!preset) {
      set('provider', provider)
      return
    }
    setForm((f) => {
      const currentPreset = findPreset(f.provider)
      const baseUrlWasPreset = f.baseUrl === '' || (currentPreset && f.baseUrl === currentPreset.baseUrl)
      const modelWasPreset = f.model === '' || (currentPreset && f.model === currentPreset.model)
      return {
        ...f,
        provider,
        baseUrl: baseUrlWasPreset ? preset.baseUrl : f.baseUrl,
        model: modelWasPreset ? preset.model : f.model,
      }
    })
  }

  async function handleAdd() {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast.error('请填写名称、Base URL 与模型')
      return
    }
    try {
      await create({ ...form, isDefault: form.isDefault || configs.length === 0 })
      toast.success('已添加模型配置')
      setForm({ ...EMPTY, isDefault: configs.length === 0 })
      await reloadSecretStatus()
    } catch (e) {
      toast.error('添加失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // v1.0：连接测试
  async function handleTest(c: (typeof configs)[number]) {
    setTesting(c.id)
    const id = toast.loading(`测试「${c.name}」连接…`)
    try {
      const res = await ipc.model.testConnection(c)
      if (res.ok) {
        toast.success(`连接成功（${res.latencyMs}ms${res.tokenUsage ? ` · ${res.tokenUsage} tokens` : ''}）`, { id })
      } else {
        toast.error('连接失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setTesting(null)
    }
  }

  // v1.0：按任务组绑定
  async function bindTask(taskGroup: string, modelConfigId: string) {
    if (modelConfigId === '__default__') {
      await ipc.model.deleteTaskBinding(taskGroup)
    } else {
      await ipc.model.upsertTaskBinding(taskGroup, modelConfigId)
    }
    await reloadBindings()
  }

  const bindingFor = (taskGroup: string) => bindings.find((b) => b.taskGroup === taskGroup)

  async function saveBudget() {
    const updated = await ipc.model.updateBudgetSettings({
      singleRunTokenLimit: positiveInt(budget.singleRunTokenLimit),
      dailyTokenLimit: positiveInt(budget.dailyTokenLimit),
      singleRunCostLimit: positiveNumber(budget.singleRunCostLimit),
      dailyCostLimit: positiveNumber(budget.dailyCostLimit),
      costPer1kTokens: positiveNumber(budget.costPer1kTokens) ?? 0,
      currency: budget.currency.trim() || 'USD',
    })
    setBudget(toBudgetForm(updated))
    toast.success('预算已保存')
  }

  async function addCloudModel(model: CloudAIModel) {
    const baseUrl = `cloud://${model.provider}`
    const existing = configs.find((config) => config.provider === CLOUD_PROVIDER_ID && config.baseUrl === baseUrl && config.model === model.model)
    if (existing) {
      await setDefault(existing.id)
      toast.success('已将 DramaIP Cloud 模型设为默认')
      return
    }
    await create({
      name: `DramaIP Cloud · ${model.model}`,
      provider: CLOUD_PROVIDER_ID,
      baseUrl,
      // Cloud auth stays in Electron main/local credential storage; this configuration must
      // never carry an API Key into SQLite or renderer state.
      apiKey: '',
      model: model.model,
      isDefault: configs.length === 0,
    })
    toast.success('已添加 DramaIP Cloud 模型，可按任务组选择')
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">模型设置</h1>
        <p className="text-sm text-muted-foreground">OpenAI-compatible API · Key 仅本地保存</p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate('/settings/usage')}>
          Token 与耗时统计
        </Button>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 p-6 md:grid-cols-2">
            <SecretStorageHealthBanner status={secretStatus} className="md:col-span-2" />

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Token / 费用预算</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>单次 Token 上限</Label>
                  <Input type="number" min="0" value={budget.singleRunTokenLimit} onChange={(e) => setBudgetField('singleRunTokenLimit', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>每日 Token 上限</Label>
                  <Input type="number" min="0" value={budget.dailyTokenLimit} onChange={(e) => setBudgetField('dailyTokenLimit', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>每千 Token 费用</Label>
                  <Input type="number" min="0" step="0.0001" value={budget.costPer1kTokens} onChange={(e) => setBudgetField('costPer1kTokens', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>单次费用上限</Label>
                  <Input type="number" min="0" step="0.0001" value={budget.singleRunCostLimit} onChange={(e) => setBudgetField('singleRunCostLimit', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>每日费用上限</Label>
                  <Input type="number" min="0" step="0.0001" value={budget.dailyCostLimit} onChange={(e) => setBudgetField('dailyCostLimit', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>币种</Label>
                  <Input value={budget.currency} onChange={(e) => setBudgetField('currency', e.target.value)} />
                </div>
                <div className="md:col-span-3">
                  <Button onClick={saveBudget}>保存预算</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base"><Cloud className="h-4 w-4" />DramaIP Cloud 模型</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">无需填写平台 API Key。仅当前任务所需的受限上下文会经桌面 BFF 发往 AI Gateway。</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void reloadCloud()} disabled={cloudBusy}>
                    {cloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {cloudStatus?.enabled === false ? (
                  <p className="text-sm text-muted-foreground">云端功能尚未启用；本地模型与自有 API Key 不受影响。</p>
                ) : !cloudStatus?.signedIn ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>请先使用系统浏览器登录云端账号，才能读取套餐模型和余额。</span>
                    <Button size="sm" variant="outline" onClick={() => navigate('/settings/cloud')}>前往云端账号</Button>
                  </div>
                ) : (
                  <>
                    {cloudContext ? <p className="text-sm text-muted-foreground">套餐 {cloudContext.subscription.plan} · 剩余 {cloudContext.tokenBalance.remainingTokens.toLocaleString()} tokens</p> : null}
                    {cloudModels.length === 0 ? <p className="text-sm text-muted-foreground">当前套餐没有可用的云端模型。</p> : (
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {cloudModels.map((model) => (
                          <div key={`${model.provider}:${model.model}`} className="flex items-center justify-between rounded-md border p-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{model.model}</p>
                              <p className="text-xs text-muted-foreground">{model.provider}{model.isDefault ? ' · 推荐' : ''}</p>
                            </div>
                            <Button size="sm" onClick={() => void addCloudModel(model)}>使用</Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">新增模型配置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：默认 DeepSeek V4 Pro" />
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={form.provider} onValueChange={selectProvider}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择 Provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.deepseek.com/v1" />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-..." />
                </div>
                {secretStatus?.keychainAvailable === false && (
                  <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                    <div className="flex items-center gap-2 font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      本地凭据存储不可用
                    </div>
                    <p className="text-muted-foreground">
                      为避免 API Key 落入 SQLite，本应用不会使用明文降级。请检查用户数据目录权限后再保存。
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>模型</Label>
                  <Input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder={findPreset(form.provider)?.modelPlaceholder ?? 'deepseek-v4-pro'} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => set('isDefault', e.target.checked)}
                  />
                  设为默认模型
                </label>
                <Button onClick={handleAdd} className="w-full">
                  <Plus />
                  添加
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">已配置模型</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {configs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">尚未配置任何模型。</p>
                ) : (
                  configs.map((c) => (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.name}</span>
                          {c.id === defaultId && (
                            <Badge>
                              <Check className="h-3 w-3" />
                              默认
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTest(c)}
                            disabled={testing === c.id}
                          >
                            {testing === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                            测试
                          </Button>
                          {c.id !== defaultId && (
                            <Button size="sm" variant="ghost" onClick={() => setDefault(c.id)}>
                              设默认
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={async () => {
                              await remove(c.id)
                              await reloadBindings()
                              await reloadSecretStatus()
                              toast.success('已删除')
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <div>{c.provider === CLOUD_PROVIDER_ID ? 'DramaIP Cloud' : c.provider} · {c.model}</div>
                        <div className="truncate">{c.provider === CLOUD_PROVIDER_ID ? '认证令牌仅驻留主进程；不需要 API Key' : c.baseUrl}</div>
                      </div>
                      <Separator />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* v1.0：按任务组指定模型 */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">按任务指定模型</CardTitle>
                <p className="text-sm text-muted-foreground">
                  为不同任务组选用不同模型（如写作用大模型、分析用快模型）。留空「默认」则用上方默认模型。
                </p>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {TASK_GROUPS.map((g) => {
                  const bound = bindingFor(g.key)
                  return (
                    <div key={g.key} className="space-y-1">
                      <Label className="text-xs">
                        {g.label}
                        <span className="ml-1 font-normal text-muted-foreground">{g.description}</span>
                      </Label>
                      <Select
                        value={bound?.modelConfigId ?? '__default__'}
                        onValueChange={(v) => bindTask(g.key, v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">默认模型</SelectItem>
                          {configs.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}（{c.model}）
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}

function toBudgetForm(settings: AiBudgetSettings): BudgetFormState {
  return {
    singleRunTokenLimit: settings.singleRunTokenLimit?.toString() ?? '',
    dailyTokenLimit: settings.dailyTokenLimit?.toString() ?? '',
    singleRunCostLimit: settings.singleRunCostLimit?.toString() ?? '',
    dailyCostLimit: settings.dailyCostLimit?.toString() ?? '',
    costPer1kTokens: settings.costPer1kTokens.toString(),
    currency: settings.currency,
  }
}

function positiveNumber(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function positiveInt(value: string): number | undefined {
  const n = positiveNumber(value)
  return n ? Math.floor(n) : undefined
}
