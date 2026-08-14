import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import {
  PROJECT_SKILL_CATEGORIES,
  PROJECT_SKILL_CATEGORY_LABELS,
  TASK_GROUPS,
  TASK_TYPE_LABELS,
  type NovelTaskType,
  type ProjectSkill,
  type ProjectSkillCategory,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
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
  category: ProjectSkillCategory
  description: string
  taskTypes: NovelTaskType[]
  content: string
  priority: string
  enabled: boolean
}

const EMPTY: FormState = {
  name: '',
  category: 'genre_pacing',
  description: '',
  taskTypes: [],
  content: '',
  priority: '0',
  enabled: true,
}

export function ProjectSkillsSection({ projectId, version, onChanged }: Props) {
  const [skills, setSkills] = useState<ProjectSkill[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)

  const reload = useCallback(async () => {
    setSkills(await ipc.projectSkill.list(projectId))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  const selectedTaskTypes = useMemo(() => new Set(form.taskTypes), [form.taskTypes])

  function openEdit(skill: ProjectSkill) {
    setForm({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      description: skill.description ?? '',
      taskTypes: skill.taskTypes,
      content: skill.content,
      priority: String(skill.priority),
      enabled: skill.enabled,
    })
  }

  function openNew() {
    setForm({ ...EMPTY })
  }

  function toggleTaskGroup(taskTypes: string[]) {
    const next = new Set(form.taskTypes)
    const typed = taskTypes as NovelTaskType[]
    const allSelected = typed.every((taskType) => next.has(taskType))
    if (allSelected) typed.forEach((taskType) => next.delete(taskType))
    else typed.forEach((taskType) => next.add(taskType))
    setForm((current) => ({ ...current, taskTypes: [...next] }))
  }

  async function save() {
    if (!form.name.trim() || !form.content.trim()) {
      toast.error('请填写名称与规范正文')
      return
    }
    const payload = {
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || undefined,
      taskTypes: form.taskTypes,
      content: form.content.trim(),
      priority: Number.parseInt(form.priority, 10) || 0,
      enabled: form.enabled,
    }
    try {
      if (form.id) {
        const updated = await ipc.projectSkill.update(form.id, payload)
        if (updated) setSkills((prev) => prev.map((skill) => (skill.id === updated.id ? updated : skill)))
        toast.success('已更新创作规范')
      } else {
        const created = await ipc.projectSkill.create({ ...payload, projectId })
        setSkills((prev) => [created, ...prev])
        toast.success('已新增创作规范')
      }
      setForm({ ...EMPTY })
      onChanged?.()
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function remove(skill: ProjectSkill) {
    if (!(await confirmAction(deleteConfirmation(`创作规范「${skill.name}」`)))) return
    await ipc.projectSkill.remove(skill.id)
    setSkills((prev) => prev.filter((item) => item.id !== skill.id))
    if (form.id === skill.id) setForm({ ...EMPTY })
    onChanged?.()
    toast.success('已删除')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">项目创作规范</span>
        <Badge variant="secondary">{skills.length}</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openNew}>
            <Plus />
            新建规范
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        <ScrollArea className="min-h-0 border-r">
          <div className="space-y-3 p-4">
            {skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无项目创作规范。</p>
            ) : (
              skills.map((skill) => (
                <div
                  key={skill.id}
                  className={cn(
                    'rounded-md border p-3 transition-colors',
                    form.id === skill.id && 'border-primary bg-accent/40',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{PROJECT_SKILL_CATEGORY_LABELS[skill.category]}</Badge>
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant={skill.enabled ? 'secondary' : 'outline'}>{skill.enabled ? '启用' : '停用'}</Badge>
                    <span className="text-xs text-muted-foreground">优先级 {skill.priority}</span>
                    <div className="ml-auto flex gap-1">
                      <Button size="icon" variant="ghost" title="编辑" onClick={() => openEdit(skill)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="删除" onClick={() => void remove(skill)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {skill.description && <p className="mt-2 text-xs text-muted-foreground">{skill.description}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">{taskScopeLabel(skill)}</p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{skill.content}</p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>名称</Label>
                <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>分类</Label>
                <Select value={form.category} onValueChange={(value: ProjectSkillCategory) => setForm((current) => ({ ...current, category: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_SKILL_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{PROJECT_SKILL_CATEGORY_LABELS[category]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>优先级</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm((current) => ({ ...current, priority: e.target.value }))}
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((current) => ({ ...current, enabled: e.target.checked }))}
                />
                启用
              </label>
            </div>

            <div className="space-y-1">
              <Label>说明</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>适用任务</Label>
                <Button size="sm" variant={form.taskTypes.length === 0 ? 'secondary' : 'outline'} onClick={() => setForm((current) => ({ ...current, taskTypes: [] }))}>
                  所有 AI 任务
                </Button>
              </div>
              <div className="grid gap-2">
                {TASK_GROUPS.map((group) => {
                  const taskTypes = group.taskTypes as NovelTaskType[]
                  const checked = form.taskTypes.length > 0 && taskTypes.every((taskType) => selectedTaskTypes.has(taskType))
                  return (
                    <label key={group.key} className="rounded-md border p-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleTaskGroup(group.taskTypes)} />
                        <span className="font-medium">{group.label}</span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {taskTypes.slice(0, 4).map((taskType) => TASK_TYPE_LABELS[taskType] ?? taskType).join('、')}
                        {taskTypes.length > 4 ? ` 等 ${taskTypes.length} 项` : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1">
              <Label>规范正文</Label>
              <Textarea
                rows={10}
                value={form.content}
                onChange={(e) => setForm((current) => ({ ...current, content: e.target.value }))}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()}>
                <Save />
                {form.id ? '保存修改' : '新增规范'}
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

function taskScopeLabel(skill: ProjectSkill): string {
  if (skill.taskTypes.length === 0) return '适用：所有 AI 任务'
  const shown = skill.taskTypes.slice(0, 5).map((taskType) => TASK_TYPE_LABELS[taskType] ?? taskType)
  const suffix = skill.taskTypes.length > shown.length ? ` 等 ${skill.taskTypes.length} 项` : ''
  return `适用：${shown.join('、')}${suffix}`
}
