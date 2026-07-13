import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Check, Loader2, Plug, Plus, Trash2 } from 'lucide-react'
import type { AiBudgetSettings, TaskModelBinding } from '@sdns/core'
import { TASK_GROUPS } from '@sdns/core'
import { useModelStore } from '@/stores/useModelStore'
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
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
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

export function ModelSettingsPage() {
  const navigate = useNavigate()
  const { configs, defaultId, fetch, create, remove, setDefault } = useModelStore()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [bindings, setBindings] = useState<TaskModelBinding[]>([])
  const [budget, setBudget] = useState<BudgetFormState>(EMPTY_BUDGET)
  const [testing, setTesting] = useState<string | null>(null)
  const [secretStatus, setSecretStatus] = useState<Awaited<ReturnType<typeof ipc.security.getSecretStorageStatus>> | null>(null)

  async function reloadBindings() {
    setBindings(await ipc.model.listTaskBindings())
  }

  async function reloadSecretStatus() {
    setSecretStatus(await ipc.security.getSecretStorageStatus())
  }

  async function reloadBudget() {
    setBudget(toBudgetForm(await ipc.model.getBudgetSettings()))
  }

  useEffect(() => {
    void fetch()
    void reloadBindings()
    void reloadSecretStatus()
    void reloadBudget()
  }, [fetch])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))
  const setBudgetField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) =>
    setBudget((f) => ({ ...f, [key]: value }))

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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">新增模型配置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：默认 GPT-4o" />
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Input value={form.provider} onChange={(e) => set('provider', e.target.value)} placeholder="openai / deepseek / ..." />
                </div>
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-..." />
                </div>
                {secretStatus?.keychainAvailable === false && (
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
                  <Label>模型</Label>
                  <Input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="gpt-4o-mini" />
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
                        <div>{c.provider} · {c.model}</div>
                        <div className="truncate">{c.baseUrl}</div>
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
