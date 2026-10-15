import type { ChapterPreviewMerge } from "@dramaip/contracts/automation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, NativeSelect } from "@dramaip/ui-shared";
import type {
  CreationInput,
  CreationMerge,
  CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  CreationWorkflowSchema,
  NarrativeContextRequestSchema,
  NarrativePlanningRequestSchema,
  ProductionNarrativeRequestSchema,
} from "@dramaip/contracts/creation";
import type { ChangePreview } from "@dramaip/contracts/product";
import { useStudio, message } from "../studio-shared";
import { useRuntimeConnection } from "../runtime-connection";
import { AiSettingsLink } from "../studio-session";
import { CreationProgress } from "./creation-progress-panel";
import { CreationExecutionPanel } from "./CreationExecutionPanel";
import { CreationIssueEvidence } from "./CreationIssueEvidence";
import { AgentUsagePanel } from "./AgentUsagePanel";
import { isDefiniteCreationStartRejection } from "../creation-request-keys";
import {
  storyboardRedoStartStorageKey,
  parseStoryboardRedoStartRequest,
  freezeStoryboardRedoStartRequest,
  saveStoryboardRedoStartRequest,
  clearExactStoryboardRedoStartRequest,
  resendStoryboardRedoStart,
  type StoryboardRedoStartRequest,
} from "../storyboard-redo-start-recovery";
import {
  completeScriptMergeOrder,
  readScriptMerge,
  selectedScriptMergeIds,
} from "../script-merge-order";
import {
  clearExactScriptMergeRequest,
  freezeScriptMergeRequest,
  parseScriptMergeRequest,
  resendScriptMerge,
  scriptMergeStorageKey,
  type ScriptMergeRequest,
} from "../script-merge-recovery";
import { ScriptMergeOrderReview } from "./ScriptMergeOrderReview";
import { NarrativeSourceCoverage } from "./NarrativeSourceCoverage";
import { NarrativeQualitySourceCoverage } from "./NarrativeQualitySourceCoverage";
import { FrozenNarrativeStorySources } from "./FrozenNarrativeStorySources";
import { ProductionNarrativeSelector } from "./production/ProductionNarrativeSelector";
import {
  creationWorkbenchScopeKey,
  matchesCreationWorkbenchWorkflow,
  readCreationWorkbenchWorkflow,
  matchesCreationWorkbenchPreview,
} from "../creation-workbench-owner";
import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
} from "../current-owner-read";

export const CREATION_LABELS: Record<CreationInput["operation"], string> = {
  "author-intent": "作者意图建议",
  chapter: "本章正文",
  characters: "人物方案",
  "book-outline": "全书大纲",
  "chapter-outline": "章节大纲",
  "story-arc": "卷与单元方案",
  episode: "本集剧本与分镜（旧 episode 兼容）",
  "adaptation-diagnosis": "改编诊断",
  "adaptation-strategy": "独立改编策略",
  "season-plan": "整季分集方案",
  "episode-outline": "单集大纲",
  "episode-script": "单集标准剧本",
  "storyboard-package": "单集分镜包",
  "quality-review": "版本绑定的质量报告",
  "script-revision": "剧本修订",
  "review-check": "采用后审片复检",
  "shot-prompt": "镜头提示词",
  "delivery-copy": "交付文案",
  localization: "字幕与译文",
  "creator-content": "选题与内容脚本",
  "chapter-memory": "故事记忆",
  "knowledge-plan": "故事与视觉设定",
  "narrative-summary": "卷／故事弧／全书摘要",
};
export const CREATION_STAGE_LABELS: Record<CreationWorkflow["stage"], string> =
  {
    preparing: "准备上下文",
    generating: "AI 正在生成",
    checking: "检查 AI 草稿",
    revising: "局部修订",
    rechecking: "复检 AI 草稿",
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

type CreationWorkbenchProps = {
  projectId: string;
  workflowId?: string;
  operation: CreationInput["operation"];
  targetId?: string;
  baseVersion?: number;
  sourceIds?: string[];
  productionNarrativeRequest?: CreationInput["productionNarrativeRequest"];
  diagnosisRequest?: CreationInput["diagnosisRequest"];
  adaptationStrategyRequest?: CreationInput["adaptationStrategyRequest"];
  seasonPlanRequest?: CreationInput["seasonPlanRequest"];
  episodeDevelopmentRequest?: CreationInput["episodeDevelopmentRequest"];
  qualityReviewRequest?: CreationInput["qualityReviewRequest"];
  narrativeContextRequest?: CreationInput["narrativeContextRequest"];
  narrativePlanningRequest?: CreationInput["narrativePlanningRequest"];
  narrativePlanningRequired?: boolean;
  startDisabled?: boolean;
  narrativeSummaryRequest?: CreationInput["narrativeSummaryRequest"];
  authorIntentRequest?: CreationInput["authorIntentRequest"];
  externalReview?: boolean;
  reviewPackageId?: string;
  feedbackClusterId?: string;
  language?: string;
  defaultInstruction?: string;
  resultLabel?: string;
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
  onStarted?(workflow: CreationWorkflow): void;
  renderCandidate?(workflow: CreationWorkflow): ReactNode;
  onDiscarded?(preview: ChangePreview): void;
  onAdopt?(preview: ChangePreview): Promise<boolean>;
  selectedText?: string;
  onApplied?(): void | Promise<void>;
  onContinue?(): void | Promise<void>;
};

export function CreationWorkbench(props: CreationWorkbenchProps) {
  const render = (selection?: {
    request?: CreationInput["productionNarrativeRequest"];
    startDisabled: boolean;
  }) => (
    <CreationWorkbenchInstance
      key={JSON.stringify([
        props.projectId,
        props.operation,
        props.targetId,
        props.workflowId,
      ])}
      {...props}
      productionNarrativeRequest={
        selection?.request ?? props.productionNarrativeRequest
      }
      sourceIds={selection?.request ? [] : props.sourceIds}
      startDisabled={Boolean(props.startDisabled || selection?.startDisabled)}
    />
  );
  if (
    !props.workflowId &&
    !props.productionNarrativeRequest &&
    ["episode", "script-revision", "review-check", "shot-prompt"].includes(
      props.operation,
    )
  )
    return (
      <ProductionNarrativeSelector
        key={`${props.projectId}:${props.operation}:${props.targetId ?? "project"}:${JSON.stringify(props.sourceIds ?? [])}`}
        projectId={props.projectId}
        legacySourceIds={props.sourceIds}
        disabled={props.disabled}
        storageKey={`dramaip-production-source-choice:${props.projectId}:${props.operation}:${props.targetId ?? "project"}:${JSON.stringify(props.sourceIds ?? [])}`}
      >
        {(selection) => render(selection)}
      </ProductionNarrativeSelector>
    );
  return render();
}

function CreationWorkbenchInstance(props: CreationWorkbenchProps) {
  const client = useStudio();
  const { runtime } = useRuntimeConnection();
  const owner =
    props.operation === "author-intent"
      ? "workspace"
      : props.operation === "quality-review"
        ? "creative-quality"
        : [
              "chapter",
              "characters",
              "book-outline",
              "chapter-outline",
              "story-arc",
              "creator-content",
            ].includes(props.operation)
          ? "writing"
          : ["chapter-memory", "knowledge-plan", "narrative-summary"].includes(
                props.operation,
              )
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
  const scopeKey = props.productionNarrativeRequest
    ? `:production-sources:${JSON.stringify(props.productionNarrativeRequest)}`
    : props.narrativePlanningRequest
      ? `:planning:${JSON.stringify(props.narrativePlanningRequest)}`
      : props.adaptationStrategyRequest
        ? `:strategy:${JSON.stringify(props.adaptationStrategyRequest)}`
        : props.authorIntentRequest
          ? `:intent:${JSON.stringify(props.authorIntentRequest)}`
          : props.episodeDevelopmentRequest?.redoShots
            ? `:redo:${JSON.stringify(props.episodeDevelopmentRequest.redoShots)}${props.episodeDevelopmentRequest.redoMode ? `:mode:${props.episodeDevelopmentRequest.redoMode}` : ""}`
            : "";
  const draftStorageKey = `dramaip-creation-intent:${props.projectId}:${props.operation}:${props.targetId ?? "project"}:${props.reviewPackageId ?? props.feedbackClusterId ?? ""}${props.episodeDevelopmentRequest ? `:${props.episodeDevelopmentRequest.episodeId}` : ""}${props.qualityReviewRequest ? `:${JSON.stringify(props.qualityReviewRequest)}` : ""}${props.diagnosisRequest ? `:${JSON.stringify(props.diagnosisRequest)}` : ""}${props.seasonPlanRequest ? `:${JSON.stringify(props.seasonPlanRequest)}` : ""}${scopeKey}`;
  const key = creationWorkbenchScopeKey(props);
  const sourceRedoRecoveryKey = props.episodeDevelopmentRequest
    ?.redoSourceReview
    ? storyboardRedoStartStorageKey(
        props.projectId,
        props.episodeDevelopmentRequest.episodeId,
      )
    : undefined;
  const [sourceRedoRecovery, setSourceRedoRecovery] = useState<{
    storageKey: string;
    request?: StoryboardRedoStartRequest;
    error?: string;
  }>();
  useEffect(() => {
    if (!sourceRedoRecoveryKey || !props.episodeDevelopmentRequest) {
      setSourceRedoRecovery(undefined);
      return;
    }
    try {
      setSourceRedoRecovery({
        storageKey: sourceRedoRecoveryKey,
        request: parseStoryboardRedoStartRequest(
          window.localStorage.getItem(sourceRedoRecoveryKey),
          props.projectId,
          props.episodeDevelopmentRequest.episodeId,
        ),
      });
    } catch (cause) {
      setSourceRedoRecovery({
        storageKey: sourceRedoRecoveryKey,
        error: message(cause),
      });
    }
  }, [
    sourceRedoRecoveryKey,
    key,
    props.projectId,
    props.episodeDevelopmentRequest?.episodeId,
  ]);
  const defaultText =
    props.defaultInstruction ??
    `根据当前项目目标与已采用资料，生成并检查${CREATION_LABELS[props.operation]}。`;
  const resultLabel = props.resultLabel ?? CREATION_LABELS[props.operation];
  const [draft, setDraft] = useState({
    key,
    value:
      window.localStorage.getItem(draftStorageKey) ??
      (props.renderQuickActions ? "" : defaultText),
  });
  const instruction =
    draft.key === key
      ? draft.value
      : (window.localStorage.getItem(draftStorageKey) ??
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
  const [scriptOrder, setScriptOrder] = useState<string[]>();
  const [scriptOrderConfirmed, setScriptOrderConfirmed] = useState(false);
  const [mergeRecovery, setMergeRecovery] = useState<{
    storageKey: string;
    request?: ScriptMergeRequest;
    error?: string;
    raw?: string;
  }>();
  const recoveryKey =
    props.operation === "script-revision" && props.targetId
      ? scriptMergeStorageKey(props.projectId, props.targetId)
      : undefined;
  const activeScope = useRef(key);
  activeScope.current = key;
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
    setScriptOrder(undefined);
    setScriptOrderConfirmed(false);
  }, [key]);
  useEffect(() => {
    if (!recoveryKey || !props.targetId) {
      setMergeRecovery(undefined);
      return;
    }
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(recoveryKey);
      setMergeRecovery({
        storageKey: recoveryKey,
        request: parseScriptMergeRequest(raw, props.projectId, props.targetId),
      });
    } catch (cause) {
      setMergeRecovery({
        storageKey: recoveryKey,
        error: message(cause),
        raw: raw ?? undefined,
      });
    }
  }, [recoveryKey, props.projectId, props.targetId]);
  const callbacks = useRef(props);
  callbacks.current = props;
  const delivered = useRef<string | undefined>(undefined);
  const settings = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-settings", props.projectId],
      queryFn: () => client.agentEngines.getProjectSettings(props.projectId),
    }),
  );
  const list = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflows", props.projectId, props.targetId],
      queryFn: async () => {
        const page = await client.creation.list(
          props.projectId,
          props.targetId,
        );
        const ids = new Set<string>();
        for (const item of page.items) {
          if (
            item.input.projectId !== props.projectId ||
            ids.has(item.id) ||
            (props.targetId && item.input.targetId !== props.targetId)
          )
            throw new Error(
              "创作运行目录的实际项目／目标或唯一身份无法核对，未选择最近 AI 草稿。",
            );
          ids.add(item.id);
        }
        return page;
      },
      refetchInterval: 1500,
    }),
  );
  const latest = list.data?.items
    .filter(
      (item) =>
        !item.recordMergeSource &&
        matchesCreationWorkbenchWorkflow(item, {
          ...props,
          sourceIds: props.sourceIds ?? [],
        }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const id =
    selected?.key === key ? selected.id : (props.workflowId ?? latest?.id);
  const current = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", id],
      queryFn: async () => {
        const result = CreationWorkflowSchema.parse(
          await client.creation.get(id!),
        );
        if (
          !matchesCreationWorkbenchWorkflow(result, {
            ...props,
            sourceIds: props.sourceIds ?? [],
            workflowId: id!,
          })
        )
          throw new Error(
            "指定原运行的实际身份／项目／操作／原冻结请求不符，未打开其他 AI 草稿。",
          );
        return result;
      },
      enabled: Boolean(id),
      refetchInterval: (query) =>
        query.state.data && ACTIVE.has(query.state.data.stage) ? 500 : 1500,
    }),
  );
  const value = id
    ? readCreationWorkbenchWorkflow(current, {
        ...props,
        sourceIds: props.sourceIds ?? [],
        workflowId: id,
      })
    : undefined;
  const activeWorkflow = useRef(value?.id);
  activeWorkflow.current = value?.id;
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
  const preview = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["change-preview", value?.previewId],
      queryFn: async () => {
        const result = await client.changePreviews.get(value!.previewId!);
        if (!matchesCreationWorkbenchPreview(result, value))
          throw new Error(
            "指定原预览的实际身份／任务／目标不符，未显示可采用缓存。",
          );
        return result;
      },
      enabled: Boolean(value?.previewId),
      refetchInterval: 1500,
    }),
  );
  // The workflow GET can succeed while its declared original preview fails.
  // Keep the actual workflow status, but do not expose candidate text/evidence
  // until that preview's identity is verified by this mount's owner read.
  const displayValue =
    value?.previewId && !matchesCreationWorkbenchPreview(preview.data, value)
      ? undefined
      : value;
  useEffect(() => {
    if (
      !value?.output ||
      !preview.data ||
      current.isFetching ||
      preview.isFetching ||
      !matchesCreationWorkbenchPreview(preview.data, value) ||
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
  }, [key, value, preview.data, current.isFetching, preview.isFetching]);
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
    if (busy || props.disabled || ownerReadBlocked) return;
    if (!capabilityReady) {
      setError("当前创作能力未启用或连接未就绪，请恢复对应扩展后继续。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await work();
      if (activeScope.current === key) {
        actionKeys.current.clear();
        await refresh();
      }
    } catch (cause) {
      if (activeScope.current === key) setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = (actionInstruction?: string, selectionOnly = true) =>
    act(async () => {
      if (
        props.startDisabled ||
        (props.narrativePlanningRequired && !props.narrativePlanningRequest)
      )
        throw new Error(
          "请先明确确认本轮规划范围与表达；原运行仍使用其参考内容。",
        );
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
      // An actual owner-loaded original run may originate from the SDK. Do not
      // silently drop its explicit narrative scope on an ordinary new candidate.
      const productionNarrativeRequest =
        props.productionNarrativeRequest ??
        value?.input.productionNarrativeRequest;
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
        sourceIds: productionNarrativeRequest ? [] : (props.sourceIds ?? []),
        diagnosisRequest: props.diagnosisRequest,
        adaptationStrategyRequest: props.adaptationStrategyRequest,
        seasonPlanRequest: props.seasonPlanRequest,
        episodeDevelopmentRequest: props.episodeDevelopmentRequest,
        qualityReviewRequest: props.qualityReviewRequest,
        narrativeContextRequest: props.narrativeContextRequest,
        narrativePlanningRequest: props.narrativePlanningRequest,
        productionNarrativeRequest,
        narrativeSummaryRequest: props.narrativeSummaryRequest,
        authorIntentRequest: props.authorIntentRequest,
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
      if (input.narrativeContextRequest)
        NarrativeContextRequestSchema.parse(input.narrativeContextRequest);
      if (input.narrativePlanningRequest)
        NarrativePlanningRequestSchema.parse(input.narrativePlanningRequest);
      if (input.productionNarrativeRequest)
        ProductionNarrativeRequestSchema.parse(
          input.productionNarrativeRequest,
        );
      const request = ["start", input];
      if (sourceRedoRecoveryKey) {
        const original = freezeStoryboardRedoStartRequest(input);
        saveStoryboardRedoStartRequest(window.localStorage, original);
        setSourceRedoRecovery({
          storageKey: sourceRedoRecoveryKey,
          request: original,
        });
        const created = await resendStoryboardRedoStart(
          client.creation,
          original,
        );
        if (
          !clearExactStoryboardRedoStartRequest(window.localStorage, original)
        )
          throw new Error("本机原创建请求已经改变，实际回执未覆盖新记录。");
        if (activeScope.current !== key) return;
        setSourceRedoRecovery({ storageKey: sourceRedoRecoveryKey });
        setSelected({ key, id: created.id });
        props.onStarted?.(created);
        return;
      }
      const fingerprint = JSON.stringify({ scope: key, request });
      const idempotencyKey = requestKey(request);
      const created = await client.creation
        .start(input, idempotencyKey)
        .catch((cause: unknown) => {
          if (
            isDefiniteCreationStartRejection(cause) &&
            actionKeys.current.get(fingerprint) === idempotencyKey
          )
            actionKeys.current.delete(fingerprint);
          throw cause;
        });
      setSelected({ key, id: created.id });
      props.onStarted?.(created);
    });
  const action = (action: "cancel" | "retry" | "continue") =>
    act(async () => {
      const result = await client.creation.action(
        value!.id,
        action,
        requestKey([action, value!.id]),
      );
      setSelected({ key, id: result.id });
      props.onStarted?.(result);
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
        const data = readScriptMerge(
          await client.creation.merge(value.id),
          props.projectId,
          value.id,
          props.targetId!,
        );
        if (activeScope.current !== key || activeWorkflow.current !== value.id)
          return;
        if (data.currentVersion !== value.input.baseVersion) {
          setScriptMerge(data);
          setScriptChoices({});
          setScriptOrder(undefined);
          setScriptOrderConfirmed(false);
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
  const ownerReadBlocked = Boolean(
    (id && (current.isFetching || current.error || !value)) ||
    (value?.previewId &&
      (preview.isFetching ||
        preview.error ||
        !preview.data ||
        !matchesCreationWorkbenchPreview(preview.data, value))) ||
    (!props.workflowId &&
      selected?.key !== key &&
      (list.isFetching || list.error || !list.data)),
  );
  const actionBusy = busy || Boolean(props.disabled) || ownerReadBlocked;
  const pendingSourceRedoStart =
    sourceRedoRecovery &&
    sourceRedoRecovery.storageKey === sourceRedoRecoveryKey &&
    Boolean(sourceRedoRecovery.request || sourceRedoRecovery.error);
  return (
    <>
      <section
        aria-label={`AI ${resultLabel}`}
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${props.docked ? "h-full" : "max-h-[720px]"}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">AI · {resultLabel}</h2>
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
          {props.operation === "episode" && (
            <p className="rounded border border-line p-3 text-sm text-muted">
              旧 episode 兼容工作流：原 AI
              草稿、来源快照与回执保留。此处仍使用旧的一体化采用规则，不会自动转成独立大纲、标准剧本或分镜版本。
            </p>
          )}
          {sourceRedoRecovery &&
            sourceRedoRecovery.storageKey === sourceRedoRecoveryKey &&
            (sourceRedoRecovery.request || sourceRedoRecovery.error) && (
              <section
                aria-label="原来源重做创建请求待核对"
                className="space-y-2 rounded border border-line p-3 text-sm"
              >
                <p>
                  原完整创建输入与幂等键已保留，不使用当前改写要求、配置或最新来源重建。重发可能启动尚未建立的原请求；已有回执时仅返回同一运行，不自动重发。
                </p>
                {sourceRedoRecovery.error && (
                  <p role="alert" className="text-danger-strong">
                    本机原请求不可核对，未删除或覆盖。{sourceRedoRecovery.error}
                  </p>
                )}
                {sourceRedoRecovery.request && (
                  <>
                    <p className="break-all">
                      原请求 {sourceRedoRecovery.request.key} · 原关联{" "}
                      {
                        sourceRedoRecovery.request.input
                          .episodeDevelopmentRequest?.redoSourceReview
                          ?.attribution.id
                      }
                    </p>
                    <Button
                      variant="secondary"
                      disabled={
                        actionBusy ||
                        !capabilityReady ||
                        creationWorkbenchScopeKey(
                          sourceRedoRecovery.request.input,
                        ) !== key
                      }
                      onClick={() =>
                        void act(async () => {
                          const request = sourceRedoRecovery.request!;
                          const raw = window.localStorage.getItem(
                            sourceRedoRecoveryKey!,
                          );
                          if (raw !== JSON.stringify(request))
                            throw new Error(
                              "本机原请求已变化，未重发旧内存输入。",
                            );
                          const result = await resendStoryboardRedoStart(
                            client.creation,
                            request,
                          );
                          if (
                            !clearExactStoryboardRedoStartRequest(
                              window.localStorage,
                              request,
                            )
                          )
                            throw new Error(
                              "实际回执已取得，本机原请求不一致，未覆盖其他记录。",
                            );
                          if (activeScope.current !== key) return;
                          setSourceRedoRecovery({
                            storageKey: sourceRedoRecoveryKey!,
                          });
                          setSelected({ key, id: result.id });
                          props.onStarted?.(result);
                        })
                      }
                    >
                      重发原来源重做创建请求（不换键）
                    </Button>
                  </>
                )}
              </section>
            )}
          {mergeRecovery &&
            mergeRecovery.storageKey === recoveryKey &&
            (mergeRecovery.request || mergeRecovery.error) && (
              <section
                aria-label="原剧本合并请求恢复"
                className="space-y-2 rounded border border-line p-3 text-sm"
              >
                <p>
                  存在尚未核对回执的本地原合并请求。不会自动重发、刷新比较基准或新建幂等键；重发仍可能启动原请求，已存在时只返回同一
                  AI 草稿。
                </p>
                {mergeRecovery.error && (
                  <p role="alert">
                    {mergeRecovery.error} 原记录仍保留，不能自动替换。
                  </p>
                )}
                {mergeRecovery.request && (
                  <>
                    <p className="break-all">
                      原候选 {mergeRecovery.request.workflowId} · 实际剧本版本{" "}
                      {mergeRecovery.request.input.baseVersion} · 原请求{" "}
                      {mergeRecovery.request.key}
                    </p>
                    <Button
                      disabled={actionBusy || !capabilityReady}
                      onClick={() =>
                        void act(async () => {
                          const request = mergeRecovery.request!;
                          const next = await resendScriptMerge(
                            client.creation,
                            request,
                          );
                          const cleared = clearExactScriptMergeRequest(
                            window.localStorage,
                            request,
                          );
                          if (activeScope.current !== key || !cleared) return;
                          setMergeRecovery({ storageKey: recoveryKey! });
                          setSelected({ key, id: next.id });
                          setScriptMerge(undefined);
                        })
                      }
                    >
                      重发原合并请求并核对回执
                    </Button>
                  </>
                )}
                <p>
                  删除本地记录不撤销服务端 AI
                  草稿；若请求已成功，仍须从原运行列表查看、采用或放弃。
                </p>
                <Button
                  variant="ghost"
                  disabled={actionBusy}
                  onClick={() => {
                    const request = mergeRecovery.request;
                    if (
                      request
                        ? !clearExactScriptMergeRequest(
                            window.localStorage,
                            request,
                          )
                        : mergeRecovery.raw === undefined ||
                          window.localStorage.getItem(recoveryKey!) !==
                            mergeRecovery.raw
                    ) {
                      setError("本地记录已变化或无法核对，不能删除其他请求。");
                      return;
                    }
                    if (!request) window.localStorage.removeItem(recoveryKey!);
                    setMergeRecovery({ storageKey: recoveryKey! });
                  }}
                >
                  仅删除已核对的本地重发记录
                </Button>
              </section>
            )}
          {id && current.isFetching && (
            <p role="status">
              正在重核指定原运行；
              {value
                ? "保留上次实际原快照，操作暂不可用。"
                : "未恢复缓存候选或重新生成。"}
            </p>
          )}
          {(error ||
            value?.error ||
            settings.error ||
            list.error ||
            current.error ||
            preview.error) && (
            <div
              role="alert"
              className="space-y-2 rounded-md bg-danger-soft p-3 text-sm text-danger-strong"
            >
              <p>
                {value?.error ??
                  error ??
                  message(
                    current.error ||
                      preview.error ||
                      settings.error ||
                      list.error,
                  )}
              </p>
              <p>
                {current.error || preview.error
                  ? "指定原运行或原预览读取失败，未使用可操作旧缓存；创作要求保留，不切换最近运行。"
                  : "创作要求和已返回的 AI 草稿仍然保留。"}
              </p>
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
          {value?.runId && (
            <AgentUsagePanel
              key={`${value.input.projectId}:${value.runId}`}
              runId={value.runId}
              projectId={value.input.projectId}
            />
          )}
          {value && (
            <CreationExecutionPanel
              key={`${value.input.projectId}:${value.id}`}
              workflow={value}
            />
          )}
          {props.renderQuickActions?.({
            disabled:
              actionBusy ||
              running ||
              pending ||
              pendingSourceRedoStart ||
              !capabilityReady ||
              props.startDisabled ||
              !settings.data,
            instruction,
            start: (instruction, selectionOnly = false) => {
              if (
                actionBusy ||
                running ||
                pending ||
                pendingSourceRedoStart ||
                props.startDisabled
              )
                return;
              void start(instruction, selectionOnly);
            },
          })}
          {!capabilityReady && (
            <p role="status" className="text-sm text-muted">
              当前创作能力未启用。已有要求和 AI
              草稿保留，可在扩展设置恢复对应功能。
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
          {displayValue?.output?.brief && (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                本次方案与目标
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {displayValue.output.brief}
              </p>
            </details>
          )}
          {value?.sources.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                引用资料 · {value.sources.length} 项
              </summary>
              <p className="mt-2 text-sm text-muted">
                本次来源与版本已保存；AI 草稿采用时再次核对。
              </p>
              {value.authorIntent && (
                <p
                  className="mt-2 text-sm"
                  data-creation-author-intent={value.authorIntent.state}
                >
                  {value.authorIntent.state === "adopted"
                    ? `作者意图 · v${value.authorIntent.version}（冻结版本）`
                    : "本轮开始时尚无正式作者意图；后来首次采用也会使此 AI 草稿失效。"}
                </p>
              )}
              {value.authorIntentBasis?.sourceBasis && (
                <div data-author-intent-source-coverage>
                  <p className="text-sm">
                    原明确允许范围与实际表达；未读取完整目录，不将解释来源章或所选段落计作全文已读。
                  </p>
                  <NarrativeSourceCoverage
                    basis={value.authorIntentBasis.sourceBasis}
                    chapters={value.authorIntentBasis.chapters ?? []}
                    label="AI 意图原冻结来源表达"
                  />
                </div>
              )}
              {value.productionNarrativeBasis && (
                <div data-production-source-coverage className="mt-2 space-y-2">
                  <p className="text-sm">
                    制作原冻结范围：
                    {value.productionNarrativeBasis.request.chapterScope
                      .mode === "none"
                      ? "明确不使用正文、段落或摘要"
                      : value.productionNarrativeBasis.request.chapterScope
                            .mode === "full"
                        ? "确认时的完整非空正文目录"
                        : "明确局部范围"}
                    ；
                    {value.productionNarrativeBasis.coverage.directoryState ===
                    "not-read"
                      ? "正文目录未读取，章节总数和未纳入章数未知，不以 0 冒充完整覆盖。"
                      : `实际纳入 ${value.productionNarrativeBasis.coverage.included.length} 章，未纳入 ${value.productionNarrativeBasis.coverage.excluded.length} 章（目录共 ${value.productionNarrativeBasis.coverage.totalChapterCount} 章）。`}
                    新来源选择不改变此运行；原输入重试仍用原冻结表达，采用或复检完成时核对实际来源。
                  </p>
                  <NarrativeSourceCoverage
                    basis={value.productionNarrativeBasis.sourceBasis}
                    chapters={value.productionNarrativeBasis.coverage.included}
                    label="制作运行实际来源表达"
                  />
                  {value.productionNarrativeBasis.contextBudget && (
                    <p className="text-xs text-muted">
                      完整首次提示估算{" "}
                      {
                        value.productionNarrativeBasis.contextBudget
                          .estimatedTokens
                      }{" "}
                      token / 预算{" "}
                      {value.productionNarrativeBasis.contextBudget.tokenBudget}{" "}
                      token；实际 usage 与费用未知。
                    </p>
                  )}
                </div>
              )}
              {value.narrativePlanningBasis && (
                <div data-planning-source-coverage className="mt-2 space-y-2">
                  <p className="text-sm">
                    规划原冻结范围：
                    {value.narrativePlanningBasis.request.chapterScope.mode ===
                    "none"
                      ? "明确不使用正文"
                      : value.narrativePlanningBasis.request.chapterScope
                            .mode === "full"
                        ? "确认时的完整非空正文目录"
                        : "明确局部范围"}
                    ；实际覆盖{" "}
                    {value.narrativePlanningBasis.coverage.included.length} 章，
                    未纳入{" "}
                    {value.narrativePlanningBasis.coverage.excluded.length} 章。
                    新选择不改变这一运行；原输入重试不换成最新来源，采用时仍核对原基准。
                  </p>
                  <NarrativeSourceCoverage
                    basis={value.narrativePlanningBasis.sourceBasis}
                    chapters={value.narrativePlanningBasis.coverage.included}
                    label="规划运行实际来源表达"
                  />
                  {value.narrativePlanningBasis.contextBudget && (
                    <p className="text-xs text-muted">
                      完整首次提示估算{" "}
                      {
                        value.narrativePlanningBasis.contextBudget
                          .estimatedTokens
                      }{" "}
                      token / 预算{" "}
                      {value.narrativePlanningBasis.contextBudget.tokenBudget}{" "}
                      token；实际 usage 与费用未知。
                    </p>
                  )}
                </div>
              )}
              {value.narrativeContextBasis && (
                <p className="mt-2 text-sm" data-novel-context-coverage>
                  前文明确纳入{" "}
                  {
                    new Set([
                      ...value.narrativeContextBasis.chapters.map(
                        (chapter) => chapter.id,
                      ),
                      ...(value.narrativeContextBasis.summaries ?? []).flatMap(
                        (summary) =>
                          summary.chapters.map((chapter) => chapter.id),
                      ),
                    ]).size
                  }{" "}
                  个不同章节，未纳入{" "}
                  {value.narrativeContextBasis.omitted.length} 章；直接表达中
                  {
                    value.narrativeContextBasis.chapters.filter(
                      (chapter) => chapter.representation === "original",
                    ).length
                  }{" "}
                  章完整原文，
                  {
                    value.narrativeContextBasis.chapters.filter(
                      (chapter) => chapter.representation === "summary",
                    ).length
                  }{" "}
                  章采用摘要，
                  {
                    value.narrativeContextBasis.chapters.filter(
                      (chapter) => chapter.representation === "paragraphs",
                    ).length
                  }{" "}
                  章所选段落。 摘要与片段不代表完整原文，覆盖不等于语义质量。
                  {value.narrativeContextBasis.contextBudget && (
                    <span className="block">
                      冻结上下文估算{" "}
                      {
                        value.narrativeContextBasis.contextBudget
                          .estimatedTokens
                      }{" "}
                      token / 预算{" "}
                      {value.narrativeContextBasis.contextBudget.tokenBudget}{" "}
                      token；实际 usage 与费用未知。
                    </span>
                  )}
                </p>
              )}
              <FrozenNarrativeStorySources
                sources={value.narrativeContextBasis?.story}
              />
              {value.narrativeContextBasis?.summaries?.map((summary) => (
                <details
                  key={summary.id}
                  className="break-all text-xs text-muted"
                >
                  <summary className="cursor-pointer">
                    高层摘要的原冻结章节版本
                  </summary>
                  <p>
                    高层采用摘要：{summary.scopeTitle} · {summary.id} v
                    {summary.version}； 原冻结覆盖 {summary.chapters.length}{" "}
                    章，不是当前全书原文。
                    {summary.scopeState === "stale"
                      ? "完整范围已变化，仅保留所选冻结范围。"
                      : ""}
                    编辑区新选择不改变这个运行。
                  </p>
                  {summary.chapters.map((chapter) => (
                    <p key={chapter.id}>
                      {chapter.id} v{chapter.version}
                    </p>
                  ))}
                </details>
              ))}
              {value.narrativeSummaryBasis && (
                <p className="text-xs text-muted">
                  实际冻结摘要范围：{value.narrativeSummaryBasis.scopeTitle}
                  ；完整纳入 {
                    value.narrativeSummaryBasis.references.length
                  }{" "}
                  个非空章节， 空章{" "}
                  {
                    value.narrativeSummaryBasis.directory.filter(
                      (chapter) => !chapter.hasContent,
                    ).length
                  }{" "}
                  个不算已读。 原文{" "}
                  {
                    value.narrativeSummaryBasis.references.filter(
                      (ref) => ref.representation === "original",
                    ).length
                  }{" "}
                  章， 已采用摘要{" "}
                  {
                    value.narrativeSummaryBasis.references.filter(
                      (ref) => ref.representation === "summary",
                    ).length
                  }{" "}
                  章；
                  编辑区新选择不改变这一运行的原冻结来源，引用与覆盖不保证语义概括正确。
                </p>
              )}
              {value.narrativeQualityBasis?.sourceBasis && (
                <div className="text-sm" data-quality-expression-context>
                  <p>
                    质量评议实际表达：原文{" "}
                    {
                      value.narrativeQualityBasis.sourceBasis.chapters.filter(
                        (chapter) => chapter.representation === "original",
                      ).length
                    }{" "}
                    章、章节摘要{" "}
                    {
                      value.narrativeQualityBasis.sourceBasis.chapters.filter(
                        (chapter) => chapter.representation === "summary",
                      ).length
                    }{" "}
                    章、段落{" "}
                    {
                      value.narrativeQualityBasis.sourceBasis.chapters.filter(
                        (chapter) => chapter.representation === "paragraphs",
                      ).length
                    }{" "}
                    章、高层摘要{" "}
                    {value.narrativeQualityBasis.sourceBasis.summaries
                      ?.length ?? 0}{" "}
                    条；覆盖并集不重复计章，摘要与段落不是全文评议。
                  </p>
                  {value.narrativeQualityBasis.sourceBasis.summaries?.map(
                    (summary) => (
                      <details key={summary.id} className="break-all">
                        <summary>质量摘要冻结身份与逐章版本</summary>
                        <p>
                          {summary.id} v{summary.version} · {summary.scopeTitle}
                        </p>
                        {summary.chapters.map((chapter) => (
                          <p key={chapter.id}>
                            {chapter.id} v{chapter.version}
                          </p>
                        ))}
                      </details>
                    ),
                  )}
                </div>
              )}
              {value.narrativeQualityBasis?.sourceBasis && (
                <NarrativeQualitySourceCoverage
                  basis={value.narrativeQualityBasis}
                />
              )}
              {(value.diagnosisBasis?.sourceBasis ||
                value.seasonPlanBasis?.sourceBasis) && (
                <NarrativeSourceCoverage
                  basis={
                    (value.diagnosisBasis?.sourceBasis ??
                      value.seasonPlanBasis?.sourceBasis)!
                  }
                  chapters={
                    (value.diagnosisBasis ?? value.seasonPlanBasis)!.chapters
                  }
                  label="改编运行实际来源表达"
                />
              )}
              <ul className="mt-2 space-y-2 text-sm text-muted">
                {value.contextEntries.map((entry, index) => (
                  <li key={index}>
                    <span className={entry.included ? "text-ink" : ""}>
                      {entry.title} · {entry.included ? "已纳入" : "未纳入"}
                    </span>
                    <p>
                      {entry.reason}
                      {entry.estimatedTokens !== undefined
                        ? ` · 估算 ${entry.estimatedTokens} token`
                        : ""}
                    </p>
                    {entry.sourceId && (
                      <p className="break-all">
                        来源 {entry.sourceId} · 版本 {entry.sourceVersion} ·{" "}
                        {entry.fieldPath}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {displayValue?.output && props.renderCandidate?.(displayValue)}
          {displayValue?.output &&
            !props.onCandidate &&
            !props.renderCandidate && (
              <article className="whitespace-pre-wrap text-sm leading-7">
                <h3 className="mb-2 font-semibold">
                  {displayValue.output.title || "AI 草稿方案"}
                </h3>
                {displayValue.output.content}
                {displayValue.output.items.map((item) => (
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
          {Boolean(displayValue?.issues.length) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">检查与修订</h3>
              {displayValue!.issues.map((issue, index) => (
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
                  <CreationIssueEvidence issue={issue} />
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
                window.localStorage.setItem(draftStorageKey, text);
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
              props.externalReview ||
              [
                "author-intent",
                "adaptation-diagnosis",
                "adaptation-strategy",
                "season-plan",
                "quality-review",
              ].includes(props.operation) ? (
                <p className="text-sm text-muted">
                  请在
                  <Link
                    className="text-link"
                    to={
                      props.operation === "author-intent"
                        ? `/projects/${props.projectId}/tools/author-intent?intentWorkflowId=${value!.id}${value?.authorIntentId ? `&intentId=${value.authorIntentId}` : ""}`
                        : props.operation === "adaptation-strategy"
                          ? `/projects/${props.projectId}/tools/adaptation-strategy?workflowId=${value!.id}${value?.adaptationStrategyId ? `&strategyId=${value.adaptationStrategyId}` : ""}`
                          : props.operation === "quality-review"
                            ? `/projects/${props.projectId}/tools/quality-review?workflowId=${value!.id}${value?.narrativeReportId ? `&reportId=${value.narrativeReportId}` : ""}`
                            : props.operation === "season-plan"
                              ? `/projects/${props.projectId}/tools/season-plan?workflowId=${value!.id}${value?.seasonPlanId ? `&seasonPlanId=${value.seasonPlanId}` : ""}`
                              : `/projects/${props.projectId}/tools/adaptation-diagnosis?workflowId=${value!.id}${value?.diagnosisId ? `&diagnosisId=${value.diagnosisId}` : ""}`
                    }
                  >
                    {props.operation === "author-intent"
                      ? "作者意图工作台"
                      : props.operation === "adaptation-strategy"
                        ? "独立策略 AI 草稿"
                        : props.operation === "quality-review"
                          ? "质量报告工作台"
                          : props.operation === "season-plan"
                            ? "整季方案 AI 草稿"
                            : "诊断候选"}
                  </Link>
                  {props.operation === "author-intent"
                    ? "中核对八字段差异与实际来源，再明确采用或放弃；不改原稿。"
                    : props.operation === "adaptation-strategy"
                      ? "中比较 2–3 个不同动作方案，再明确采用一个或放弃；不生成季纲或改原稿。"
                      : props.operation === "quality-review"
                        ? "中核对逐字证据与实际版本，再明确采用报告或放弃；不改正文。"
                        : props.operation === "season-plan"
                          ? "中核对来源覆盖与完整顺序，再明确采用或放弃。"
                          : "中比较策略，并明确选择一个策略后采用或放弃。"}
                </p>
              ) : (
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
              )
            ) : (
              <Button
                variant="primary"
                className="w-full"
                disabled={
                  actionBusy ||
                  !capabilityReady ||
                  props.startDisabled ||
                  pendingSourceRedoStart ||
                  (!props.renderQuickActions && !instruction.trim()) ||
                  !settings.data
                }
                onClick={() => void start()}
              >
                生成并检查{resultLabel}
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
                disabled={
                  actionBusy ||
                  !capabilityReady ||
                  props.startDisabled ||
                  pendingSourceRedoStart ||
                  !instruction.trim()
                }
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
                保留 AI 草稿重新检查
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
            按稳定块保留独立正文修改，并核对完整顺序；正文冲突与位置冲突分别选择。合并只产生复检
            AI 草稿，不自动采用。比较基准变化须重新打开，不自动换版本。
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
                    onChange={(event) => {
                      setScriptChoices((current) => ({
                        ...current,
                        [unit.id]: event.target.value as "main" | "branch",
                      }));
                      setScriptOrderConfirmed(false);
                    }}
                  >
                    <option value="" disabled>
                      请选择
                    </option>
                    <option value="main">保留当前块</option>
                    <option value="branch">采用 AI 草稿块</option>
                  </select>
                </section>
              ))}
            {scriptMerge && (
              <ScriptMergeOrderReview
                merge={scriptMerge}
                choices={scriptChoices}
                draft={scriptOrder}
                confirmed={scriptOrderConfirmed}
                busy={actionBusy}
                onOrder={(order) => {
                  setScriptOrder(order);
                  setScriptOrderConfirmed(false);
                }}
                onConfirm={setScriptOrderConfirmed}
              />
            )}
          </div>
          <Button
            disabled={
              actionBusy ||
              !scriptMerge ||
              Boolean(
                mergeRecovery &&
                mergeRecovery.storageKey === recoveryKey &&
                (mergeRecovery.request || mergeRecovery.error),
              ) ||
              scriptMerge.units.some(
                (unit) => unit.conflict && !scriptChoices[unit.id],
              ) ||
              ((scriptMerge.blockOrder?.conflict ||
                scriptOrder !== undefined) &&
                !scriptOrderConfirmed)
            }
            onClick={() =>
              void act(async () => {
                if (!value || !scriptMerge) return;
                if (!props.targetId || !recoveryKey)
                  throw new Error("缺少实际剧本归属。");
                if (window.localStorage.getItem(recoveryKey) !== null)
                  throw new Error("原合并请求尚未核对，不能替换为新请求。");
                const request = freezeScriptMergeRequest(
                  props.projectId,
                  props.targetId,
                  value.id,
                  {
                    baseVersion: scriptMerge.currentVersion,
                    choices: scriptChoices,
                    basis: scriptMerge.basis,
                    ...(scriptMerge.blockOrder?.conflict ||
                    scriptOrder !== undefined
                      ? {
                          blockOrder: completeScriptMergeOrder(
                            scriptOrder ?? scriptMerge.blockOrder!.proposed,
                            selectedScriptMergeIds(scriptMerge, scriptChoices),
                          ),
                        }
                      : {}),
                  },
                );
                window.localStorage.setItem(
                  recoveryKey,
                  JSON.stringify(request),
                );
                setMergeRecovery({ storageKey: recoveryKey, request });
                const next = await resendScriptMerge(client.creation, request);
                const cleared = clearExactScriptMergeRequest(
                  window.localStorage,
                  request,
                );
                if (
                  activeScope.current !== key ||
                  activeWorkflow.current !== value.id ||
                  !cleared
                )
                  return;
                setMergeRecovery({ storageKey: recoveryKey });
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
            不冲突的新增内容会自动保留。每处冲突都需要明确选择，关闭窗口会保留
            AI 草稿。
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
                    <NativeSelect
                      className="w-auto"
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
                      <option value="candidate">采用 AI 草稿</option>
                      <option value="both">依次保留两段</option>
                    </NativeSelect>
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
  resultLabel?: string;
  onApplied?(): void | Promise<void>;
}) {
  const client = useStudio();
  const [language, setLanguage] = useState("英语");
  const targetRead = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["resource", props.domain, props.targetId, props.projectId],
      queryFn: () => client.resources.get(props.domain, props.targetId),
      enabled: Boolean(props.targetId),
    }),
  );
  const { data: target, error } = targetRead;
  if (!target)
    return (
      <p role={error ? "alert" : "status"} className="text-sm text-muted">
        {error ? message(error) : "正在读取当前对象…"}
      </p>
    );
  if (
    target.id !== props.targetId ||
    target.domain !== props.domain ||
    target.projectId !== props.projectId
  )
    return (
      <p role="alert">指定创作对象的身份或项目归属不符，未打开 AI 草稿。</p>
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
        onPrepare={async () => {
          const current = await client.resources.get(
            props.domain,
            props.targetId,
          );
          if (
            current.id !== props.targetId ||
            current.domain !== props.domain ||
            current.projectId !== props.projectId
          )
            throw new Error("指定创作对象的身份或项目归属不符。");
          return current.version;
        }}
        baseVersion={target.version}
        language={props.operation === "localization" ? language : undefined}
      />
    </div>
  );
}

export function CreationRunCard(props: {
  id: string;
  projectId?: string;
  taskId?: string;
}) {
  const client = useStudio();
  const { data, error } = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["creation-workflow", props.id, props.projectId, props.taskId],
      queryFn: async () => {
        const workflow = CreationWorkflowSchema.parse(
          await client.creation.get(props.id),
        );
        if (
          workflow.id !== props.id ||
          (props.projectId && workflow.input.projectId !== props.projectId) ||
          (props.taskId && workflow.taskId !== props.taskId)
        )
          throw new Error(
            "指定创作运行的实际身份、项目或任务绑定不符；未打开 AI 草稿。",
          );
        return workflow;
      },
      refetchInterval: 1500,
      retry: false,
    }),
  );
  if (error)
    return (
      <p role="alert" className="text-sm text-danger-strong">
        {message(error)}
      </p>
    );
  if (!data)
    return (
      <p className="text-sm text-muted">
        {error ? message(error) : "正在读取创作运行…"}
      </p>
    );
  if (props.projectId && data.input.projectId !== props.projectId)
    return (
      <p role="alert" className="text-sm text-danger-strong">
        该创作运行不属于当前项目，未打开 AI 草稿。
      </p>
    );
  return (
    <CreationWorkbench
      key={props.id}
      workflowId={props.id}
      projectId={data.input.projectId}
      operation={data.input.operation}
      targetId={data.input.targetId}
      baseVersion={data.input.baseVersion}
      defaultInstruction={data.input.instruction}
      sourceIds={data.input.sourceIds}
      authorIntentRequest={data.input.authorIntentRequest}
      diagnosisRequest={data.input.diagnosisRequest}
      adaptationStrategyRequest={data.input.adaptationStrategyRequest}
      seasonPlanRequest={data.input.seasonPlanRequest}
      episodeDevelopmentRequest={data.input.episodeDevelopmentRequest}
      qualityReviewRequest={data.input.qualityReviewRequest}
      narrativeContextRequest={data.input.narrativeContextRequest}
      narrativePlanningRequest={data.input.narrativePlanningRequest}
      productionNarrativeRequest={data.input.productionNarrativeRequest}
      narrativeSummaryRequest={data.input.narrativeSummaryRequest}
      reviewPackageId={data.input.reviewPackageId}
      feedbackClusterId={data.input.feedbackClusterId}
      language={data.input.language}
      wordGoal={data.input.wordGoal}
      engineKind={data.input.engineKind}
      model={data.input.model}
    />
  );
}
