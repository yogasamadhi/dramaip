import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@dramaip/ui-shared";
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
  const changeScope = (value: NarrativePlanningRequest["chapterScope"]) => {
    setScope(value);
    setContext(emptyContext());
    setConfirmed(undefined);
  };
  return (
    <div className="space-y-3">
      <section
        aria-label="本轮规划来源确认"
        className="space-y-3 rounded border border-line p-4 text-sm"
      >
        <h3 className="font-semibold">本轮规划来源确认</h3>
        <p className="text-muted">
          规划独立于章节写作，不新建空章。明确选择不使用正文、局部或完整范围，再选择实际表达；
          未选正文、旧摘要、历史记忆和旧方案不会自动附加。项目简报与正式作者意图会在启动时冻结。
          更改范围会清空本轮表达选择，请重新确认；这里的确认不是隐私、预算或文学质量通过。
        </p>
        {directory.error && (
          <p role="alert">
            规划正文目录尚未核全：{message(directory.error)}；暂不启动新规划。
          </p>
        )}
        {!directory.data && !directory.error && (
          <p role="status">正在读取实际正文目录…</p>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void directory.refetch()}
        >
          重新读取规划来源目录
        </Button>
        <fieldset
          className="space-y-2"
          disabled={!directory.data || Boolean(directory.error)}
        >
          <legend className="font-medium">
            明确选择规划范围（不会默认纳入正文）
          </legend>
          <label className="block">
            <input
              type="radio"
              name={`planning-scope-${props.operation}`}
              checked={scope?.mode === "none"}
              onChange={() => changeScope({ mode: "none", chapters: [] })}
            />{" "}
            明确不使用正文，仅依据简报与正式作者意图规划
          </label>
          <label className="block">
            <input
              type="radio"
              name={`planning-scope-${props.operation}`}
              checked={scope?.mode === "selection"}
              onChange={() => changeScope({ mode: "selection", chapters: [] })}
            />{" "}
            明确局部章节范围
          </label>
          <label className="block">
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
            当前全部非空正文目录（不代表全文表达或全书质量通过）
          </label>
        </fieldset>
        {scope?.mode === "selection" && (
          <fieldset
            className="space-y-1"
            disabled={!directory.data || Boolean(directory.error)}
          >
            <legend>实际章节范围；表达另行选择</legend>
            {chapters.map((chapter) => (
              <label key={chapter.id} className="block">
                <input
                  type="checkbox"
                  aria-label={`规划范围 ${chapter.title}`}
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
          <p role="alert">规划摘要覆盖未核全：{message(higher.error)}</p>
        ) : null}
        {scope && !current && (
          <p role="status">
            范围尚未完整选择或实际目录／章节版本已变化，请重新选择。
          </p>
        )}
        {scope && current && !complete && (
          <p role="status">所选章节尚未全部明确表达，不自动补正文或摘要。</p>
        )}
        <Button size="sm" disabled={!ready} onClick={() => setConfirmed(draft)}>
          确认本轮规划范围与表达
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
