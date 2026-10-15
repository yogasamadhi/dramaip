import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, confirmDialog, NativeSelect } from "@dramaip/ui-shared";
import {
  NarrativeArcScopeSchema,
  type NarrativeIndexDetail,
} from "@dramaip/contracts/knowledge";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { WritingVolumesPanel } from "../novel/WritingVolumesPanel";
import { NarrativeStorySources } from "./NarrativeStorySources";

const summaryLabels = {
  current: "当前有效派生摘要",
  stale: "摘要来源已过期",
  missing: "缺少有效派生摘要",
  empty: "空章，没有正文",
};
const excludedLabels: Record<
  NarrativeIndexDetail["excluded"][number]["reason"],
  string
> = {
  "unverified-adoption": "无法证明此资料的精确采用来源（含历史资料）",
  "source-stale": "正文版本已变化",
  "invalid-evidence": "缺少当前原文逐字证据",
  "modified-record": "资料已修改或不匹配原采用输出",
  "missing-summary": "缺少对应摘要／事实文本",
};

export function NarrativeIndexPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chapterId, setChapterId] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [arcId, setArcId] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const catalog = useQuery({
    queryKey: ["narrative-index", projectId],
    queryFn: () => client.narrativeIndex.catalog(projectId),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: [
      "narrative-index-detail",
      projectId,
      chapterId,
      catalog.data?.fingerprint,
    ],
    queryFn: () => client.narrativeIndex.chapter(projectId, chapterId),
    enabled: open && Boolean(chapterId) && !catalog.error,
  });
  const arc = useQuery({
    queryKey: ["resource", "story-arcs", arcId, catalog.data?.fingerprint],
    queryFn: () => client.resources.get("story-arcs", arcId),
    enabled: open && Boolean(arcId),
  });
  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["narrative-index", projectId] }),
      queries.invalidateQueries({
        queryKey: ["narrative-index-detail", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["resource", "story-arcs"] }),
    ]);
  };
  const selected = catalog.data?.chapters.find(
    (chapter) => chapter.id === chapterId,
  );
  const value =
    detail.data?.projectId === projectId &&
    detail.data.fingerprint === catalog.data?.fingerprint &&
    selected
      ? detail.data
      : undefined;
  const binding = catalog.data?.groups.find(
    (group) => group.kind === "story-arc" && group.id === arcId,
  );
  const bindArc = async () => {
    if (
      busy ||
      !catalog.data ||
      catalog.error ||
      !arc.data ||
      arc.error ||
      !binding ||
      arc.data.projectId !== projectId ||
      arc.data.version !== binding.version
    )
      return;
    const scope = NarrativeArcScopeSchema.safeParse({
      format: "chapter-refs-v1",
      chapters: catalog.data.chapters
        .filter((chapter) => selection.includes(chapter.id))
        .map(({ id, version }) => ({ id, version })),
    });
    if (!scope.success) {
      setError("请明确选择 1–2000 个当前章节；不自动猜测范围。");
      return;
    }
    const frozen = catalog.data.fingerprint;
    const source = arc.data;
    if (
      !source.payload ||
      typeof source.payload !== "object" ||
      Array.isArray(source.payload)
    ) {
      setError("故事弧资料结构无效，未改写原资料。");
      return;
    }
    const payload = source.payload as Record<string, unknown>;
    if (
      !(await confirmDialog({
        title: "确认故事弧章节范围",
        description: `将「${source.title}」v${source.version} 绑定到所选 ${scope.data.chapters.length} 章的当前版本。只更新规划范围，不改正文、不证明故事弧已发生；版本变化后需要重新确认。`,
        confirmLabel: "确认记录章节范围",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const current = await client.narrativeIndex.catalog(projectId);
      if (current.fingerprint !== frozen)
        throw new Error("确认期间来源已变化，请刷新后重新选择，不自动换源。");
      await client.resources.update("story-arcs", source.id, {
        version: source.version,
        payload: { ...payload, narrativeChapterScope: scope.data },
      });
      setSelection([]);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  return (
    <details
      className="rounded-lg border border-line bg-surface p-5"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        本地长篇来源索引
      </summary>
      {open && (
        <section aria-label="本地长篇来源索引" className="mt-4 space-y-4">
          <p className="text-sm text-muted">
            全书／卷／显式故事弧 → 正文版本 → 已采用派生摘要与事实 →
            原文段落位置。这是本地来源目录，不自动送入模型，也不是全书语义检查。摘要的逐字依据与采用回执不保证模型概括正确；章节摘要字段、旧记忆和计划不冒充事实。
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            刷新来源索引
          </Button>
          <WritingVolumesPanel
            key={projectId}
            projectId={projectId}
            onChanged={refresh}
          />
          <NarrativeStorySources
            key={projectId}
            projectId={projectId}
            chapterId={chapterId || undefined}
          />
          {(error || catalog.error || detail.error || arc.error) && (
            <p role="alert" className="text-sm text-danger-strong">
              {error ?? message(catalog.error ?? detail.error ?? arc.error)}
            </p>
          )}
          {catalog.isPending && (
            <p className="text-sm text-muted">正在读取实际目录与采用来源……</p>
          )}
          {!catalog.error && catalog.data && (
            <>
              {catalog.data.unavailable.map((item) => (
                <p key={item} role="alert" className="text-sm text-muted">
                  {item}
                </p>
              ))}
              <p className="break-all text-xs text-muted">
                目录版本 {catalog.data.projectVersion} · 来源指纹{" "}
                {catalog.data.fingerprint}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div
                  aria-label="长篇索引目录"
                  className="max-h-96 space-y-3 overflow-auto rounded border border-line p-3"
                >
                  {catalog.data.groups.map((group) => (
                    <div
                      key={`${group.kind}:${group.id}`}
                      data-index-group={group.kind}
                      data-index-group-state={group.state}
                      className="space-y-1"
                    >
                      <h4 className="font-semibold">
                        {group.kind === "book"
                          ? "全书目录"
                          : group.kind === "volume"
                            ? "实际卷归属"
                            : "规划故事弧"}{" "}
                        · {group.title} v{group.version}
                      </h4>
                      <p className="text-xs text-muted">
                        {group.coverage.chapterCount} 章目录 ·{" "}
                        {group.coverage.nonEmptyChapterCount} 章非空正文 ·{" "}
                        {group.coverage.currentSummaryChapterCount}{" "}
                        章有效派生摘要
                        {group.state === "unbound"
                          ? " · 尚未明确绑定"
                          : group.state === "stale"
                            ? " · 范围已失效，未计覆盖"
                            : " · 目录引用当前有效（不是语义通过）"}
                      </p>
                      {group.reasons.map((reason) => (
                        <p key={reason} className="text-xs text-muted">
                          {reason}
                        </p>
                      ))}
                      {group.state === "current" &&
                        group.chapterIds.map((id) => {
                          const chapter = catalog.data.chapters.find(
                            (entry) => entry.id === id,
                          );
                          return chapter ? (
                            <button
                              key={id}
                              type="button"
                              aria-label={`索引章节 ${chapter.title}`}
                              onClick={() => {
                                setChapterId(id);
                                setMemoryOpen(false);
                              }}
                              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface-muted"
                              data-index-selected={id === chapterId}
                            >
                              {chapter.title} · 正文版本 {chapter.version} ·{" "}
                              {summaryLabels[chapter.summaryState]}
                            </button>
                          ) : null;
                        })}
                    </div>
                  ))}
                  {!catalog.data.chapters.length && (
                    <p className="text-sm text-muted">
                      当前项目没有章节。小说来源索引是可选能力，不要求已有剧本或创意项目创建小说。
                    </p>
                  )}
                </div>
                <div
                  aria-label="章节来源详情"
                  className="min-w-0 space-y-3 rounded border border-line p-3"
                >
                  {!chapterId && (
                    <p className="text-sm text-muted">
                      请明确选择要查看的章节，不默认只取开头几章。
                    </p>
                  )}
                  {chapterId && !selected && (
                    <p role="alert" className="text-sm">
                      所选章节已不在当前目录，未自动改成另一章。
                    </p>
                  )}
                  {selected && !value && (
                    <p className="text-sm text-muted">
                      正在核对当前版本的来源详情；未计为已检查。
                    </p>
                  )}
                  {value && (
                    <>
                      <h4 className="font-semibold">
                        {value.chapter.title} · v{value.chapter.version}
                      </h4>
                      <p
                        data-index-summary-state={value.chapter.summaryState}
                        className="text-sm"
                      >
                        {summaryLabels[value.chapter.summaryState]} ·{" "}
                        {value.chapter.paragraphCount} 个原文段落 ·{" "}
                        {value.chapter.factCount} 条有效派生事实
                      </p>
                      <p className="text-xs text-muted">
                        正文预算估算 {value.chapter.originalEstimatedTokens} /
                        摘要文本估算 {value.chapter.summaryEstimatedTokens}{" "}
                        token；UTF-8 字节/4 估算，不是实际
                        usage，也不表示本轮模型已读。
                      </p>
                      {[...value.summaries, ...value.facts].map((item) => (
                        <article
                          key={item.id}
                          className="space-y-2 rounded border border-line p-3 text-sm"
                        >
                          <p className="whitespace-pre-wrap break-words">
                            {item.text}
                          </p>
                          <p className="break-all text-xs text-muted">
                            派生资料 {item.id} v{item.version} · 采用运行{" "}
                            {item.sourceWorkflowId}
                          </p>
                          <blockquote className="whitespace-pre-wrap break-words">
                            原文依据：{item.evidence.quote}
                          </blockquote>
                          <p className="text-xs text-muted">
                            逐字匹配 {item.evidence.matches.length}{" "}
                            处，不猜测唯一位置。位置是此正文版本的 UTF-16
                            字符偏移，结束位置不含在内。
                          </p>
                          {item.evidence.matches.map((match) => (
                            <details key={match.start} className="text-xs">
                              <summary>
                                原文位置 [{match.start}, {match.end})
                              </summary>
                              <p className="break-all">
                                段落引用：{match.paragraphIds.join("、")}
                              </p>
                            </details>
                          ))}
                        </article>
                      ))}
                      {value.excluded.length > 0 && (
                        <details>
                          <summary className="text-sm">
                            未纳入资料 {value.excluded.length} 条
                          </summary>
                          {value.excluded.map((item) => (
                            <p
                              key={item.id}
                              className="break-all text-xs text-muted"
                            >
                              {item.id} v{item.version} ·{" "}
                              {excludedLabels[item.reason]}
                            </p>
                          ))}
                        </details>
                      )}
                      <details>
                        <summary className="text-sm">
                          原文段落位置（版本绑定，不是跨版本语义映射）
                        </summary>
                        {value.paragraphs.map((paragraph) => (
                          <p
                            key={paragraph.id}
                            className="break-all text-xs text-muted"
                          >
                            {paragraph.id} · [{paragraph.start}, {paragraph.end}
                            )
                          </p>
                        ))}
                      </details>
                      {value.chapter.hasContent && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setMemoryOpen((current) => !current)}
                          >
                            审阅生成本章派生记忆
                          </Button>
                          {memoryOpen && (
                            <CreationWorkbench
                              key={`${value.chapter.id}@${value.chapter.version}`}
                              projectId={projectId}
                              operation="chapter-memory"
                              targetId={value.chapter.id}
                              baseVersion={value.chapter.version}
                              onApplied={refresh}
                              defaultInstruction="只提取当前正文明确支持的摘要、人物状态、事件和伏笔，提供逐字依据；不把未来规划当作事实。由作者审阅后明确采用，不改正文。"
                            />
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {catalog.data.unassignedRecords.length > 0 && (
                <details>
                  <summary className="text-sm">
                    无法归属当前章节的资料{" "}
                    {catalog.data.unassignedRecords.length} 条（未纳入覆盖）
                  </summary>
                  {catalog.data.unassignedRecords.map((item) => (
                    <p key={item.id} className="break-all text-xs text-muted">
                      {item.id} v{item.version} ·{" "}
                      {item.reason === "chapter-missing"
                        ? "关联章节已删除或不在当前作品"
                        : "未记录明确章节来源"}
                    </p>
                  ))}
                </details>
              )}
              <details className="rounded border border-line p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  明确故事弧的规划章节范围
                </summary>
                <p className="my-2 text-xs text-muted">
                  旧起止章号不会自动转换。明确选择当前章节后记录有序 ID
                  与版本；不改章节正文，也不把规划弧概括成正文事实。
                </p>
                <NativeSelect
                  aria-label="索引故事弧"
                  value={arcId}
                  onChange={(event) => {
                    setArcId(event.target.value);
                    setSelection([]);
                    setError(undefined);
                  }}
                  className="max-w-full w-auto text-sm"
                >
                  <option value="">请选择实际故事弧</option>
                  {catalog.data.groups
                    .filter((group) => group.kind === "story-arc")
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.title} · v{group.version}
                      </option>
                    ))}
                </NativeSelect>
                {arcId && (
                  <>
                    <fieldset className="my-3 max-h-60 overflow-auto rounded border border-line p-3">
                      <legend className="text-sm">
                        明确选择本次规划范围，不自动继承旧范围
                      </legend>
                      {catalog.data.chapters.map((chapter) => (
                        <label key={chapter.id} className="block text-sm">
                          <input
                            type="checkbox"
                            aria-label={`故事弧范围章节 ${chapter.title}`}
                            checked={selection.includes(chapter.id)}
                            onChange={(event) =>
                              setSelection((current) =>
                                event.target.checked
                                  ? [...current, chapter.id]
                                  : current.filter((id) => id !== chapter.id),
                              )
                            }
                          />{" "}
                          {chapter.title} v{chapter.version}
                        </label>
                      ))}
                    </fieldset>
                    <Button
                      size="sm"
                      disabled={
                        busy ||
                        !selection.length ||
                        Boolean(arc.error) ||
                        !arc.data ||
                        arc.data.version !== binding?.version
                      }
                      onClick={bindArc}
                    >
                      确认故事弧章节范围
                    </Button>
                  </>
                )}
              </details>
            </>
          )}
        </section>
      )}
    </details>
  );
}
