// v0.8 类型库页面（ROADMAP v0.8 §4）：浏览 / CRUD 短剧类型预设 + 「基于此类型创建项目」
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BookText, Library, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { GenrePreset } from '@sdns/core'
import { useProjectsStore } from '@/stores/useProjectsStore'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <Badge key={i} variant="secondary" className="font-normal">
            {it}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function GenrePresetPage() {
  const navigate = useNavigate()
  const create = useProjectsStore((s) => s.create)
  const [presets, setPresets] = useState<GenrePreset[]>([])
  const [name, setName] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [desc, setDesc] = useState('')

  async function reload() {
    setPresets(await ipc.genrePreset.list())
  }
  useEffect(() => {
    void reload()
  }, [])

  async function handleAdd() {
    if (!name.trim() || !visualStyle.trim()) {
      toast.error('请填写类型名与视觉风格')
      return
    }
    try {
      await ipc.genrePreset.create({
        name: name.trim(),
        visualStyle: visualStyle.trim(),
        shotPromptAdvice: '（待补充）',
        aiVideoRisks: '（待补充）',
        description: desc.trim() || undefined,
        commonRelationships: [],
        commonHighlights: [],
        commonReversals: [],
        commonOpenings: [],
        commonCliffhangers: [],
      })
      toast.success('已新增类型预设')
      setName('')
      setVisualStyle('')
      setDesc('')
      await reload()
    } catch (e) {
      toast.error('新增失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function createProjectFromGenre(p: GenrePreset) {
    try {
      const project = await create({ title: `《${p.name}》新项目`, shortDramaType: p.name })
      toast.success('已基于该类型创建项目')
      navigate(`/projects/${project.id}`)
    } catch (e) {
      toast.error('创建项目失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <Library className="h-5 w-5" />
        <h1 className="text-lg font-semibold">类型库</h1>
        <p className="text-sm text-muted-foreground">内置 11 种主流 AI 短剧类型预设，可增删改</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-5xl space-y-6 p-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4" /> 新增类型预设
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>类型名 *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：职场逆袭" />
                </div>
                <div className="space-y-2">
                  <Label>视觉风格 *</Label>
                  <Input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} placeholder="如：现代都市短剧，明亮偏暖" />
                </div>
                <div className="space-y-2 md:col-span-1">
                  <Label>简介</Label>
                  <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="（可选）" />
                </div>
                <div className="md:col-span-3">
                  <Button onClick={handleAdd}>新增</Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {presets.map((p) => (
                <Card key={p.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BookText className="h-4 w-4 text-primary" />
                        {p.name}
                        {p.builtIn && <Badge variant="outline">内置</Badge>}
                      </CardTitle>
                      {!p.builtIn && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="删除"
                          onClick={async () => {
                            await ipc.genrePreset.remove(p.id)
                            toast.success('已删除')
                            await reload()
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3 text-sm">
                    <ListField label="常见人物关系" items={p.commonRelationships} />
                    <ListField label="常见爽点" items={p.commonHighlights} />
                    <ListField label="常见反转" items={p.commonReversals} />
                    <ListField label="常见开局" items={p.commonOpenings} />
                    <ListField label="常见结尾钩子" items={p.commonCliffhangers} />
                    <Separator />
                    <div className="text-xs text-muted-foreground">
                      <div>视觉风格：{p.visualStyle}</div>
                      <div className="mt-1">镜头 Prompt 建议：{p.shotPromptAdvice}</div>
                      <div className="mt-1">AI 视频生成风险：{p.aiVideoRisks}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => createProjectFromGenre(p)}>
                      <Sparkles className="h-3.5 w-3.5" />
                      基于此类型创建项目
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
