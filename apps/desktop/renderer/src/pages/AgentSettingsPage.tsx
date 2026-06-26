// v0.8 Agent 配置页面（ROADMAP v0.8 §1）：管理 9 个内置 Agent + 自定义 Agent
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Bot, Plus, Save, Trash2 } from 'lucide-react'
import type { AgentProfile } from '@sdns/core'
import { AGENT_ROLE_LABELS } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface FormState {
  id?: string
  name: string
  role: string
  systemPrompt: string
  builtIn: boolean
  enabled: boolean
}

const EMPTY: FormState = { name: '', role: '', systemPrompt: '', builtIn: false, enabled: true }

export function AgentSettingsPage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)

  async function reload() {
    setAgents(await ipc.agent.list())
  }
  useEffect(() => {
    void reload()
  }, [])

  function select(a: AgentProfile) {
    setForm({ id: a.id, name: a.name, role: a.role, systemPrompt: a.systemPrompt, builtIn: a.builtIn, enabled: a.enabled })
  }

  async function handleSave() {
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      toast.error('请填写名称与系统 Prompt')
      return
    }
    try {
      if (form.id) {
        // 内置 Agent 不允许改 role，仅改 name/systemPrompt/enabled
        await ipc.agent.update(form.id, {
          name: form.name,
          systemPrompt: form.systemPrompt,
          enabled: form.enabled,
        })
        toast.success('已更新 Agent')
      } else {
        if (!form.role.trim()) {
          toast.error('请填写角色标识（英文，如 my_reviewer）')
          return
        }
        await ipc.agent.create({
          name: form.name,
          role: form.role,
          systemPrompt: form.systemPrompt,
          enabled: form.enabled,
        })
        toast.success('已新增 Agent')
      }
      setForm({ ...EMPTY })
      await reload()
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleDelete(a: AgentProfile) {
    if (a.builtIn) {
      toast.error('内置 Agent 不可删除')
      return
    }
    if (!window.confirm(`删除 Agent「${a.name}」？`)) return
    await ipc.agent.remove(a.id)
    toast.success('已删除')
    if (form.id === a.id) setForm({ ...EMPTY })
    await reload()
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft />
        </Button>
        <Bot className="h-5 w-5" />
        <h1 className="text-lg font-semibold">Agent 配置</h1>
        <p className="text-sm text-muted-foreground">多 Agent 编剧室 · 内置 9 个预设，可自定义</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto grid h-full max-w-6xl grid-cols-1 gap-6 p-6 md:grid-cols-2">
          {/* 左：列表 */}
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => select(a)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50',
                    form.id === a.id && 'border-primary bg-accent',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {a.name}
                      {a.builtIn && <Badge variant="outline">内置</Badge>}
                      {!a.enabled && <Badge variant="secondary">已停用</Badge>}
                    </span>
                    {!a.builtIn && (
                      <Trash2
                        className="h-3.5 w-3.5 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(a)
                        }}
                      />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {AGENT_ROLE_LABELS[a.role] ?? a.role}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          {/* 右：编辑表单 */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {form.id ? '编辑 Agent' : (
                  <>
                    <Plus className="h-4 w-4" /> 新增自定义 Agent
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>角色标识（仅新建时填写，内置 Agent 不可改）</Label>
                <Input
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  disabled={!!form.id}
                  placeholder="如：my_reviewer"
                />
              </div>
              <div className="space-y-2">
                <Label>系统 Prompt（Agent 的人格与审稿维度）</Label>
                <Textarea
                  value={form.systemPrompt}
                  onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                  rows={10}
                  className="text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                启用（参与编剧室默认审稿）
              </label>
              <div className="flex gap-2">
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4" />
                  {form.id ? '保存修改' : '新增 Agent'}
                </Button>
                {form.id && (
                  <Button variant="outline" onClick={() => setForm({ ...EMPTY })}>
                    新建（清空表单）
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
