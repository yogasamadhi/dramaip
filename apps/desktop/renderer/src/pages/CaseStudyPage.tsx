import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileText, LibraryBig, Loader2, Trash2, Upload } from 'lucide-react'
import type { CreativeCaseStudy } from '@sdns/core'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

function Tags({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => <Badge key={i} variant="secondary">{it}</Badge>)}
      </div>
    </div>
  )
}

export function CaseStudyPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CreativeCaseStudy[]>([])
  const [busy, setBusy] = useState(false)

  async function reload() {
    setItems(await ipc.caseStudy.list())
  }

  useEffect(() => {
    void reload()
  }, [])

  async function importDocuments() {
    setBusy(true)
    const tid = toast.loading('请选择样本文档…')
    try {
      const picked = await ipc.caseStudy.importDocuments()
      if (picked.canceled) {
        toast.dismiss(tid)
        return
      }
      if (!picked.ok) {
        toast.error('导入失败：' + (picked.error ?? '未知错误'), { id: tid })
        return
      }
      const readable = picked.documents.filter((d) => d.text.trim())
      const failedRead = picked.documents.filter((d) => d.error)
      if (readable.length === 0) {
        toast.error(failedRead[0]?.error ?? '没有可读取的文档内容', { id: tid })
        return
      }
      toast.loading(`正在抽取 ${readable.length} 份文档结构…`, { id: tid })
      let okCount = 0
      let failCount = failedRead.length
      for (const doc of readable) {
        const res = await ipc.ai.run({
          taskType: 'extract_case_structure',
          userInstruction: [
            `文件名：${doc.fileName}`,
            doc.truncated ? '注意：文档较长，已截取前 80000 字符用于结构抽取。' : '',
            '',
            doc.text,
          ].filter(Boolean).join('\n'),
        })
        if (res.ok) okCount++
        else failCount++
      }
      if (okCount > 0) {
        toast.success(`已导入 ${okCount} 个样本${failCount ? `，失败 ${failCount} 个` : ''}`, { id: tid })
        await reload()
      } else {
        toast.error('文档读取成功，但 AI 抽取失败', { id: tid })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft />
        </Button>
        <LibraryBig className="h-5 w-5" />
        <h1 className="text-lg font-semibold">本地样本库</h1>
        <p className="text-sm text-muted-foreground">上传本地文档后抽取结构，只保存抽象标签。</p>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-6xl space-y-6 p-6">
            <Card>
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">上传样本文档</div>
                  <p className="text-sm text-muted-foreground">
                    支持 .md / .txt / .docx，可一次选择多个文件；系统会读取文本并用 AI 抽取人物关系、开场钩子、爽点、反转、悬念、视觉模式和风险标签，不保存原文。
                  </p>
                </div>
                <Button onClick={importDocuments} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                  上传并抽取
                </Button>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {items.map((it) => (
                <Card key={it.id}>
                  <CardHeader>
                    <div className="flex items-start gap-2">
                      <CardTitle className="text-base">{it.title}</CardTitle>
                      {it.genre && <Badge variant="outline">{it.genre}</Badge>}
                      <Button
                        className="ml-auto"
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          await ipc.caseStudy.remove(it.id)
                          toast.success('已删除样本')
                          await reload()
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {it.summary && <p className="text-sm text-muted-foreground">{it.summary}</p>}
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <Tags label="关系模式" items={it.relationshipPatterns} />
                    <Tags label="开场钩子" items={it.openingHooks} />
                    <Tags label="爽点释放" items={it.highlightBeats} />
                    <Tags label="反转机制" items={it.reversalMechanisms} />
                    <Tags label="结尾悬念" items={it.cliffhangers} />
                    <Tags label="视觉模式" items={it.visualPatterns} />
                    <Tags label="风险标签" items={it.riskTags} />
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
