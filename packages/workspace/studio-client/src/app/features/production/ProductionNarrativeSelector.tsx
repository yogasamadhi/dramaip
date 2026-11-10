import { useId, useState, type ReactNode } from "react";
import { useQuery } from "../../query";
import { Button } from "@dramaip/infra-ui-primitives";
import {
  ProductionNarrativeRequestSchema,
  type ProductionNarrativeRequest,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import { ChapterSchema } from "@dramaip/contracts/writing";
import {
  NarrativeIndexDetailSchema,
  NarrativeSummarySchema,
} from "@dramaip/contracts/knowledge";
import {
  CURRENT_OWNER_READ_OPTIONS,
  currentOwnerQuery,
} from "../../current-owner-read";
import {
  isProductionNarrativeRequestCurrent,
  sameProductionNarrativeRequest,
} from "../../production-narrative-scope";
import { planningDirectoryFingerprint } from "../../narrative-planning-scope";
import { NovelContextPicker } from "../novel/NovelContextPicker";
import { useStudio, message } from "../../studio-shared";
import styles from "./ProductionNarrativeSelector.module.css";
import { copyText } from "../../copy";

const empty = (): NarrativeContextRequest => ({
  format: "narrative-context-v1",
  chapters: [],
});

/** Optional new-request selector. Exact historical RunCards bypass this editor. */
export function ProductionNarrativeSelector(props: {
  projectId: string;
  storageKey: string;
  legacySourceIds?: string[];
  disabled?: boolean;
  children(selection: {
    request?: ProductionNarrativeRequest;
    startDisabled: boolean;
  }): ReactNode;
}) {
  const client = useStudio(),
    name = useId();
  const [stored] = useState(
    (): { request?: ProductionNarrativeRequest; error?: string } => {
      try {
        const raw = window.localStorage.getItem(props.storageKey);
        return raw === null
          ? {}
          : {
              request: ProductionNarrativeRequestSchema.parse(JSON.parse(raw)),
            };
      } catch {
        return {
          error:
            "原制作来源选择无法读取或格式损坏，未改用兼容来源；请明确重新确认或取消。",
        };
      }
    },
  );
  const [storageError, setStorageError] = useState(stored.error);
  const [editing, setEditing] = useState(
      Boolean(stored.request || stored.error),
    ),
    [readDirectory, setReadDirectory] = useState(false);
  const [scope, setScope] = useState<
    ProductionNarrativeRequest["chapterScope"] | undefined
  >(stored.request?.chapterScope);
  const [context, setContext] = useState(
    () => stored.request?.context ?? empty(),
  );
  const [confirmed, setConfirmed] = useState<
    ProductionNarrativeRequest | undefined
  >(stored.request);
  const directory = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["production-narrative-directory", props.projectId],
      enabled:
        editing && (readDirectory || Boolean(scope && scope.mode !== "none")),
      refetchInterval: editing && scope?.mode !== "none" ? 5000 : false,
      queryFn: async () => {
        const chapters = (await client.chapters.list(props.projectId)).map(
          (value) => ChapterSchema.parse(value),
        );
        if (
          chapters.some((chapter) => chapter.projectId !== props.projectId) ||
          new Set(chapters.map((chapter) => chapter.id)).size !==
            chapters.length
        )
          throw new Error("实际正文目录的项目或唯一身份无法核对。");
        chapters.sort(
          (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
        );
        return {
          chapters,
          fingerprint: await planningDirectoryFingerprint(chapters),
        };
      },
    }),
  );
  const chapters = directory.data?.chapters ?? [];
  const needsIndex = context.chapters.filter(
    (item) => item.representation !== "original",
  );
  const expressions = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: [
        "production-narrative-expressions",
        props.projectId,
        needsIndex,
      ],
      enabled: editing && Boolean(needsIndex.length),
      refetchInterval: 5000,
      queryFn: () =>
        Promise.all(
          needsIndex.map(async (ref) => {
            const value = NarrativeIndexDetailSchema.parse(
              await client.narrativeIndex.chapter(props.projectId, ref.id),
            );
            if (
              value.projectId !== props.projectId ||
              value.chapter.id !== ref.id ||
              value.chapter.version !== ref.version
            )
              throw new Error("所选摘要／段落的实际项目、章节或版本无法核对。");
            return value;
          }),
        ),
    }),
  );
  const higher = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: [
        "production-narrative-higher",
        props.projectId,
        context.summaries,
      ],
      enabled: editing && Boolean(context.summaries?.length),
      refetchInterval: 5000,
      queryFn: () =>
        Promise.all(
          (context.summaries ?? []).map(async (ref) => {
            const value = NarrativeSummarySchema.parse(
              await client.narrativeSummaries.get(props.projectId, ref.id),
            );
            if (
              value.projectId !== props.projectId ||
              value.id !== ref.id ||
              value.version !== ref.version
            )
              throw new Error("所选高层摘要的实际身份或版本无法核对。");
            return value;
          }),
        ),
    }),
  );
  const parsed = scope
    ? ProductionNarrativeRequestSchema.safeParse({
        format: "production-narrative-v1",
        chapterScope: scope,
        context,
      })
    : undefined;
  const draft = parsed?.success ? parsed.data : undefined;
  const indexCurrent = needsIndex.every((ref) => {
    const value = expressions.data?.find(
      (item) =>
        item.chapter.id === ref.id && item.chapter.version === ref.version,
    );
    return ref.representation === "summary"
      ? Boolean(
          value?.summaries.some(
            (summary) =>
              summary.id === ref.record.id &&
              summary.version === ref.record.version,
          ),
        )
      : ref.representation === "paragraphs" &&
          ref.paragraphIds.every((id) =>
            value?.paragraphs.some((paragraph) => paragraph.id === id),
          );
  });
  const higherCurrent = (context.summaries ?? []).every((ref) => {
    const value = higher.data?.find(
      (item) => item.id === ref.id && item.version === ref.version,
    );
    return (
      value?.contextEligibility.state === "eligible" &&
      value.content.coveredChapters.every((chapter) =>
        scope?.chapters.some(
          (item) => item.id === chapter.id && item.version === chapter.version,
        ),
      )
    );
  });
  const complete = Boolean(
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
    Boolean(
      draft &&
      (scope?.mode === "none" ||
        (directory.data && !directory.error && !directory.isFetching)),
    ) &&
    isProductionNarrativeRequestCurrent(
      draft,
      chapters,
      directory.data?.fingerprint,
    ) &&
    complete &&
    indexCurrent &&
    higherCurrent &&
    (!needsIndex.length ||
      Boolean(
        expressions.data && !expressions.error && !expressions.isFetching,
      )) &&
    (!context.summaries?.length ||
      Boolean(higher.data && !higher.error && !higher.isFetching));
  const unchanged = sameProductionNarrativeRequest(draft, confirmed);
  const changeScope = (value: ProductionNarrativeRequest["chapterScope"]) => {
    setScope(value);
    setContext(empty());
    setConfirmed(undefined);
  };
  const confirm = () => {
    if (!ready || !draft) return;
    try {
      window.localStorage.setItem(props.storageKey, JSON.stringify(draft));
      setStorageError(undefined);
      setConfirmed(draft);
    } catch {
      setStorageError(
        "本机未能保存原制作来源选择，尚未确认；不会丢失选择后换源生成。",
      );
    }
  };
  const cancel = () => {
    try {
      window.localStorage.removeItem(props.storageKey);
    } catch {
      setStorageError("本机未能取消原选择，保留原请求；不会切回兼容来源。");
      return;
    }
    setStorageError(undefined);
    setEditing(false);
    setReadDirectory(false);
    setScope(undefined);
    setContext(empty());
    setConfirmed(undefined);
  };
  return (
    <div className={styles.c1}>
      <details
        aria-label={copyText(
          "app/features/production/ProductionNarrativeSelector.1",
        )}
        className={styles.c2}
        open={editing}
        onToggle={(event) => {
          if (event.currentTarget.open && !editing) setEditing(true);
        }}
      >
        <summary className={styles.c3}>
          {copyText("app/features/production/ProductionNarrativeSelector.2")}
        </summary>
        <p className={styles.c4}>
          {copyText("app/features/production/ProductionNarrativeSelector.3")}
          {props.legacySourceIds?.length ?? 0}{" "}
          {copyText("app/features/production/ProductionNarrativeSelector.4")}
        </p>
        <fieldset disabled={props.disabled} className={styles.c5}>
          <legend>
            {copyText("app/features/production/ProductionNarrativeSelector.5")}
          </legend>
          <label className={styles.c6}>
            <input
              type="radio"
              name={name}
              checked={scope?.mode === "none"}
              onChange={() => changeScope({ mode: "none", chapters: [] })}
            />{" "}
            {copyText("app/features/production/ProductionNarrativeSelector.6")}
          </label>
          <label className={styles.c6}>
            <input
              type="radio"
              name={name}
              checked={scope?.mode === "selection"}
              onChange={() => changeScope({ mode: "selection", chapters: [] })}
            />{" "}
            {copyText("app/features/production/ProductionNarrativeSelector.7")}
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setReadDirectory(true);
              void directory.refetch();
            }}
          >
            {copyText("app/features/production/ProductionNarrativeSelector.8")}
          </Button>
          <label className={styles.c6}>
            <input
              type="radio"
              name={name}
              checked={scope?.mode === "full"}
              disabled={
                !directory.data ||
                directory.isFetching ||
                !chapters.some((chapter) => chapter.content.trim())
              }
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
            {copyText("app/features/production/ProductionNarrativeSelector.9")}
          </label>
        </fieldset>
        {directory.error && (
          <p role="alert">
            {copyText("app/features/production/ProductionNarrativeSelector.10")}
            {message(directory.error)}
            {copyText("app/features/production/ProductionNarrativeSelector.11")}
          </p>
        )}
        {scope?.mode === "selection" && (
          <fieldset
            disabled={props.disabled || !directory.data || directory.isFetching}
            className={styles.c7}
          >
            <legend>
              {copyText(
                "app/features/production/ProductionNarrativeSelector.12",
              )}
            </legend>
            {chapters.map((chapter) => (
              <label key={chapter.id} className={styles.c6}>
                <input
                  type="checkbox"
                  aria-label={copyText(
                    "app/features/production/ProductionNarrativeSelector.19",
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
                {copyText(
                  "app/features/production/ProductionNarrativeSelector.13",
                )}
                {chapter.version}
                {!chapter.content.trim() ? "（空章）" : ""}
              </label>
            ))}
          </fieldset>
        )}
        {scope && scope.mode !== "none" && (
          <NovelContextPicker
            scope={{ projectId: props.projectId, title: "制作来源表达" }}
            purpose="production"
            chapters={chapters.filter((chapter) =>
              scope.chapters.some(
                (ref) =>
                  ref.id === chapter.id && ref.version === chapter.version,
              ),
            )}
            request={context}
            disabled={Boolean(
              props.disabled ||
              !directory.data ||
              directory.error ||
              directory.isFetching,
            )}
            onChange={(value) => {
              setContext(value);
              setConfirmed(undefined);
            }}
          />
        )}
        {expressions.error && (
          <p role="alert">
            {copyText("app/features/production/ProductionNarrativeSelector.14")}
            {message(expressions.error)}
            {copyText("app/features/production/ProductionNarrativeSelector.15")}
          </p>
        )}
        {higher.error && (
          <p role="alert">
            {copyText("app/features/production/ProductionNarrativeSelector.16")}
            {message(higher.error)}
            {copyText("app/features/production/ProductionNarrativeSelector.15")}
          </p>
        )}
        {storageError && <p role="alert">{storageError}</p>}
        <div className={styles.c8}>
          <Button
            size="sm"
            disabled={props.disabled || !ready}
            onClick={confirm}
          >
            {copyText("app/features/production/ProductionNarrativeSelector.17")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.disabled}
            onClick={cancel}
          >
            {copyText("app/features/production/ProductionNarrativeSelector.18")}
          </Button>
        </div>
        <p
          role="status"
          className={styles.c9}
          data-production-confirmed={Boolean(ready && unchanged)}
        >
          {ready && unchanged
            ? "已明确确认本轮制作来源；生成前仍核完整表达、隐私和完整提示预算。"
            : "尚未确认当前选择，不能按此新范围生成；不补正文、不换旧摘要。"}
        </p>
      </details>
      {props.children({
        request: confirmed,
        startDisabled:
          editing && (!ready || !unchanged || Boolean(storageError)),
      })}
    </div>
  );
}
