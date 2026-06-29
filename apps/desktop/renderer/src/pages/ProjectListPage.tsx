import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Settings, Trash2, BookText, Clapperboard, FileText, Library, Upload, LibraryBig } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectsStore } from '@/stores/useProjectsStore'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function ProjectListPage() {
  const navigate = useNavigate()
  const { projects, loading, fetch, remove } = useProjectsStore()

  useEffect(() => {
    void fetch()
  }, [fetch])

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`确认删除项目「${title}」？此操作不可恢复。`)) return
    try {
      await remove(id)
      toast.success('已删除项目')
    } catch (e) {
      toast.error('删除失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <BookText className="h-5 w-5" />
          <h1 className="text-lg font-semibold">短剧 IP 小说写作工作台</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/genres')}>
              <Library />
              类型库
            </Button>
            <Button variant="outline" onClick={() => navigate('/case-studies')}>
              <LibraryBig />
              样本库
            </Button>
            <Button variant="outline" onClick={() => navigate('/templates')}>
              <FileText />
              模板
            </Button>
          </div>
          <div className="mx-1 h-6 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                const id = toast.loading('正在导入项目包…')
                const res = await ipc.project.importPackage()
                if (res.ok && res.project) {
                  toast.success(`已导入「${res.project.title}」`, { id })
                  void fetch()
                  navigate(`/projects/${res.project.id}`)
                } else if (res.canceled) {
                  toast.dismiss(id)
                } else {
                  toast.error('导入失败：' + (res.error ?? '未知错误'), { id })
                }
              }}
            >
              <Upload />
              导入项目包
            </Button>
            <Button variant="outline" onClick={() => navigate('/adaptations/new')}>
              <Clapperboard />
              创建改编
            </Button>
            <Button onClick={() => navigate('/projects/new')}>
              <Plus />
              新建项目
            </Button>
          </div>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button variant="outline" onClick={() => navigate('/settings')}>
            <Settings />
            设置
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">
            {loading && projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
                还没有项目，点击右上角「新建项目」开始创作。
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((p) => (
                  <Card key={p.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{p.title}</CardTitle>
                        <Badge variant="secondary">{p.shortDramaType}</Badge>
                      </div>
                      <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                        {p.synopsis || '（暂无简介）'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 text-xs text-muted-foreground">
                      <div>目标集数：{p.targetEpisodeCount ?? '—'}</div>
                      <div>更新：{formatDate(p.updatedAt)}</div>
                    </CardContent>
                    <CardFooter className="justify-between">
                      <Button size="sm" onClick={() => navigate(`/projects/${p.id}`)}>
                        打开工作台
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="删除"
                        onClick={() => handleDelete(p.id, p.title)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
