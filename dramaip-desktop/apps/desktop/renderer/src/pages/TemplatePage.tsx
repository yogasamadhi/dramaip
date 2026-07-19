// v0.8 模板管理页面（ROADMAP v0.8 §3）：模板 CRUD + 变量渲染 + 调用生成流水线
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileText, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import type { Template } from '@sdns/core'
import {
  TEMPLATE_SCOPE_OPTIONS,
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
} from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { confirmAction, deleteConfirmation } from '@/components/ConfirmActionDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface FormState {
  id?: string
  name: string
  type: string
  scope: string
  content: string
  description: string
  builtIn: boolean
}

const EMPTY: FormState = {
  name: '',
  type: TEMPLATE_TYPES[0],
  scope: 'snippet',
  content: '',
  description: '',
  builtIn: false,
}

export function TemplatePage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)
  const [detectedVars, setDetectedVars] = useState<string[]>([])
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function reload() {
    setTemplates(await ipc.template.list())
  }
  useEffect(() => {
    void reload()
  }, [])

  // 实时提取模板中的变量
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const vars = await ipc.template.extractVariables(form.content)
      if (!cancelled) {
        setDetectedVars(vars)
        setVarValues((prev) => {
          const next: Record<string, string> = {}
          for (const v of vars) next[v] = prev[v] ?? ''
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [form.content])

  function select(t: Template) {
    setForm({
      id: t.id,
      name: t.name,
      type: t.type,
      scope: t.scope ?? 'snippet',
      content: t.content,
      description: t.description ?? '',
      builtIn: t.builtIn,
    })
  }

  async function handleSave() {
    if (!form.name.trim() || !form.content.trim()) {
      toast.error('请填写名称与模板正文')
      return
    }
    try {
      const scope = form.scope === 'snippet' ? undefined : (form.scope as Template['scope'])
      if (form.id) {
        // 内置模板不可删，但可改内容
        await ipc.template.update(form.id, {
          name: form.name,
          type: form.type,
          scope,
          content: form.content,
          description: form.description || undefined,
          variables: detectedVars,
        })
        toast.success('已更新模板')
      } else {
        await ipc.template.create({
          name: form.name,
          type: form.type,
          scope,
          content: form.content,
          description: form.description || undefined,
          variables: detectedVars,
        })
        toast.success('已新增模板')
      }
      await reload()
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleDelete(t: Template) {
    if (t.builtIn) {
      toast.error('内置模板不可删除')
      return
    }
    if (!(await confirmAction(deleteConfirmation(`模板「${t.name}」`)))) return
    await ipc.template.remove(t.id)
    toast.success('已删除')
    if (form.id === t.id) setForm({ ...EMPTY })
    await reload()
  }

  // 渲染模板并（若是生成类）走 ai:run → 预览
  async function handleRun() {
    if (!form.id) {
      toast.error('请先保存模板')
      return
    }
    if (form.scope === 'snippet') {
      toast.message('纯片段模板仅渲染不落库：已复制渲染结果到剪贴板')
      const rendered = detectedVars
        .map((v) => `{{${v}}}`.replace(`{{${v}}}`, varValues[v] || `{{${v}}}`))
        .join('')
      void rendered
      return
    }
    setBusy(true)
    const id = toast.loading('正在用模板生成…')
    try {
      const runRes = await ipc.template.run({
        templateId: form.id,
        variables: varValues,
      })
      if (!runRes.ok || !runRes.aiInput) {
        toast.error('模板运行失败：' + (runRes.error ?? '未知错误'), { id })
        return
      }
      // 复用 ai:run（taskType=template_run，带 scope）
      const res = await ipc.ai.run(runRes.aiInput)
      if (res.ok && res.result) {
        toast.success('生成完成，请在对应工作台确认落库', { id })
      } else {
        toast.error('生成失败：' + (res.error ?? '未知错误'), { id })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft />
        </Button>
        <FileText className="h-5 w-5" />
        <h1 className="text-lg font-semibold">模板系统</h1>
        <p className="text-sm text-muted-foreground">项目 / 人物 / 大纲等模板，支持 {'{{变量}}'} 占位符</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto grid h-full max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-3">
          {/* 左：列表 */}
          <ScrollArea className="h-full lg:col-span-1">
            <div className="space-y-2">
              <Button variant="outline" className="mb-2 w-full justify-start" onClick={() => setForm({ ...EMPTY })}>
                <Plus className="h-4 w-4" />
                新建模板
              </Button>
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => select(t)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50',
                    form.id === t.id && 'border-primary bg-accent',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t.name}
                      {t.builtIn && <Badge variant="outline">内置</Badge>}
                    </span>
                    {!t.builtIn && (
                      <Trash2
                        className="h-3.5 w-3.5 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(t)
                        }}
                      />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {TEMPLATE_TYPE_LABELS[t.type] ?? t.type}
                    {t.scope ? ` · ${t.scope}` : ' · 片段'}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          {/* 右：编辑表单 + 运行 */}
          <Card className="flex flex-col lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{form.id ? '编辑模板' : '新建模板'}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>类型</Label>
                  <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TEMPLATE_TYPE_LABELS[t] ?? t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>作用域（驱动的生成任务；片段模板不落库）</Label>
                <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_SCOPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>模板正文（支持 {`{{变量}}`} 占位符）</Label>
                <Textarea
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder={'例如：\n请生成{{count}}章大纲，主题：{{theme}}'}
                />
                {detectedVars.length > 0 && (
                  <p className="text-xs text-muted-foreground">检测到变量：{detectedVars.map((v) => `{{${v}}}`).join('、')}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4" />
                  保存模板
                </Button>
                <Button variant="outline" onClick={handleRun} disabled={busy}>
                  <Sparkles className="h-4 w-4" />
                  {busy ? '生成中…' : '用此模板生成'}
                </Button>
              </div>

              {detectedVars.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs">运行时填写的变量</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {detectedVars.map((v) => (
                        <div key={v} className="space-y-1">
                          <Label className="text-xs font-normal text-muted-foreground">{`{{${v}}}`}</Label>
                          <Input
                            value={varValues[v] ?? ''}
                            onChange={(e) => setVarValues((p) => ({ ...p, [v]: e.target.value }))}
                            className="text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
