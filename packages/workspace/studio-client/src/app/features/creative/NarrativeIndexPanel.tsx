import { useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  NarrativeArcScopeSchema,
  type NarrativeIndexDetail,
} from "@dramaip/contracts/knowledge";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { WritingVolumesPanel } from "../novel/WritingVolumesPanel";
import { NarrativeStorySources } from "./NarrativeStorySources";
import styles from "./NarrativeIndexPanel.module.css";
import { copyText } from "../../copy";

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
      className={styles.c1}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.c2}>
        {copyText("app/features/creative/NarrativeIndexPanel.1")}
      </summary>
      {open && (
        <section
          aria-label={copyText("app/features/creative/NarrativeIndexPanel.1")}
          className={styles.c3}
        >
          <p className={styles.c4}>
            {copyText("app/features/creative/NarrativeIndexPanel.2")}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            {copyText("app/features/creative/NarrativeIndexPanel.3")}
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
            <p role="alert" className={styles.c5}>
              {error ?? message(catalog.error ?? detail.error ?? arc.error)}
            </p>
          )}
          {catalog.isPending && (
            <p className={styles.c4}>
              {copyText("app/features/creative/NarrativeIndexPanel.4")}
            </p>
          )}
          {!catalog.error && catalog.data && (
            <>
              {catalog.data.unavailable.map((item) => (
                <p key={item} role="alert" className={styles.c4}>
                  {item}
                </p>
              ))}
              <p className={styles.c6}>
                {copyText("app/features/creative/NarrativeIndexPanel.5")}
                {catalog.data.projectVersion}
                {copyText("app/features/creative/NarrativeIndexPanel.6")}{" "}
                {catalog.data.fingerprint}
              </p>
              <div className={styles.c7}>
                <div
                  aria-label={copyText(
                    "app/features/creative/NarrativeIndexPanel.7",
                  )}
                  className={styles.c8}
                >
                  {catalog.data.groups.map((group) => (
                    <div
                      key={`${group.kind}:${group.id}`}
                      data-index-group={group.kind}
                      data-index-group-state={group.state}
                      className={styles.c9}
                    >
                      <h4 className={styles.c10}>
                        {group.kind === "book"
                          ? "全书目录"
                          : group.kind === "volume"
                            ? "实际卷归属"
                            : "规划故事弧"}{" "}
                        · {group.title}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.8",
                        )}
                        {group.version}
                      </h4>
                      <p className={styles.c11}>
                        {group.coverage.chapterCount}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.9",
                        )}{" "}
                        {group.coverage.nonEmptyChapterCount}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.10",
                        )}{" "}
                        {group.coverage.currentSummaryChapterCount}{" "}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.11",
                        )}
                        {group.state === "unbound"
                          ? " · 尚未明确绑定"
                          : group.state === "stale"
                            ? " · 范围已失效，未计覆盖"
                            : " · 目录引用当前有效（不是语义通过）"}
                      </p>
                      {group.reasons.map((reason) => (
                        <p key={reason} className={styles.c11}>
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
                              aria-label={copyText(
                                "app/features/creative/NarrativeIndexPanel.43",
                                { p1: chapter.title },
                              )}
                              onClick={() => {
                                setChapterId(id);
                                setMemoryOpen(false);
                              }}
                              className={styles.c12}
                              data-index-selected={id === chapterId}
                            >
                              {chapter.title}
                              {copyText(
                                "app/features/creative/NarrativeIndexPanel.12",
                              )}
                              {chapter.version} ·{" "}
                              {summaryLabels[chapter.summaryState]}
                            </button>
                          ) : null;
                        })}
                    </div>
                  ))}
                  {!catalog.data.chapters.length && (
                    <p className={styles.c4}>
                      {copyText("app/features/creative/NarrativeIndexPanel.13")}
                    </p>
                  )}
                </div>
                <div
                  aria-label={copyText(
                    "app/features/creative/NarrativeIndexPanel.14",
                  )}
                  className={styles.c13}
                >
                  {!chapterId && (
                    <p className={styles.c4}>
                      {copyText("app/features/creative/NarrativeIndexPanel.15")}
                    </p>
                  )}
                  {chapterId && !selected && (
                    <p role="alert" className={styles.c14}>
                      {copyText("app/features/creative/NarrativeIndexPanel.16")}
                    </p>
                  )}
                  {selected && !value && (
                    <p className={styles.c4}>
                      {copyText("app/features/creative/NarrativeIndexPanel.17")}
                    </p>
                  )}
                  {value && (
                    <>
                      <h4 className={styles.c10}>
                        {value.chapter.title}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.18",
                        )}
                        {value.chapter.version}
                      </h4>
                      <p
                        data-index-summary-state={value.chapter.summaryState}
                        className={styles.c14}
                      >
                        {summaryLabels[value.chapter.summaryState]} ·{" "}
                        {value.chapter.paragraphCount}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.19",
                        )}{" "}
                        {value.chapter.factCount}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.20",
                        )}
                      </p>
                      <p className={styles.c11}>
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.21",
                        )}
                        {value.chapter.originalEstimatedTokens}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.22",
                        )}
                        {value.chapter.summaryEstimatedTokens}{" "}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.23",
                        )}
                      </p>
                      {[...value.summaries, ...value.facts].map((item) => (
                        <article key={item.id} className={styles.c15}>
                          <p className={styles.c16}>{item.text}</p>
                          <p className={styles.c6}>
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.24",
                            )}
                            {item.id}
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.8",
                            )}
                            {item.version}
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.25",
                            )}{" "}
                            {item.sourceWorkflowId}
                          </p>
                          <blockquote className={styles.c16}>
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.26",
                            )}
                            {item.evidence.quote}
                          </blockquote>
                          <p className={styles.c11}>
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.27",
                            )}
                            {item.evidence.matches.length}{" "}
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.28",
                            )}
                          </p>
                          {item.evidence.matches.map((match) => (
                            <details key={match.start} className={styles.c17}>
                              <summary>
                                {copyText(
                                  "app/features/creative/NarrativeIndexPanel.29",
                                )}
                                {match.start}, {match.end})
                              </summary>
                              <p className={styles.c18}>
                                {copyText(
                                  "app/features/creative/NarrativeIndexPanel.30",
                                )}
                                {match.paragraphIds.join("、")}
                              </p>
                            </details>
                          ))}
                        </article>
                      ))}
                      {value.excluded.length > 0 && (
                        <details>
                          <summary className={styles.c14}>
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.31",
                            )}
                            {value.excluded.length}
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.32",
                            )}
                          </summary>
                          {value.excluded.map((item) => (
                            <p key={item.id} className={styles.c6}>
                              {item.id}
                              {copyText(
                                "app/features/creative/NarrativeIndexPanel.8",
                              )}
                              {item.version} · {excludedLabels[item.reason]}
                            </p>
                          ))}
                        </details>
                      )}
                      <details>
                        <summary className={styles.c14}>
                          {copyText(
                            "app/features/creative/NarrativeIndexPanel.33",
                          )}
                        </summary>
                        {value.paragraphs.map((paragraph) => (
                          <p key={paragraph.id} className={styles.c6}>
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
                            {copyText(
                              "app/features/creative/NarrativeIndexPanel.34",
                            )}
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
                  <summary className={styles.c14}>
                    {copyText("app/features/creative/NarrativeIndexPanel.35")}{" "}
                    {catalog.data.unassignedRecords.length}
                    {copyText("app/features/creative/NarrativeIndexPanel.36")}
                  </summary>
                  {catalog.data.unassignedRecords.map((item) => (
                    <p key={item.id} className={styles.c6}>
                      {item.id}
                      {copyText("app/features/creative/NarrativeIndexPanel.8")}
                      {item.version} ·{" "}
                      {item.reason === "chapter-missing"
                        ? "关联章节已删除或不在当前作品"
                        : "未记录明确章节来源"}
                    </p>
                  ))}
                </details>
              )}
              <details className={styles.c19}>
                <summary className={styles.c20}>
                  {copyText("app/features/creative/NarrativeIndexPanel.37")}
                </summary>
                <p className={styles.c21}>
                  {copyText("app/features/creative/NarrativeIndexPanel.38")}
                </p>
                <NativeSelect
                  aria-label={copyText(
                    "app/features/creative/NarrativeIndexPanel.39",
                  )}
                  value={arcId}
                  onChange={(event) => {
                    setArcId(event.target.value);
                    setSelection([]);
                    setError(undefined);
                  }}
                  className={styles.c22}
                >
                  <option value="">
                    {copyText("app/features/creative/NarrativeIndexPanel.40")}
                  </option>
                  {catalog.data.groups
                    .filter((group) => group.kind === "story-arc")
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.title}
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.18",
                        )}
                        {group.version}
                      </option>
                    ))}
                </NativeSelect>
                {arcId && (
                  <>
                    <fieldset className={styles.c23}>
                      <legend className={styles.c14}>
                        {copyText(
                          "app/features/creative/NarrativeIndexPanel.41",
                        )}
                      </legend>
                      {catalog.data.chapters.map((chapter) => (
                        <label key={chapter.id} className={styles.c24}>
                          <input
                            type="checkbox"
                            aria-label={copyText(
                              "app/features/creative/NarrativeIndexPanel.44",
                              { p1: chapter.title },
                            )}
                            checked={selection.includes(chapter.id)}
                            onChange={(event) =>
                              setSelection((current) =>
                                event.target.checked
                                  ? [...current, chapter.id]
                                  : current.filter((id) => id !== chapter.id),
                              )
                            }
                          />{" "}
                          {chapter.title}
                          {copyText(
                            "app/features/creative/NarrativeIndexPanel.8",
                          )}
                          {chapter.version}
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
                      {copyText("app/features/creative/NarrativeIndexPanel.42")}
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
