import type { ChapterPreviewMerge } from "@dramaip/contracts/automation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@dramaip/ui-shared";
import type {
  CreationInput,
  CreationMerge,
  CreationWorkflow,
} from "@dramaip/contracts/creation";
import type { ChangePreview } from "@dramaip/contracts/product";
import { useStudio, message } from "../studio-shared";
import { useRuntimeConnection } from "../runtime-connection";
import { AiSettingsLink } from "../studio-session";
import { CreationProgress } from "./creation-progress-panel";

export const CREATION_LABELS: Record<CreationInput["operation"], string> = {
  chapter: "本章正文",
  characters: "人物方案",
  "book-outline": "全书大纲",
  "chapter-outline": "章节大纲",
  "story-arc": "卷与单元方案",
  episode: "本集剧本与分镜",
  "script-revision": "剧本修订",
  "review-check": "采用后审片复检",
  "shot-prompt": "镜头提示词",
  "delivery-copy": "交付文案",
  localization: "字幕与译文",
  "creator-content": "选题与内容脚本",
  "chapter-memory": "故事记忆",
  "knowledge-plan": "故事与视觉设定",
};
export const CREATION_STAGE_LABELS: Record<CreationWorkflow["stage"], string> =
  {
    preparing: "准备上下文",
    generating: "AI 正在生成",
    checking: "检查候选",
    revising: "局部修订",
    rechecking: "复检候选",
    "awaiting-review": "等待审阅采用",
    applied: "已采用",
    discarded: "已放弃",
    failed: "需要处理",
    canceled: "已取消",
    interrupted: "运行已中断",
  };
const ACTIVE = new Set([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
]);

export function CreationWorkbench(props: {
  projectId: string;
  workflowId?: string;
  operation: CreationInput["operation"];
  targetId?: string;
  baseVersion?: number;
  sourceIds?: string[];
  reviewPackageId?: string;
  feedbackClusterId?: string;
  language?: string;
  defaultInstruction?: string;
  wordGoal?: number;
  docked?: boolean;
  disabled?: boolean;
  engineKind?: CreationInput["engineKind"];
  model?: CreationInput["model"];
  renderQuickActions?(controls: {
    disabled: boolean;
    instruction: string;
    start(instruction: string, selectionOnly?: boolean): void;
  }): ReactNode;
  onPrepare?(): Promise<number>;
  onCandidate?(workflow: CreationWorkflow, preview: ChangePreview): void;
  onDiscarded?(preview: ChangePreview): void;
  onAdopt?(preview: ChangePreview): Promise<boolean>;
  selectedText?: string;
  onApplied?(): void | Promise<void>;
  onContinue?(): void | Promise<void>;
}) {
  const client = useStudio();
  const { runtime } = useRuntimeConnection();
  const owner = [
    "chapter",
    "characters",
    "book-outline",
    "chapter-outline",
    "story-arc",
    "creator-content",
  ].includes(props.operation)
    ? "writing"
    : ["chapter-memory", "knowledge-plan"].includes(props.operation)
      ? "knowledge"
      : ["delivery-copy", "localization"].includes(props.operation)
        ? "delivery"
        : "production";
  const capabilityReady = [
    "automation",
    "agents",
    "creative-quality",
    owner,
    ...(props.reviewPackageId ? ["review"] : []),
    ...(props.feedbackClusterId ? ["insights"] : []),
  ].every((id) =>
    runtime?.plugins.some(
      (plugin) => plugin.id === id && plugin.status === "active",
    ),
  );
  const queries = useQueryClient();
  const key = `dramaip-creation-intent:${props.projectId}:${props.operation}:${props.targetId ?? "project"}:${props.reviewPackageId ?? props.feedbackClusterId ?? ""}`;
  const defaultText =
    props.defaultInstruction ??
    `根据当前项目目标与已采用资料，生成并检查${CREATION_LABELS[props.operation]}。`;
  const [draft, setDraft] = useState({
    key,
    value:
      window.localStorage.getItem(key) ??
      (props.renderQuickActions ? "" : defaultText),
  });
  const instruction =
    draft.key === key
      ? draft.value
      : (window.localStorage.getItem(key) ??
        (props.renderQuickActions ? "" : defaultText));
  const [selected, setSelected] = useState<{ key: string; id: string }>();
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState<{
    data: ChapterPreviewMerge;
    preview: ChangePreview;
    continueNext: boolean;
  }>();
  const [mergeChoices, setMergeChoices] = useState<
    Record<string, "current" | "candidate" | "both">
  >({});
  const [scriptMerge, setScriptMerge] = useState<CreationMerge>();
  const [scriptChoices, setScriptChoices] = useState<
    Record<string, "main" | "branch">
  >({});
  const [error, setError] = useState<string>();
  const actionKeys = useRef(new Map<string, string>());
  const requestKey = (request: unknown): string => {
    const fingerprint = JSON.stringify({ scope: key, request });
    const existing = actionKeys.current.get(fingerprint);
    if (existing) return existing;
    const id = crypto.randomUUID();
    actionKeys.current.set(fingerprint, id);
    return id;
  };
  useEffect(() => {
    setError(undefined);
    setMerge(undefined);
    setScriptMerge(undefined);
  }, [key]);
  const callbacks = useRef(props);
  callbacks.current = props;
  const delivered = useRef<string | undefined>(undefined);
  const settings = useQuery({
    queryKey: ["creation-settings", props.projectId],
    queryFn: () => client.agentEngines.getProjectSettings(props.projectId),
  });
  const list = useQuery({
    queryKey: ["creation-workflows", props.projectId, props.targetId],
    queryFn: () => client.creation.list(props.projectId, props.targetId),
    refetchInterval: 1500,
  });
  const latest = list.data?.items
    .filter(
      (item) =>
        item.input.operation === props.operation &&
        item.input.reviewPackageId === props.reviewPackageId &&
        item.input.feedbackClusterId === props.feedbackClusterId &&
        item.input.language === props.language,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const id =
    selected?.key === key ? selected.id : (props.workflowId ?? latest?.id);
  const current = useQuery({
    queryKey: ["creation-workflow", id],
    queryFn: () => client.creation.get(id!),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data && ACTIVE.has(query.state.data.stage) ? 500 : 1500,
  });
  const value = current.data;
  const running = Boolean(value && ACTIVE.has(value.stage));
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (running && contentRef.current) contentRef.current.scrollTop = 0;
  }, [id, running]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type !== "automation.creation-updated.v1" ||
          !event.payload ||
          typeof event.payload !== "object"
        )
          return;
        const payload = event.payload as Record<string, unknown>;
        if (payload.projectId !== props.projectId) return;
        void queries.invalidateQueries({
          queryKey: ["creation-workflows", props.projectId, props.targetId],
        });
        if (payload.id === id)
          void queries.invalidateQueries({
            queryKey: ["creation-workflow", id],
          });
      }),
    [client, queries, id, props.projectId, props.targetId],
  );
  const preview = useQuery({
    queryKey: ["change-preview", value?.previewId],
    queryFn: () => client.changePreviews.get(value!.previewId!),
    enabled: Boolean(value?.previewId),
    refetchInterval: 1500,
  });
  useEffect(() => {
    if (
      !value?.output ||
      !preview.data ||
      delivered.current === `${key}:${preview.data.id}:${preview.data.status}`
    )
      return;
    delivered.current = `${key}:${preview.data.id}:${preview.data.status}`;
    if (preview.data.status === "pending")
      callbacks.current.onCandidate?.(value, preview.data);
    if (preview.data.status === "committed")
      void callbacks.current.onApplied?.();
    if (preview.data.status === "discarded")
      callbacks.current.onDiscarded?.(preview.data);
  }, [key, value, preview.data]);
  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["creation-workflows"] }),
      queries.invalidateQueries({ queryKey: ["creation-workflow"] }),
      queries.invalidateQueries({ queryKey: ["change-preview"] }),
      queries.invalidateQueries({ queryKey: ["task-worklist"] }),
      queries.invalidateQueries({ queryKey: ["resource"] }),
      queries.invalidateQueries({ queryKey: ["platform-delivery"] }),
    ]);
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy || props.disabled) return;
    if (!capabilityReady) {
      setError("当前创作能力未启用或连接未就绪，请恢复对应扩展后继续。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await work();
      actionKeys.current.clear();
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = (actionInstruction?: string, selectionOnly = true) =>
    act(async () => {
      if (!settings.data) throw new Error("正在读取 AI 配置，请稍后重试。");
      const version = props.onPrepare
        ? await props.onPrepare()
        : props.targetId
          ? props.operation === "chapter" ||
            props.operation === "chapter-memory"
            ? (await client.chapters.get(props.targetId)).version
            : props.baseVersion
          : props.baseVersion;
      const requestedInstruction = actionInstruction
        ? [actionInstruction, instruction.trim()]
            .filter(Boolean)
            .join("\n补充要求：")
        : instruction.trim() || defaultText;
      const input: CreationInput = {
        projectId: props.projectId,
        operation: props.operation,
        targetId: props.targetId,
        baseVersion: version,
        instruction:
          selectionOnly && props.selectedText
            ? `${requestedInstruction}\n仅修改以下选段，返回保持其他部分的完整正文：\n${props.selectedText}`
            : requestedInstruction,
        wordGoal: props.wordGoal,
        sourceIds: props.sourceIds ?? [],
        reviewPackageId: props.reviewPackageId,
        feedbackClusterId: props.feedbackClusterId,
        language: props.language,
        engineKind: props.engineKind ?? settings.data.defaultEngineKind,
        model:
          props.model &&
          props.model.modelId !== settings.data.defaultModel?.modelId
            ? props.model
            : settings.data.defaultModel
              ? { ...settings.data.defaultModel, ...props.model }
              : props.model,
      };
      const created = await client.creation.start(
        input,
        requestKey(["start", input]),
      );
      setSelected({ key, id: created.id });
    });
  const action = (action: "cancel" | "retry" | "continue") =>
    act(async () => {
      const result = await client.creation.action(
        value!.id,
        action,
        requestKey([action, value!.id]),
      );
      setSelected({ key, id: result.id });
    });
  const commit = async (candidate: ChangePreview, continueNext: boolean) => {
    if (props.onAdopt) {
      if (!(await props.onAdopt(candidate))) return;
    } else
      await client.changePreviews.commit(
        candidate.id,
        requestKey(["commit", candidate.id]),
      );
    await props.onApplied?.();
    if (continueNext) await props.onContinue?.();
  };
  const adopt = (continueNext: boolean) =>
    act(async () => {
      let candidate = preview.data!;
      await props.onPrepare?.();
      if (value?.input.operation === "script-revision") {
        const data = await client.creation.merge(value.id);
        if (data.currentVersion !== value.input.baseVersion) {
          setScriptMerge(data);
          setScriptChoices({});
          return;
        }
      }
      const target = candidate.targets.find((item) => item.kind === "chapter");
      if (target) {
        const data = await client.changePreviews.merge(candidate.id);
        if (data.currentVersion !== target.baseVersion) {
          if (data.segments.some((item) => item.conflict)) {
            setMerge({ data, preview: candidate, continueNext });
            setMergeChoices({});
            return;
          }
          candidate = await client.changePreviews.rebase(
            candidate.id,
            {
              baseVersion: data.currentVersion,
              content: data.segments.map((item) => item.content).join(""),
            },
            requestKey(["chapter-rebase", candidate.id, data]),
          );
        }
      }
      await commit(candidate, continueNext);
    });
  const pending = preview.data?.status === "pending";
  const actionBusy = busy || Boolean(props.disabled);
  return (
    <>
      <section
        aria-label={`AI ${CREATION_LABELS[props.operation]}`}
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${props.docked ? "h-full" : "max-h-[720px]"}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">
            AI · {CREATION_LABELS[props.operation]}
          </h2>
          <span className="text-sm text-muted" role="status" aria-live="polite">
            {value
              ? value.input.operation === "review-check" &&
                value.stage === "applied"
                ? "复检完成"
                : CREATION_STAGE_LABELS[value.stage]
              : "准备创作"}
          </span>
        </header>
        <div
          ref={contentRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
        >
          {(error || value?.error || settings.error || list.error) && (
            <div
              role="alert"
              className="space-y-2 rounded-md bg-danger-soft p-3 text-sm text-danger-strong"
            >
              <p>
                {error ?? value?.error ?? message(settings.error ?? list.error)}
              </p>
              <p>创作要求和已返回的候选仍然保留。</p>
              <AiSettingsLink
                projectId={props.projectId}
                actionId={`creation:${props.operation}`}
                input={instruction}
              >
                检查 AI 连接
              </AiSettingsLink>
            </div>
          )}
          {value &&
            (running ||
              ["failed", "canceled", "interrupted"].includes(value.stage)) && (
              <CreationProgress
                key={`${value.id}:${value.runId ?? "preparing"}`}
                value={value}
              />
            )}
          {props.renderQuickActions?.({
            disabled:
              actionBusy ||
              running ||
              pending ||
              !capabilityReady ||
              !settings.data,
            instruction,
            start: (instruction, selectionOnly = false) => {
              if (actionBusy || running || pending) return;
              void start(instruction, selectionOnly);
            },
          })}
          {!capabilityReady && (
            <p role="status" className="text-sm text-muted">
              当前创作能力未启用。已有要求和候选保留，可在扩展设置恢复对应功能。
            </p>
          )}
          {!value && !props.renderQuickActions && (
            <p className="text-sm leading-6 text-muted">
              提出目标，AI 会生成、检查并在必要时修订一次，完成后交给你审阅。
            </p>
          )}
          {value && (
            <p className="text-sm leading-6">{value.input.instruction}</p>
          )}
          {props.selectedText && (
            <blockquote className="rounded-md bg-brand-soft p-3 text-sm">
              已选段落：{props.selectedText.slice(0, 500)}
            </blockquote>
          )}
          {value?.output?.brief && (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                本次方案与目标
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {value.output.brief}
              </p>
            </details>
          )}
          {value?.sources.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                引用资料 · {value.sources.length} 项
              </summary>
              <p className="mt-2 text-sm text-muted">
                本次来源与版本已保存；候选采用时再次核对。
              </p>
              <ul className="mt-2 space-y-2 text-sm text-muted">
                {value.contextEntries.map((entry, index) => (
                  <li key={index}>
                    <span className={entry.included ? "text-ink" : ""}>
                      {entry.title} · {entry.included ? "已纳入" : "未纳入"}
                    </span>
                    <p>{entry.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {value?.output && !props.onCandidate && (
            <article className="whitespace-pre-wrap text-sm leading-7">
              <h3 className="mb-2 font-semibold">
                {value.output.title || "候选方案"}
              </h3>
              {value.output.content}
              {value.output.items.map((item) => (
                <details
                  key={item.ref}
                  className="mt-3 rounded border border-line p-3"
                >
                  <summary>{item.title}</summary>
                  <dl className="mt-2 space-y-2">
                    {Object.entries(item.data).map(([label, detail]) => (
                      <div key={label}>
                        <dt className="text-muted">{label}</dt>
                        <dd>
                          {typeof detail === "string"
                            ? detail
                            : JSON.stringify(detail)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </article>
          )}
          {value?.adoptionCheckId && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                查看采用后的原问题复检
              </summary>
              <CreationRunCard id={value.adoptionCheckId} />
            </details>
          )}
          {value?.adoptionCheckError && (
            <p role="alert" className="text-sm text-danger-strong">
              采用后复检未启动：{value.adoptionCheckError}
            </p>
          )}
          {value?.memoryState && (
            <p
              className="rounded-md bg-surface-muted p-3 text-sm"
              role="status"
            >
              故事资料：
              {value.memoryState === "synced"
                ? "已按采用版本更新"
                : value.memoryState === "running"
                  ? "正在提取与检查"
                  : value.memoryState === "review-required"
                    ? "有新增资料需要审阅，可在任务中心处理"
                    : (value.memoryError ?? "更新未完成，正式正文已保留")}
            </p>
          )}
          {Boolean(value?.issues.length) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">检查与修订</h3>
              {value!.issues.map((issue, index) => (
                <article
                  key={index}
                  className="rounded-md border border-line p-3 text-sm"
                >
                  <p className="font-medium">{issue.message}</p>
                  <p className="mt-1 text-muted">
                    {issue.location} ·{" "}
                    {issue.source === "rule" ? "规则检查" : "AI 审阅"}
                  </p>
                  {issue.evidence && (
                    <blockquote className="my-2 border-l-2 border-brand pl-2">
                      {issue.evidence}
                    </blockquote>
                  )}
                  <p>{issue.suggestion}</p>
                </article>
              ))}
            </div>
          )}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-line bg-surface-raised p-4">
          <label className="block text-sm font-medium">
            {props.renderQuickActions
              ? "补充要求（可选）"
              : value?.output
                ? "修改要求"
                : "创作目标"}
            <textarea
              aria-label="AI 创作要求"
              className={`mt-2 max-h-44 w-full resize-y rounded-md border border-line bg-surface p-3 text-sm leading-6 ${props.renderQuickActions ? "min-h-16" : "min-h-24"}`}
              rows={props.renderQuickActions ? 2 : 3}
              placeholder={
                props.renderQuickActions
                  ? "可直接点选上方操作；也可补充风格、情节或修改要求。"
                  : undefined
              }
              value={instruction}
              onChange={(event) => {
                const text = event.target.value;
                setDraft({ key, value: text });
                window.localStorage.setItem(key, text);
                actionKeys.current.clear();
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={actionBusy || !capabilityReady}
                onClick={() => void action("cancel")}
              >
                停止生成
              </Button>
            ) : pending ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={actionBusy || !capabilityReady}
                  onClick={() => void adopt(false)}
                >
                  采用
                </Button>
                {props.onContinue && (
                  <Button
                    size="sm"
                    disabled={actionBusy || !capabilityReady}
                    onClick={() => void adopt(true)}
                  >
                    采用并生成下一章
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actionBusy || !capabilityReady}
                  onClick={() =>
                    void act(async () => {
                      await client.changePreviews.discard(
                        preview.data!.id,
                        crypto.randomUUID(),
                      );
                    })
                  }
                >
                  放弃候选
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                className="w-full"
                disabled={
                  actionBusy ||
                  !capabilityReady ||
                  (!props.renderQuickActions && !instruction.trim()) ||
                  !settings.data
                }
                onClick={() => void start()}
              >
                生成并检查{CREATION_LABELS[props.operation]}
              </Button>
            )}
            {preview.data?.status === "conflicted" &&
              ["chapter", "script-revision"].includes(props.operation) && (
                <Button
                  size="sm"
                  disabled={actionBusy || !capabilityReady}
                  onClick={() => void adopt(false)}
                >
                  解决版本冲突
                </Button>
              )}
            {pending && (
              <Button
                size="sm"
                variant="secondary"
                disabled={actionBusy || !capabilityReady || !instruction.trim()}
                onClick={() => void start()}
              >
                按要求生成新候选
              </Button>
            )}
            {value &&
              ["failed", "interrupted", "canceled"].includes(value.stage) && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={actionBusy || !capabilityReady}
                  onClick={() => void action("retry")}
                >
                  沿用原输入重试
                </Button>
              )}
            {value?.stage === "failed" && value.output && (
              <Button
                size="sm"
                variant="ghost"
                disabled={actionBusy || !capabilityReady}
                onClick={() => void action("continue")}
              >
                保留候选重新检查
              </Button>
            )}
          </div>
        </footer>
      </section>
      <Dialog
        open={Boolean(scriptMerge)}
        onOpenChange={(open) => {
          if (!open) setScriptMerge(undefined);
        }}
      >
        <Dialog.Content className="max-w-4xl">
          <Dialog.Title>剧本已有变化，请确认合并</Dialog.Title>
          <Dialog.Description>
            按剧本块标识保留独立修改；冲突块需要明确选择。合并后复检，生成新的待审阅候选。
          </Dialog.Description>
          <div className="max-h-[55vh] space-y-3 overflow-auto overscroll-contain">
            {scriptMerge?.units
              .filter((unit) => unit.conflict)
              .map((unit) => (
                <section
                  key={unit.id}
                  className="rounded border border-line p-3"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <p className="whitespace-pre-wrap text-sm">
                      当前剧本：{unit.current}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      AI 候选：{unit.candidate}
                    </p>
                  </div>
                  <select
                    aria-label="剧本冲突块选择"
                    value={scriptChoices[unit.id] ?? ""}
                    onChange={(event) =>
                      setScriptChoices((current) => ({
                        ...current,
                        [unit.id]: event.target.value as "main" | "branch",
                      }))
                    }
                  >
                    <option value="" disabled>
                      请选择
                    </option>
                    <option value="main">保留当前块</option>
                    <option value="branch">采用候选块</option>
                  </select>
                </section>
              ))}
          </div>
          <Button
            disabled={
              actionBusy ||
              !scriptMerge ||
              scriptMerge.units.some(
                (unit) => unit.conflict && !scriptChoices[unit.id],
              )
            }
            onClick={() =>
              void act(async () => {
                if (!value || !scriptMerge) return;
                const next = await client.creation.rebase(
                  value.id,
                  {
                    baseVersion: scriptMerge.currentVersion,
                    choices: scriptChoices,
                  },
                  requestKey([
                    "script-rebase",
                    value.id,
                    scriptMerge.currentVersion,
                    scriptChoices,
                  ]),
                );
                setSelected({ key, id: next.id });
                setScriptMerge(undefined);
              })
            }
          >
            合并并复检
          </Button>
        </Dialog.Content>
      </Dialog>
      <Dialog
        open={Boolean(merge)}
        onOpenChange={(open) => {
          if (!open) setMerge(undefined);
        }}
      >
        <Dialog.Content className="max-w-5xl">
          <Dialog.Title>正文已有变化，请确认冲突段落</Dialog.Title>
          <Dialog.Description>
            不冲突的新增内容会自动保留。每处冲突都需要明确选择，关闭窗口会保留候选。
          </Dialog.Description>
          <div className="max-h-[60vh] space-y-4 overflow-auto overscroll-contain">
            {merge?.data.segments
              .filter((item) => item.conflict)
              .map((item) => (
                <section
                  key={item.id}
                  className="rounded border border-line p-3"
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <h3 className="font-medium">生成时正文</h3>
                      <pre className="whitespace-pre-wrap font-editor text-sm">
                        {item.base}
                      </pre>
                    </div>
                    <div>
                      <h3 className="font-medium">当前正文</h3>
                      <pre className="whitespace-pre-wrap font-editor text-sm">
                        {item.current}
                      </pre>
                    </div>
                    <div>
                      <h3 className="font-medium">AI 候选</h3>
                      <pre className="whitespace-pre-wrap font-editor text-sm">
                        {item.candidate}
                      </pre>
                    </div>
                  </div>
                  <label className="mt-3 flex gap-3 text-sm">
                    此处采用
                    <select
                      aria-label="冲突段落选择"
                      value={mergeChoices[item.id] ?? ""}
                      onChange={(event) =>
                        setMergeChoices((choices) => ({
                          ...choices,
                          [item.id]: event.target.value as
                            "current" | "candidate" | "both",
                        }))
                      }
                    >
                      <option value="" disabled>
                        请选择
                      </option>
                      <option value="current">保留当前正文</option>
                      <option value="candidate">采用 AI 候选</option>
                      <option value="both">依次保留两段</option>
                    </select>
                  </label>
                </section>
              ))}
          </div>
          <Button
            disabled={
              actionBusy ||
              !merge ||
              merge.data.segments.some(
                (item) => item.conflict && !mergeChoices[item.id],
              )
            }
            onClick={() =>
              void act(async () => {
                if (!merge) return;
                const content = merge.data.segments
                  .map((item) =>
                    !item.conflict
                      ? item.content
                      : mergeChoices[item.id] === "current"
                        ? item.current
                        : mergeChoices[item.id] === "candidate"
                          ? item.candidate
                          : `${item.current}\n${item.candidate}`,
                  )
                  .join("");
                const candidate = await client.changePreviews.rebase(
                  merge.preview.id,
                  { baseVersion: merge.data.currentVersion, content },
                  requestKey([
                    "chapter-rebase",
                    merge.preview.id,
                    merge.data.currentVersion,
                    content,
                  ]),
                );
                setMerge(undefined);
                await commit(candidate, merge.continueNext);
              })
            }
          >
            确认合并并采用
          </Button>
        </Dialog.Content>
      </Dialog>
    </>
  );
}

export function CreationRecordWorkbench(props: {
  projectId: string;
  targetId: string;
  domain: string;
  sourceIds?: string[];
  operation: CreationInput["operation"];
  reviewPackageId?: string;
  feedbackClusterId?: string;
  defaultInstruction?: string;
  onApplied?(): void | Promise<void>;
}) {
  const client = useStudio();
  const [language, setLanguage] = useState("英语");
  const { data: target, error } = useQuery({
    queryKey: ["resource", props.domain, props.targetId],
    queryFn: () => client.resources.get(props.domain, props.targetId),
    enabled: Boolean(props.targetId),
  });
  if (!target)
    return (
      <p className="text-sm text-muted">
        {error ? message(error) : "正在读取当前对象…"}
      </p>
    );
  return (
    <div className="space-y-3">
      {props.operation === "localization" && (
        <label className="flex items-center gap-3 text-sm">
          目标语言
          <input
            className="rounded border border-line p-2"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          />
        </label>
      )}
      <CreationWorkbench
        {...props}
        onPrepare={async () =>
          (await client.resources.get(props.domain, props.targetId)).version
        }
        baseVersion={target.version}
        language={props.operation === "localization" ? language : undefined}
      />
    </div>
  );
}

export function CreationRunCard(props: { id: string }) {
  const client = useStudio();
  const { data, error } = useQuery({
    queryKey: ["creation-workflow", props.id],
    queryFn: () => client.creation.get(props.id),
    refetchInterval: 1500,
  });
  if (!data)
    return (
      <p className="text-sm text-muted">
        {error ? message(error) : "正在读取创作运行…"}
      </p>
    );
  return (
    <CreationWorkbench
      workflowId={props.id}
      projectId={data.input.projectId}
      operation={data.input.operation}
      targetId={data.input.targetId}
      baseVersion={data.input.baseVersion}
      defaultInstruction={data.input.instruction}
      sourceIds={data.input.sourceIds}
      reviewPackageId={data.input.reviewPackageId}
      feedbackClusterId={data.input.feedbackClusterId}
      language={data.input.language}
      wordGoal={data.input.wordGoal}
    />
  );
}
