import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@dramaip/ui-shared";
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
    <div className="space-y-3">
      <details
        aria-label="本轮制作来源选择"
        className="rounded border border-line p-3 text-sm"
        open={editing}
        onToggle={(event) => {
          if (event.currentTarget.open && !editing) setEditing(true);
        }}
      >
        <summary className="cursor-pointer font-medium">
          明确选择原著表达（兼容操作，不默认读取正文）
        </summary>
        <p className="mt-2 text-muted">
          未打开时保留原兼容输入的 {props.legacySourceIds?.length ?? 0}{" "}
          个整章选择，不自动补入原著。打开后须明确确认本轮来源，或明确取消回到原兼容选择。更改来源不会删除／采用旧候选；旧运行仍可从任务中心按原请求查看。确认不是隐私、预算或文学质量通过。
        </p>
        <fieldset disabled={props.disabled} className="mt-3 space-y-2">
          <legend>本轮制作来源范围</legend>
          <label className="block">
            <input
              type="radio"
              name={name}
              checked={scope?.mode === "none"}
              onChange={() => changeScope({ mode: "none", chapters: [] })}
            />{" "}
            明确不使用正文、段落或摘要；不读取正文目录
          </label>
          <label className="block">
            <input
              type="radio"
              name={name}
              checked={scope?.mode === "selection"}
              onChange={() => changeScope({ mode: "selection", chapters: [] })}
            />{" "}
            明确选择局部章节范围
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setReadDirectory(true);
              void directory.refetch();
            }}
          >
            读取实际正文目录
          </Button>
          <label className="block">
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
            当前全部非空正文目录（须先读取，不表示全文或全书质量通过）
          </label>
        </fieldset>
        {directory.error && (
          <p role="alert">
            正文目录未核全：{message(directory.error)}
            ；不使用正文的选择不依赖该目录，其他范围不能确认。
          </p>
        )}
        {scope?.mode === "selection" && (
          <fieldset
            disabled={props.disabled || !directory.data || directory.isFetching}
            className="mt-3 space-y-1"
          >
            <legend>实际章节范围；表达另行选择</legend>
            {chapters.map((chapter) => (
              <label key={chapter.id} className="block">
                <input
                  type="checkbox"
                  aria-label={`制作范围 ${chapter.title}`}
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
                {chapter.title} v{chapter.version}
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
            所选段落／章摘要未核全：{message(expressions.error)}
            ；保留原选择，不用缓存确认。
          </p>
        )}
        {higher.error && (
          <p role="alert">
            高层摘要未核全：{message(higher.error)}；保留原选择，不用缓存确认。
          </p>
        )}
        {storageError && <p role="alert">{storageError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={props.disabled || !ready}
            onClick={confirm}
          >
            确认本轮制作范围与表达
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.disabled}
            onClick={cancel}
          >
            取消选择，保留原兼容来源
          </Button>
        </div>
        <p
          role="status"
          className="mt-2"
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
