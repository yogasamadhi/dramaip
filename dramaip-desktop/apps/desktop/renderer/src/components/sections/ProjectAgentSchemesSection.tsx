import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Layers3, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import {
  AGENT_ROLE_LABELS,
  PROJECT_SKILL_CATEGORY_LABELS,
  TASK_GROUPS,
  type AgentProfile,
  type ModelConfig,
  type ProjectAgentScheme,
  type ProjectSkill,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  projectId: string
  version: number
  onChanged?: () => void
}

interface FormState {
  id?: string
  name: string
  description: string
  primaryAgentId: string
  agentIds: string[]
  skillIds: string[]
  modelBindings: Record<string, string>
  active: boolean
}

const EMPTY: FormState = {
  name: '',
  description: '',
  primaryAgentId: '',
  agentIds: [],
  skillIds: [],
  modelBindings: {},
  active: true,
}

export function ProjectAgentSchemesSection({ projectId, version, onChanged }: Props) {
  const [schemes, setSchemes] = useState<ProjectAgentScheme[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [skills, setSkills] = useState<ProjectSkill[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)

  const reload = useCallback(async () => {
    const [nextSchemes, nextAgents, nextSkills, nextModels] = await Promise.all([
      ipc.projectAgentScheme.list(projectId),
      ipc.agent.list(),
      ipc.projectSkill.list(projectId),
      ipc.model.list(),
    ])
    setSchemes(nextSchemes)
    setAgents(nextAgents)
    setSkills(nextSkills)
    setModels(nextModels)
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  const selectedAgents = useMemo(() => new Set(form.agentIds), [form.agentIds])
  const selectedSkills = useMemo(() => new Set(form.skillIds), [form.skillIds])

  function defaultAgentIds(): string[] {
    return agents.filter((agent) => agent.enabled).map((agent) => agent.id)
  }

  function openNew() {
    const agentIds = defaultAgentIds()
    setForm({
      ...EMPTY,
      name: '项目编剧室方案',
      agentIds,
      primaryAgentId: agentIds[0] ?? '',
      active: schemes.length === 0,
    })
  }

  function openEdit(scheme: ProjectAgentScheme) {
    setForm({
      id: scheme.id,
      name: scheme.name,
      description: scheme.description ?? '',
      primaryAgentId: scheme.primaryAgentId ?? '',
      agentIds: scheme.agentIds,
      skillIds: scheme.skillIds,
      modelBindings: scheme.modelBindings,
      active: scheme.active,
    })
  }

  function toggleAgent(agentId: string) {
    setForm((current) => {
      const next = new Set(current.agentIds)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      const agentIds = [...next]
      return {
        ...current,
        agentIds,
        primaryAgentId: agentIds.includes(current.primaryAgentId) ? current.primaryAgentId : agentIds[0] ?? '',
      }
    })
  }

  function toggleSkill(skillId: string) {
    setForm((current) => {
      const next = new Set(current.skillIds)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return { ...current, skillIds: [...next] }
    })
  }

  function setModelBinding(taskGroup: string, modelConfigId: string) {
    setForm((current) => {
      const modelBindings = { ...current.modelBindings }
      if (modelConfigId === 'inherit') delete modelBindings[taskGroup]
      else modelBindings[taskGroup] = modelConfigId
      return { ...current, modelBindings }
    })
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('请填写方案名称')
      return
    }
    if (form.agentIds.length === 0) {
      toast.error('请至少选择一个 Agent')
      return
    }
    if (form.primaryAgentId && !form.agentIds.includes(form.primaryAgentId)) {
      toast.error('主 Agent 必须在参与 Agent 中')
      return
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      primaryAgentId: form.primaryAgentId || undefined,
      agentIds: form.agentIds,
      skillIds: form.skillIds,
      modelBindings: Object.fromEntries(Object.entries(form.modelBindings).filter(([, value]) => value)),
      active: form.active,
    }
    try {
      const saved = form.id
        ? await ipc.projectAgentScheme.update(form.id, payload)
        : await ipc.projectAgentScheme.create({ ...payload, projectId })
      if (!saved) throw new Error('保存后未返回方案')
      await reload()
      openEdit(saved)
      onChanged?.()
      toast.success(form.id ? '已更新 Agent 方案' : '已新增 Agent 方案')
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function activate(scheme: ProjectAgentScheme) {
    const updated = await ipc.projectAgentScheme.setActive(scheme.id)
    if (updated) {
      await reload()
      openEdit(updated)
      onChanged?.()
      toast.success('已切换项目 Agent 方案')
    }
  }

  async function remove(scheme: ProjectAgentScheme) {
    if (!window.confirm(`删除 Agent 方案「${scheme.name}」？`)) return
    await ipc.projectAgentScheme.remove(scheme.id)
    await reload()
    if (form.id === scheme.id) openNew()
    onChanged?.()
    toast.success('已删除')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Layers3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">项目 Agent 方案</span>
        <Badge variant="secondary">{schemes.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openNew}>
            <Plus />
            新建方案
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px]">
        <ScrollArea className="min-h-0 border-r">
          <div className="space-y-3 p-4">
            {schemes.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无项目 Agent 方案。</p>
            ) : (
              schemes.map((scheme) => (
                <div
                  key={scheme.id}
                  className={cn(
                    'rounded-md border p-3 transition-colors',
                    form.id === scheme.id && 'border-primary bg-accent/40',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{scheme.name}</span>
                    <Badge variant={scheme.active ? 'default' : 'outline'}>
                      {scheme.active ? '当前方案' : '备用'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {scheme.agentIds.length} Agent / {scheme.skillIds.length} Skills
                    </span>
                    <div className="ml-auto flex gap-1">
                      {!scheme.active && (
                        <Button size="icon" variant="ghost" title="设为当前" onClick={() => void activate(scheme)}>
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(scheme)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="删除" onClick={() => void remove(scheme)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {scheme.description && <p className="mt-2 text-xs text-muted-foreground">{scheme.description}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    模型覆盖：{Object.keys(scheme.modelBindings).length || '继承全局'}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-4 p-4">
            <div className="space-y-1">
              <Label>方案名称</Label>
              <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>说明</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
              />
              设为当前项目方案
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>参与 Agent</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const agentIds = defaultAgentIds()
                    setForm((current) => ({ ...current, agentIds, primaryAgentId: agentIds[0] ?? '' }))
                  }}
                >
                  全局启用
                </Button>
              </div>
              <div className="grid gap-2">
                {agents.map((agent) => (
                  <label key={agent.id} className="rounded-md border p-2 text-sm">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedAgents.has(agent.id)} onChange={() => toggleAgent(agent.id)} />
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{agent.name}</span>
                      <span className="text-xs text-muted-foreground">{AGENT_ROLE_LABELS[agent.role] ?? agent.role}</span>
                      {agent.builtIn && <Badge variant="outline">内置</Badge>}
                    </span>
                    <span className="mt-2 flex items-center gap-2 pl-6 text-xs text-muted-foreground">
                      <input
                        type="radio"
                        name="primary-agent"
                        checked={form.primaryAgentId === agent.id}
                        disabled={!selectedAgents.has(agent.id)}
                        onChange={() => setForm((current) => ({ ...current, primaryAgentId: agent.id }))}
                      />
                      主 Agent
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>绑定 Skills</Label>
                <Button size="sm" variant={form.skillIds.length === 0 ? 'secondary' : 'outline'} onClick={() => setForm((current) => ({ ...current, skillIds: [] }))}>
                  自动匹配
                </Button>
              </div>
              <div className="grid gap-2">
                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无项目创作规范。</p>
                ) : (
                  skills.map((skill) => (
                    <label key={skill.id} className="rounded-md border p-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedSkills.has(skill.id)} onChange={() => toggleSkill(skill.id)} />
                        <span className="font-medium">{skill.name}</span>
                        <span className="text-xs text-muted-foreground">{PROJECT_SKILL_CATEGORY_LABELS[skill.category]}</span>
                        {!skill.enabled && <Badge variant="outline">停用</Badge>}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>任务模型覆盖</Label>
              <div className="grid gap-2">
                {TASK_GROUPS.map((group) => (
                  <div key={group.key} className="grid gap-1 rounded-md border p-2">
                    <span className="text-sm font-medium">{group.label}</span>
                    <Select
                      value={form.modelBindings[group.key] ?? 'inherit'}
                      onValueChange={(value) => setModelBinding(group.key, value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">继承全局模型</SelectItem>
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name} / {model.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()}>
                <Save />
                {form.id ? '保存修改' : '新增方案'}
              </Button>
              {form.id && (
                <Button variant="outline" onClick={openNew}>
                  清空表单
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
