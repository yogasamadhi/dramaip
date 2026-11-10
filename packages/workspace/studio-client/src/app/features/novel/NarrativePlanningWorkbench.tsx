import { useEffect, useState } from "react";
import { useQuery } from "../../query";
import { Button } from "@dramaip/infra-ui-primitives";
import {
  NarrativePlanningRequestSchema,
  type NarrativeContextRequest,
  type NarrativePlanningOperation,
  type NarrativePlanningRequest,
} from "@dramaip/contracts/creation";
import { useStudio, message } from "../../studio-shared";
import {
  isPlanningRequestCurrent,
  planningDirectoryFingerprint,
  samePlanningRequest,
} from "../../narrative-planning-scope";
import { CreationWorkbench } from "../creation-workbench";
import { NovelContextPicker } from "./NovelContextPicker";
import styles from "./NarrativePlanningWorkbench.module.css";
import { copyText } from "../../copy";

/** Above this many chapters, original text is not preselected as the expression. */
const PRESELECT_ORIGINAL_LIMIT = 12;

const emptyContext = (): NarrativeContextRequest => ({
  format: "narrative-context-v1",
  chapters: [],
});

export function NarrativePlanningWorkbench(props: {
  projectId: string;
  operation: NarrativePlanningOperation;
  defaultInstruction?: string;
  onApplied?(): void | Promise<void>;
}) {
  return (
    <PlanningInstance
      key={`${props.projectId}:${props.operation}`}
      {...props}
    />
  );
}

function PlanningInstance(props: {
  projectId: string;
  operation: NarrativePlanningOperation;
  defaultInstruction?: string;
  onApplied?(): void | Promise<void>;
}) {
  const client = useStudio();
  const directory = useQuery({
    queryKey: ["narrative-planning-directory", props.projectId],
    queryFn: async () => {
      const chapters = (await client.chapters.list(props.projectId)).sort(
        (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
      );
      return {
        chapters,
        fingerprint: await planningDirectoryFingerprint(chapters),
      };
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const chapters = directory.data?.chapters ?? [];
  const [scope, setScope] =
    useState<NarrativePlanningRequest["chapterScope"]>();
  const [context, setContext] = useState(emptyContext);
  const [confirmed, setConfirmed] = useState<NarrativePlanningRequest>();
  const parsed = scope
    ? NarrativePlanningRequestSchema.safeParse({
        format: "narrative-planning-v1",
        chapterScope: scope,
        context,
      })
    : undefined;
  const draft = parsed?.success ? parsed.data : undefined;
  const current = isPlanningRequestCurrent(
    draft,
    chapters,
    directory.data?.fingerprint,
  );
  const higher = useQuery({
    queryKey: [
      "narrative-planning-summary-coverage",
      props.projectId,
      context.summaries,
    ],
    queryFn: () =>
      Promise.all(
        (context.summaries ?? []).map((ref) =>
          client.narrativeSummaries.get(props.projectId, ref.id),
        ),
      ),
    enabled: Boolean(context.summaries?.length),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  // Only actual owner reads can establish higher-summary coverage. The Runtime
  // checks all expressions, hashes, adoption heads, privacy and budget again.
  const validHigher = (context.summaries ?? []).every((ref) => {
    const summary = higher.data?.find((value) => value.id === ref.id);
    return (
      summary?.version === ref.version &&
      summary.contextEligibility.state === "eligible" &&
      summary.content.coveredChapters.every((chapter) =>
        scope?.chapters.some(
          (item) => item.id === chapter.id && item.version === chapter.version,
        ),
      )
    );
  });
  const complete = Boolean(
    draft &&
    scope?.chapters.every(
      (chapter) =>
        context.chapters.some(
          (item) => item.id === chapter.id && item.version === chapter.version,
        ) ||
        higher.data?.some(
          (summary) =>
            context.summaries?.some(
              (ref) => ref.id === summary.id && ref.version === summary.version,
            ) &&
            summary.content.coveredChapters.some(
              (item) =>
                item.id === chapter.id && item.version === chapter.version,
            ),
        ),
    ),
  );
  const ready =
    !directory.error &&
    Boolean(directory.data) &&
    current &&
    complete &&
    validHigher &&
    (!context.summaries?.length || (!higher.error && Boolean(higher.data)));
  const unchanged = samePlanningRequest(draft, confirmed);
  const hasBody = chapters.some((chapter) => chapter.content.trim());
  const [autoNone, setAutoNone] = useState(false);
  const [preselected, setPreselected] = useState(false);
  // Preselect the recommended scope once the directory is read. Without saved
  // chapter text there is nothing to choose, so "none" is also confirmed. With
  // text, all non-empty chapters are preselected (as original text when the
  // book is short) but still need one explicit confirmation before use.
  useEffect(() => {
    if (!directory.data || directory.error || scope !== undefined) return;
    const filled = directory.data.chapters.filter((chapter) =>
      chapter.content.trim(),
    );
    if (!filled.length) {
      setScope({ mode: "none", chapters: [] });
      setAutoNone(true);
      return;
    }
    setScope({
      mode: "full",
      directoryFingerprint: directory.data.fingerprint,
      chapters: filled.map(({ id, version }) => ({ id, version })),
    });
    if (filled.length <= PRESELECT_ORIGINAL_LIMIT)
      setContext({
        format: "narrative-context-v1",
        chapters: filled.map(({ id, version }) => ({
          id,
          version,
          representation: "original",
        })),
      });
    setPreselected(true);
  }, [directory.data, directory.error, scope]);
  useEffect(() => {
    if (autoNone && ready && draft && !confirmed) {
      setConfirmed(draft);
      setAutoNone(false);
    }
  }, [autoNone, ready, draft, confirmed]);
  const changeScope = (value: NarrativePlanningRequest["chapterScope"]) => {
    setPreselected(false);
    setScope(value);
    setContext(emptyContext());
    setConfirmed(undefined);
  };
  return (
    <div className={styles.c1}>
      <section
        aria-label={copyText("app/features/novel/NarrativePlanningWorkbench.1")}
        className={styles.c2}
      >
        <h3 className={styles.c3}>
          {copyText("app/features/novel/NarrativePlanningWorkbench.1")}
        </h3>
        <p className={styles.c4}>
          {hasBody
            ? "已按推荐预选全部有正文的章节；确认后才会使用。没选的正文、旧摘要和旧方案不会自动带入。"
            : "还没有正文，本轮只依据项目简报与作者意图规划。"}
        </p>
        {directory.error && (
          <p role="alert">
            {copyText("app/features/novel/NarrativePlanningWorkbench.2")}
            {message(directory.error)}
            {copyText("app/features/novel/NarrativePlanningWorkbench.3")}
          </p>
        )}
        {!directory.data && !directory.error && (
          <p role="status">
            {copyText("app/features/novel/NarrativePlanningWorkbench.4")}
          </p>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void directory.refetch()}
        >
          {copyText("app/features/novel/NarrativePlanningWorkbench.5")}
        </Button>
        <fieldset
          className={styles.c5}
          disabled={!directory.data || Boolean(directory.error)}
        >
          <legend className={styles.c6}>
            {copyText("app/features/novel/NarrativePlanningWorkbench.6")}
          </legend>
          <label className={styles.c7}>
            <input
              type="radio"
              name={`planning-scope-${props.operation}`}
              checked={scope?.mode === "none"}
              onChange={() => changeScope({ mode: "none", chapters: [] })}
            />{" "}
            {copyText("app/features/novel/NarrativePlanningWorkbench.7")}
          </label>
          <label className={styles.c7}>
            <input
              type="radio"
              name={`planning-scope-${props.operation}`}
              checked={scope?.mode === "selection"}
              onChange={() => changeScope({ mode: "selection", chapters: [] })}
            />{" "}
            {copyText("app/features/novel/NarrativePlanningWorkbench.8")}
          </label>
          <label className={styles.c7}>
            <input
              type="radio"
              name={`planning-scope-${props.operation}`}
              checked={scope?.mode === "full"}
              disabled={!chapters.some((chapter) => chapter.content.trim())}
              onChange={() =>
                changeScope({
                  mode: "full",
                  directoryFingerprint: directory.data!.fingerprint,
                  chapters: chapters
                    .filter((chapter) => chapter.content.trim())
                    .map(({ id, version }) => ({ id, version })),
                })
              }
            />{" "}
            {copyText("app/features/novel/NarrativePlanningWorkbench.9")}
          </label>
        </fieldset>
        {scope?.mode === "selection" && (
          <fieldset
            className={styles.c8}
            disabled={!directory.data || Boolean(directory.error)}
          >
            <legend>
              {copyText("app/features/novel/NarrativePlanningWorkbench.10")}
            </legend>
            {chapters.map((chapter) => (
              <label key={chapter.id} className={styles.c7}>
                <input
                  type="checkbox"
                  aria-label={copyText(
                    "app/features/novel/NarrativePlanningWorkbench.16",
                    { p1: chapter.title },
                  )}
                  disabled={!chapter.content.trim()}
                  checked={scope.chapters.some(
                    (item) => item.id === chapter.id,
                  )}
                  onChange={(event) =>
                    changeScope({
                      mode: "selection",
                      chapters: chapters.flatMap((item) =>
                        item.id === chapter.id
                          ? event.target.checked
                            ? [{ id: item.id, version: item.version }]
                            : []
                          : scope.chapters.filter((ref) => ref.id === item.id),
                      ),
                    })
                  }
                />{" "}
                {chapter.title}
                {copyText("app/features/novel/NarrativePlanningWorkbench.11")}
                {chapter.version}
                {!chapter.content.trim() ? "（空章，不算已读）" : ""}
              </label>
            ))}
          </fieldset>
        )}
        {scope && scope.mode !== "none" && (
          <NovelContextPicker
            scope={{ projectId: props.projectId, title: "规划来源表达" }}
            purpose="planning"
            chapters={chapters.filter((chapter) =>
              scope.chapters.some(
                (ref) =>
                  ref.id === chapter.id && ref.version === chapter.version,
              ),
            )}
            request={context}
            disabled={!directory.data || Boolean(directory.error)}
            onChange={(value) => {
              setContext(value);
              setConfirmed(undefined);
            }}
          />
        )}
        {higher.error && context.summaries?.length ? (
          <p role="alert">
            {copyText("app/features/novel/NarrativePlanningWorkbench.12")}
            {message(higher.error)}
          </p>
        ) : null}
        {scope && !current && (
          <p role="status">
            {copyText("app/features/novel/NarrativePlanningWorkbench.13")}
          </p>
        )}
        {scope && current && !complete && (
          <p role="status">
            {copyText("app/features/novel/NarrativePlanningWorkbench.14")}
          </p>
        )}
        {preselected && !confirmed && (
          <p className={styles.c4}>
            {context.chapters.length
              ? `推荐：参考全部 ${scope?.chapters.length ?? 0} 章原文。可直接确认，或改选范围与表达。`
              : `推荐：参考全部 ${scope?.chapters.length ?? 0} 章。章节较多，请在“规划来源表达”中为每章选择原文、摘要或段落。`}
          </p>
        )}
        <Button size="sm" disabled={!ready} onClick={() => setConfirmed(draft)}>
          {copyText("app/features/novel/NarrativePlanningWorkbench.15")}
        </Button>
        <p role="status" data-planning-confirmed={Boolean(ready && unchanged)}>
          {ready && unchanged
            ? `本轮已明确确认：${scope?.mode === "none" ? "不使用正文" : `${scope?.chapters.length} 章的明确表达`}。生成前仍核对完整来源、隐私与完整提示预算。`
            : "尚未确认当前选择，不能启动新规划；已有运行可按原冻结输入查看、重试或处理。"}
        </p>
      </section>
      <CreationWorkbench
        {...props}
        narrativePlanningRequired
        narrativePlanningRequest={confirmed}
        startDisabled={!ready || !unchanged}
      />
    </div>
  );
}
