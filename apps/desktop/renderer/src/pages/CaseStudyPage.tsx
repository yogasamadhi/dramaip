import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BookOpen, Check, FileText, LibraryBig, Loader2, Plus, Trash2, Upload, WandSparkles, X } from 'lucide-react'
import type { CaseStudyDocumentWithChapters, CreativeCaseStudy } from '@sdns/core'
import type { CaseStudyImportChapter, CaseStudyImportDocument } from '@/lib/ipc'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

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

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || '样本文档'
}

function estimateWordCount(text: string): number {
  return text.match(/[A-Za-z0-9]+|[\u3400-\u9fff]/g)?.length ?? 0
}

function normalizeChapters(chapters: CaseStudyImportChapter[]): CaseStudyImportChapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    orderIndex: index,
    title: chapter.title.trim() || `章节 ${index + 1}`,
    content: chapter.content,
    charCount: chapter.content.length,
    wordCount: estimateWordCount(chapter.content),
  }))
}

export function CaseStudyPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CreativeCaseStudy[]>([])
  const [documents, setDocuments] = useState<CaseStudyDocumentWithChapters[]>([])
  const [pendingImports, setPendingImports] = useState<CaseStudyImportDocument[]>([])
  const [busy, setBusy] = useState(false)

  async function reload() {
    const [caseStudies, savedDocuments] = await Promise.all([ipc.caseStudy.list(), ipc.caseStudy.listDocuments()])
    setItems(caseStudies)
    setDocuments(savedDocuments)
  }

  useEffect(() => {
    void reload()
  }, [])

  function updatePendingChapter(docIndex: number, chapterIndex: number, patch: Partial<CaseStudyImportChapter>) {
    setPendingImports((prev) =>
      prev.map((doc, i) => {
        if (i !== docIndex) return doc
        const chapters = doc.chapters.map((chapter, j) => {
          if (j !== chapterIndex) return chapter
          const next = { ...chapter, ...patch, status: 'manual' as const }
          return {
            ...next,
            charCount: next.content.length,
            wordCount: estimateWordCount(next.content),
          }
        })
        return { ...doc, chapters: normalizeChapters(chapters) }
      }),
    )
  }

  function removePendingChapter(docIndex: number, chapterIndex: number) {
    setPendingImports((prev) =>
      prev.map((doc, i) =>
        i === docIndex ? { ...doc, chapters: normalizeChapters(doc.chapters.filter((_, j) => j !== chapterIndex)) } : doc,
      ),
    )
  }

  function addPendingChapter(docIndex: number) {
    setPendingImports((prev) =>
      prev.map((doc, i) => {
        if (i !== docIndex) return doc
        const next: CaseStudyImportChapter = {
          orderIndex: doc.chapters.length,
          title: `章节 ${doc.chapters.length + 1}`,
          content: '',
          charCount: 0,
          wordCount: 0,
          status: 'manual',
          warning: '人工新增章节，请补充正文。',
        }
        return { ...doc, chapters: normalizeChapters([...doc.chapters, next]) }
      }),
    )
  }

  function removePendingDocument(index: number) {
    setPendingImports((prev) => prev.filter((_, i) => i !== index))
  }

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
      const readable = picked.documents.filter((d) => d.text.trim() && d.chapters.length)
      const failedRead = picked.documents.filter((d) => d.error)
      if (readable.length === 0) {
        toast.error(failedRead[0]?.error ?? '没有可读取的文档内容', { id: tid })
        return
      }
      setPendingImports((prev) => [...readable.map((doc) => ({ ...doc, chapters: normalizeChapters(doc.chapters) })), ...prev])
      toast.success(`已拆分 ${readable.length} 份文档${failedRead.length ? `，失败 ${failedRead.length} 份` : ''}`, { id: tid })
    } finally {
      setBusy(false)
    }
  }

  async function saveDocumentSplit(doc: CaseStudyImportDocument, index: number) {
    const chapters = normalizeChapters(doc.chapters.filter((chapter) => chapter.title.trim() || chapter.content.trim()))
    if (!chapters.length) {
      toast.error('请至少保留一个章节')
      return
    }
    await ipc.caseStudy.createDocument({
      title: titleFromFileName(doc.fileName),
      fileName: doc.fileName,
      sourceType: doc.sourceType,
      truncated: doc.truncated,
      parseWarnings: doc.parseWarnings,
      chapters,
    })
    toast.success('已保存拆章元数据')
    removePendingDocument(index)
    await reload()
  }

  async function extractStructure(doc: CaseStudyImportDocument) {
    const chapters = normalizeChapters(doc.chapters.filter((chapter) => chapter.content.trim()))
    if (!chapters.length) {
      toast.error('请先补充至少一个章节正文')
      return
    }
    setBusy(true)
    const tid = toast.loading('正在抽取样本结构…')
    try {
      const res = await ipc.ai.run({
        taskType: 'extract_case_structure',
        userInstruction: [
          `文件名：${doc.fileName}`,
          doc.truncated ? '注意：文档较长，已按导入安全策略截取文本用于结构抽取。' : '',
          '以下为用户确认后的章节拆分，仅用于本次结构抽取，不写入项目正文。',
          '',
          chapters.map((chapter) => `## ${chapter.title}\n${chapter.content}`).join('\n\n'),
        ].filter(Boolean).join('\n'),
      })
      if (res.ok) {
        toast.success('已抽取并保存结构样本', { id: tid })
        await reload()
      } else {
        toast.error('AI 抽取失败：' + (res.error ?? '未知错误'), { id: tid })
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
        <p className="text-sm text-muted-foreground">上传本地文档后拆章并抽取结构，只保存抽象标签和拆章预览。</p>
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
                    支持 .md / .txt / .docx，可一次选择多个文件；系统会先识别章节，修正后再保存拆章或抽取结构。
                  </p>
                </div>
                <Button onClick={importDocuments} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                  上传并拆章
                </Button>
              </CardContent>
            </Card>

            {pendingImports.length > 0 && (
              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold">待确认拆章</h2>
                  <p className="text-sm text-muted-foreground">可修正标题、合并或清理识别错误的章节，再保存拆章元数据或抽取结构。</p>
                </div>
                {pendingImports.map((doc, docIndex) => (
                  <Card key={`${doc.path}-${docIndex}`}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start gap-2">
                        <CardTitle className="text-base">{doc.fileName}</CardTitle>
                        <Badge variant="outline">{doc.chapters.length} 章</Badge>
                        {doc.truncated && <Badge variant="secondary">已截断</Badge>}
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void saveDocumentSplit(doc, docIndex)} disabled={busy}>
                            <Check className="h-4 w-4" />
                            保存拆章
                          </Button>
                          <Button size="sm" onClick={() => void extractStructure(doc)} disabled={busy}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                            抽取结构
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removePendingDocument(docIndex)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {doc.parseWarnings.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {doc.parseWarnings.map((warning, index) => <Badge key={index} variant="secondary">{warning}</Badge>)}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {doc.chapters.map((chapter, chapterIndex) => (
                        <div key={`${chapter.orderIndex}-${chapterIndex}`} className="space-y-2 rounded-md border p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center">
                            <Input
                              value={chapter.title}
                              onChange={(event) => updatePendingChapter(docIndex, chapterIndex, { title: event.target.value })}
                              aria-label="章节标题"
                            />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant={chapter.status === 'needs_review' ? 'secondary' : 'outline'}>
                                {chapter.status === 'manual' ? '已修正' : chapter.status === 'needs_review' ? '需确认' : '已识别'}
                              </Badge>
                              <span>{chapter.charCount} 字符</span>
                            </div>
                            <Button size="icon" variant="ghost" onClick={() => removePendingChapter(docIndex, chapterIndex)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          {chapter.warning && <p className="text-xs text-muted-foreground">{chapter.warning}</p>}
                          <Textarea
                            value={chapter.content}
                            rows={6}
                            onChange={(event) => updatePendingChapter(docIndex, chapterIndex, { content: event.target.value })}
                            aria-label="章节正文"
                          />
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={() => addPendingChapter(docIndex)}>
                        <Plus className="h-4 w-4" />
                        新增章节
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}

            {documents.length > 0 && (
              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold">已保存拆章</h2>
                  <p className="text-sm text-muted-foreground">保存的是章节标题、字数和短预览，不保存完整原文。</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {documents.map((doc) => (
                    <Card key={doc.id}>
                      <CardHeader>
                        <div className="flex items-start gap-2">
                          <BookOpen className="mt-1 h-4 w-4 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <CardTitle className="truncate text-base">{doc.title}</CardTitle>
                            <p className="text-xs text-muted-foreground">{doc.fileName}</p>
                          </div>
                          <Badge variant="outline">{doc.chapterCount} 章</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={async () => {
                              await ipc.caseStudy.deleteDocument(doc.id)
                              toast.success('已删除拆章记录')
                              await reload()
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        {doc.chapters.slice(0, 5).map((chapter) => (
                          <div key={chapter.id} className="rounded-md border p-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{chapter.orderIndex + 1}. {chapter.title}</span>
                              <Badge variant={chapter.status === 'needs_review' ? 'secondary' : 'outline'}>
                                {chapter.status === 'manual' ? '已修正' : chapter.status === 'needs_review' ? '需确认' : '已识别'}
                              </Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{chapter.textPreview}</p>
                          </div>
                        ))}
                        {doc.chapters.length > 5 && <p className="text-xs text-muted-foreground">还有 {doc.chapters.length - 5} 章未展开。</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">结构样本</h2>
                <p className="text-sm text-muted-foreground">AI 抽取后保存的关系、钩子、爽点、反转、悬念和视觉模式。</p>
              </div>
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
            </section>
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
