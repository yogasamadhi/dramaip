import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { PackageSchema, type Project, type Request } from '../shared/contracts.ts'
import { textStats } from '../shared/stats.ts'
import { StudioModel, draftOf, type Connection } from './model.ts'
import { Diff, Markdown } from './components.tsx'
import { CSS } from './styles.ts'

interface ClientContext {
  connection: Connection
  slots: {
    inject(slot: string, contribute: () => unknown): void
    register(options: Record<string, unknown>, component: () => ReactNode): unknown
  }
  effect(acquire: () => () => void, label: string): unknown
  on(event: 'connection/reset', callback: () => void): () => void
}
export const inject = ['slots', 'connection']
const PANEL_ID = 'dramaip.studio'
export function apply(ctx: ClientContext): void {
  const model = new StudioModel(ctx.connection)
  ctx.effect(() => () => model.dispose(), 'dramaip:client-model')
  ctx.effect(
    () =>
      ctx.on('connection/reset', () => {
        void model.refresh()
      }),
    'dramaip:connection-reset',
  )
  const Panel = () => <Studio model={model} />
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => '尽意 · 故事创作' },
      () => <span aria-hidden="true">尽</span>,
    ),
  )
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Studio({ model }: { model: StudioModel }) {
  const s = useSyncExternalStore(model.subscribe, model.snapshot)
  const p = s.project
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [newKind, setNewKind] = useState<'character' | 'world'>('character')
  const [preview, setPreview] = useState(false)
  const [historyId, setHistoryId] = useState('')
  const [localError, setLocalError] = useState('')
  useEffect(() => {
    void model.refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void model.refresh()
    }, 2000)
    const refresh = () => {
      void model.refresh()
    }
    const leave = (e: BeforeUnloadEvent) => {
      if (model.state.dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void model.save()
      }
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('beforeunload', leave)
    window.addEventListener('keydown', keys)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('keydown', keys)
    }
  }, [model])
  const base = p ? { projectId: p.id, expectedRevision: p.stateRevision } : undefined
  const write = async (request: Request) => {
    setLocalError('')
    return model.mutate(request)
  }
  const chapterId = s.view.kind === 'chapter' ? s.view.id : undefined
  const currentChapter = p?.chapters.find((c) => c.id === chapterId)
  const stats = textStats(s.draft.text)
  const selectedHistory = p?.history.find((h) => h.id === historyId)
  const locked = s.busy || Boolean(p?.archived)
  const aiRequest = p
    ? `请修改尽意项目「${p.title}」（projectId: ${p.id}）${currentChapter ? `的章节「${currentChapter.title}」（chapterId: ${currentChapter.id}）` : '中我指定的章节'}。先调用 dramaip_project_summary、dramaip_read_settings 和 dramaip_read_chapter，遵守作者意图及当前设定，然后用读取的版本调用 dramaip_propose_chapter 提交完整正文提案。不要直接改写正文，由我在尽意面板预览并采用。\n修改要求：`
    : ''
  async function importFile(file: File | undefined, format: 'json' | 'md') {
    if (!file) return
    try {
      const content = await file.text()
      if (format === 'json')
        await write({ op: 'import', package: PackageSchema.parse(JSON.parse(content)) })
      else if (base)
        await write({
          op: 'importMarkdown',
          ...base,
          title: file.name.replace(/\.(md|markdown|txt)$/i, '') || '导入章节',
          text: content,
        })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }
  async function exportFile(format: 'json' | 'markdown') {
    if (!p) return
    const result = await write({ op: 'export', projectId: p.id, format })
    if (result?.kind === 'export')
      download(
        result.filename,
        result.text,
        format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
      )
  }
  return (
    <section className="dip" data-dramaip-panel={PANEL_ID}>
      <style>{CSS}</style>
      <header className="dip-header">
        <div>
          <span className="dip-eyebrow">DRAMAIP · 尽意</span>
          <h1>把故事写下去。</h1>
          <p>尽作者之意，成万象之作</p>
        </div>
        <div className="dip-status">
          <span className={s.online ? 'dip-dot' : 'dip-dot dip-offline'} />
          {s.online ? '本地故事工作台' : '连接中断 · 草稿已保留'}
        </div>
      </header>
      <div className="dip-toolbar">
        <button onClick={() => setCreating(!creating)} disabled={s.busy || s.dirty}>
          ＋ 新建项目
        </button>
        <label className="dip-file">
          导入项目 JSON
          <input
            type="file"
            accept=".json"
            disabled={s.busy || s.dirty}
            onChange={(e) => {
              void importFile(e.target.files?.[0], 'json')
              e.target.value = ''
            }}
          />
        </label>
        <button onClick={() => void model.refresh()} disabled={s.busy}>
          刷新
        </button>
        <label className="dip-inline">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          显示归档
        </label>
      </div>
      {creating && (
        <form
          className="dip-new"
          onSubmit={async (e) => {
            e.preventDefault()
            const result = await write({
              op: 'create',
              title: newTitle,
              synopsis: '',
              authorIntent: '',
            })
            if (result) {
              setCreating(false)
              setNewTitle('')
            }
          }}
        >
          <input
            aria-label="新项目名称"
            placeholder="给你的故事起个名字"
            value={newTitle}
            maxLength={200}
            onChange={(e) => setNewTitle(e.target.value)}
            required
          />
          <button disabled={s.busy || !newTitle.trim()}>创建项目</button>
        </form>
      )}
      {(s.error || localError) && (
        <div role="alert" className="dip-error">
          {localError || s.error}
        </div>
      )}
      {s.notice && (
        <div role="status" className="dip-notice">
          {s.notice}
        </div>
      )}
      <div className="dip-workspace">
        <aside className="dip-nav">
          <h2>我的故事</h2>
          {s.projects
            .filter((p) => showArchived || !p.archived)
            .map((project) => (
              <button
                className={p?.id === project.id ? 'dip-nav-active' : ''}
                key={project.id}
                onClick={() => void model.open(project.id)}
                disabled={s.busy}
              >
                {project.title}
                {project.archived ? ' · 已归档' : ''}
                <small>
                  {project.chapters} 章 · {project.pending} 项待处理
                </small>
              </button>
            ))}
          {!s.projects.length && <p className="dip-muted">新建一个项目，从第一章开始。</p>}
          {p && (
            <>
              <hr />
              <h2>创作目录</h2>
              <button
                className={s.view.kind === 'project' ? 'dip-nav-active' : ''}
                onClick={() => model.select({ kind: 'project' })}
              >
                作品与作者意图
              </button>
              {p.chapters.map((c, i) => (
                <button
                  key={c.id}
                  className={
                    s.view.kind === 'chapter' && s.view.id === c.id ? 'dip-nav-active' : ''
                  }
                  onClick={() => model.select({ kind: 'chapter', id: c.id })}
                >
                  {String(i + 1).padStart(2, '0')}　{c.title}
                </button>
              ))}
              <form
                className="dip-new-item"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (base) {
                    const result = await write({
                      op: 'createChapter',
                      ...base,
                      title: newItem,
                      text: '',
                    })
                    if (result?.kind === 'project') {
                      setNewItem('')
                      model.select({ kind: 'chapter', id: result.project.chapters.at(-1)!.id })
                    }
                  }
                }}
              >
                <input
                  aria-label="新章节标题"
                  placeholder="新章节标题"
                  value={newItem}
                  maxLength={200}
                  onChange={(e) => setNewItem(e.target.value)}
                  disabled={locked}
                  required
                />
                <button disabled={locked || !newItem.trim()}>＋ 新章节</button>
              </form>
              <label className="dip-file">
                导入 Markdown 章节
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  disabled={locked || s.dirty}
                  onChange={(e) => {
                    void importFile(e.target.files?.[0], 'md')
                    e.target.value = ''
                  }}
                />
              </label>
              <h2>人物与世界</h2>
              {p.settings.map((x) => (
                <button
                  key={x.id}
                  className={
                    s.view.kind === 'setting' && s.view.id === x.id ? 'dip-nav-active' : ''
                  }
                  onClick={() => model.select({ kind: 'setting', id: x.id })}
                >
                  {x.kind === 'character' ? '人' : '世'} · {x.title}
                  {x.archived ? '（归档）' : ''}
                </button>
              ))}
              <div className="dip-new-item">
                <select
                  aria-label="新设定类型"
                  value={newKind}
                  disabled={locked}
                  onChange={(e) => setNewKind(e.target.value as typeof newKind)}
                >
                  <option value="character">人物</option>
                  <option value="world">世界设定</option>
                </select>
                <button
                  disabled={locked || s.dirty}
                  onClick={async () => {
                    if (base) {
                      const result = await write({
                        op: 'saveSetting',
                        ...base,
                        kind: newKind,
                        title: newKind === 'character' ? '未命名人物' : '未命名设定',
                        text: '',
                        archived: false,
                      })
                      if (result?.kind === 'project')
                        model.select({ kind: 'setting', id: result.project.settings.at(-1)!.id })
                    }
                  }}
                >
                  ＋ 新设定
                </button>
              </div>
              <hr />
              <button onClick={() => model.select({ kind: 'proposals' })}>
                修改提案 · {p.proposals.filter((q) => q.status === 'pending').length}
              </button>
              <button onClick={() => model.select({ kind: 'history' })}>历史版本</button>
            </>
          )}
        </aside>
        <main className="dip-main">
          {!p ? (
            <div className="dip-empty">
              <span>一切故事，都从一句话开始。</span>
              <p>
                创建项目，记录章节、人物与世界。
                <br />
                AI 提供建议，作品由你决定。
              </p>
            </div>
          ) : (
            <>
              <div className="dip-project-bar">
                <div>
                  <strong>{p.title}</strong>
                  <small>{p.archived ? '已归档' : `内容版本 ${p.contentRevision}`}</small>
                </div>
                <div>
                  <button disabled={s.busy || s.dirty} onClick={() => void exportFile('markdown')}>
                    导出稿件
                  </button>
                  <button disabled={s.busy || s.dirty} onClick={() => void exportFile('json')}>
                    备份项目
                  </button>
                </div>
              </div>
              {['project', 'chapter', 'setting'].includes(s.view.kind) && (
                <>
                  <div className="dip-editor-bar">
                    <span className="dip-eyebrow">
                      {s.view.kind === 'project'
                        ? '作品 · 作者意图'
                        : s.view.kind === 'chapter'
                          ? '章节 · 正文'
                          : '创作设定'}{' '}
                      · {s.dirty ? '未保存' : '已保存'}
                    </span>
                    <div>
                      {s.dirty && (
                        <button disabled={s.busy} onClick={() => model.discard()}>
                          放弃草稿
                        </button>
                      )}
                      <button
                        className="dip-primary"
                        disabled={
                          !s.dirty ||
                          !s.draft.title.trim() ||
                          s.busy ||
                          (p.archived && s.draft.archived)
                        }
                        onClick={() => void model.save()}
                      >
                        {s.busy ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                  <label>
                    标题
                    <input
                      aria-label="标题"
                      value={s.draft.title}
                      maxLength={200}
                      disabled={s.busy || (p.archived && s.view.kind !== 'project')}
                      onChange={(e) => model.edit({ title: e.target.value })}
                    />
                  </label>
                  {s.view.kind === 'project' ? (
                    <>
                      <label>
                        作品简介
                        <textarea
                          aria-label="作品简介"
                          value={s.draft.synopsis}
                          disabled={locked}
                          onChange={(e) => model.edit({ synopsis: e.target.value })}
                        />
                      </label>
                      <label>
                        作者意图
                        <textarea
                          aria-label="作者意图"
                          placeholder="你希望表达什么？哪些创作选择需要被尊重？"
                          value={s.draft.authorIntent}
                          disabled={locked}
                          onChange={(e) => model.edit({ authorIntent: e.target.value })}
                        />
                      </label>
                      <label className="dip-inline">
                        <input
                          type="checkbox"
                          aria-label="归档项目"
                          checked={s.draft.archived}
                          disabled={s.busy}
                          onChange={(e) => model.edit({ archived: e.target.checked })}
                        />
                        归档项目（取消勾选并保存即可恢复）
                      </label>
                      {p.importedFrom && (
                        <p className="dip-muted">导入来源项目：{p.importedFrom.projectId}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="dip-toolbar">
                        {s.view.kind === 'chapter' && (
                          <>
                            <button
                              disabled={locked || s.dirty}
                              onClick={() => {
                                if (base && currentChapter)
                                  void write({
                                    op: 'reorderChapter',
                                    ...base,
                                    chapterId: currentChapter.id,
                                    direction: 'up',
                                  })
                              }}
                            >
                              上移章节
                            </button>
                            <button
                              disabled={locked || s.dirty}
                              onClick={() => {
                                if (base && currentChapter)
                                  void write({
                                    op: 'reorderChapter',
                                    ...base,
                                    chapterId: currentChapter.id,
                                    direction: 'down',
                                  })
                              }}
                            >
                              下移章节
                            </button>
                          </>
                        )}
                        <button onClick={() => setPreview(!preview)}>
                          {preview ? '编辑 Markdown' : '预览 Markdown'}
                        </button>
                        {s.view.kind === 'setting' && (
                          <>
                            <select
                              aria-label="设定类型"
                              disabled={locked}
                              value={s.draft.kind}
                              onChange={(e) =>
                                model.edit({ kind: e.target.value as 'character' | 'world' })
                              }
                            >
                              <option value="character">人物</option>
                              <option value="world">世界设定</option>
                            </select>
                            <label className="dip-inline">
                              <input
                                type="checkbox"
                                checked={s.draft.archived}
                                disabled={locked}
                                onChange={(e) => model.edit({ archived: e.target.checked })}
                              />
                              归档设定
                            </label>
                          </>
                        )}
                      </div>
                      {preview ? (
                        <Markdown text={s.draft.text} />
                      ) : (
                        <textarea
                          className="dip-manuscript"
                          aria-label="正文"
                          placeholder="在这里写下你的故事……"
                          disabled={locked}
                          value={s.draft.text}
                          onChange={(e) => model.edit({ text: e.target.value })}
                        />
                      )}
                      <div className="dip-stats">
                        {stats.characters} 字符 · {stats.cjkCharacters} 中日韩文字 ·{' '}
                        {stats.latinWords} 英文词 · {stats.paragraphs} 段 · {stats.dialogueLines}{' '}
                        对白行 · 约 {stats.readingMinutes} 分钟
                      </div>
                    </>
                  )}
                  {s.conflict && (
                    <div className="dip-conflict">
                      <h3>服务端内容已变化</h3>
                      <p>以下对比为最新保存内容与当前草稿。确认后可保留草稿，更新保存基准。</p>
                      <Diff
                        before={JSON.stringify(draftOf(p, s.view), null, 2)}
                        after={JSON.stringify(s.draft, null, 2)}
                      />
                      <button disabled={s.busy} onClick={() => model.rebase()}>
                        确认保留草稿并使用最新基准
                      </button>
                    </div>
                  )}
                </>
              )}
              {s.view.kind === 'proposals' && (
                <>
                  <h2>修改提案</h2>
                  <p className="dip-muted">AI 提案不会自动改写正文。请逐项阅读差异后决定采用。</p>
                  {!p.proposals.length && (
                    <p>尚无提案。复制下方请求，在 DSH 对话中提出修改要求。</p>
                  )}
                  {[...p.proposals].reverse().map((q) => {
                    const chapter = p.chapters.find((c) => c.id === q.chapterId)!
                    const stale =
                      q.baseContentRevision !== p.contentRevision ||
                      q.baseRevision !== chapter.revision
                    const before =
                      p.history.find(
                        (h) => h.chapterId === q.chapterId && h.revision === q.baseRevision,
                      )?.text ?? ''
                    return (
                      <article className="dip-card" key={q.id}>
                        <div className="dip-editor-bar">
                          <h3>{chapter.title}</h3>
                          <span>
                            {q.status === 'accepted'
                              ? '已采用'
                              : q.status === 'rejected'
                                ? '已拒绝'
                                : stale
                                  ? '已过期 · 请重新生成'
                                  : '待处理'}
                          </span>
                        </div>
                        <p>{q.explanation}</p>
                        <small>
                          基础版本 {q.baseRevision} · 上下文 {q.baseContentRevision} ·{' '}
                          {new Date(q.createdAt).toLocaleString()}
                          {q.sessionId ? ` · 会话 ${q.sessionId}` : ''}
                          {q.callId ? ` · 调用 ${q.callId}` : ''}
                        </small>
                        <details open={q.status === 'pending'}>
                          <summary>与提案基础版本的逐行差异</summary>
                          <Diff before={before} after={q.text} />
                        </details>
                        {q.status === 'pending' && (
                          <div className="dip-toolbar">
                            <button
                              className="dip-primary"
                              disabled={locked || stale}
                              onClick={() => {
                                if (base) void write({ op: 'accept', ...base, proposalId: q.id })
                              }}
                            >
                              采用提案
                            </button>
                            <button
                              disabled={locked}
                              onClick={() => {
                                if (base) void write({ op: 'reject', ...base, proposalId: q.id })
                              }}
                            >
                              拒绝提案
                            </button>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </>
              )}
              {s.view.kind === 'history' && (
                <>
                  <h2>历史版本</h2>
                  <select
                    aria-label="历史版本"
                    value={historyId}
                    onChange={(e) => setHistoryId(e.target.value)}
                  >
                    <option value="">选择章节历史版本</option>
                    {[...p.history].reverse().map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.title} · v{h.revision} · {h.source} ·{' '}
                        {new Date(h.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  {selectedHistory && (
                    <>
                      <p>左侧删除行来自当前正文，新增行来自选中的历史版本。</p>
                      <Diff
                        before={
                          p.chapters.find((c) => c.id === selectedHistory.chapterId)?.text ?? ''
                        }
                        after={selectedHistory.text}
                      />
                      <button
                        disabled={locked}
                        onClick={() => {
                          if (base)
                            void write({ op: 'restore', ...base, revisionId: selectedHistory.id })
                        }}
                      >
                        恢复为新版本
                      </button>
                    </>
                  )}
                </>
              )}
              <details className="dip-agent">
                <summary>在 DSH 对话中使用 AI</summary>
                <p>复制请求并补充修改要求；提案生成后，到“修改提案”中预览和采用。</p>
                <textarea aria-label="AI 请求示例" readOnly value={aiRequest} />
                <button
                  onClick={() => {
                    void (
                      navigator.clipboard
                        ? navigator.clipboard.writeText(aiRequest)
                        : Promise.reject(new Error('clipboard unavailable'))
                    ).catch(() => setLocalError('复制不可用，请在请求框中手动选中并复制。'))
                  }}
                >
                  复制请求
                </button>
                <small>
                  项目 ID：{p.id}
                  {currentChapter ? ` · 章节 ID：${currentChapter.id}` : ''}
                </small>
              </details>
            </>
          )}
        </main>
      </div>
    </section>
  )
}
