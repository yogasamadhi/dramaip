import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { Button } from "@dramaip/infra-ui-primitives";
import type { RenderFactorySlot } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/production-production/remote";
import { clsx } from "clsx";
import css from "./Creation.module.css";
import {
  CreationExecutionPanel,
  failureText,
  UsageObservations,
} from "./CreationExecution.tsx";
import { CreationProgress } from "./CreationProgress.tsx";
import { CreationSources } from "./CreationSources.tsx";
import { usePublishedEvents, type SystemRemote } from "./events.ts";
import {
  ChapterMergeDialog,
  mergedChapter,
  ScriptMergeDialog,
  type ChapterChoice,
  type ScriptChoice,
} from "./MergeDialogs.tsx";
import {
  creationWorkbenchScopeKey,
  matchesCreationWorkbenchPreview,
  matchesCreationWorkbenchWorkflow,
} from "./owner.ts";
import {
  clearExactScriptMergeRequest,
  clearExactStoryboardRedoStartRequest,
  completeScriptMergeOrder,
  freezeScriptMergeRequest,
  freezeStoryboardRedoStartRequest,
  parseScriptMergeRequest,
  parseStoryboardRedoStartRequest,
  readScriptMerge,
  resendScriptMerge,
  resendStoryboardRedoStart,
  saveStoryboardRedoStartRequest,
  scriptMergeStorageKey,
  selectedScriptMergeIds,
  storyboardRedoStartStorageKey,
  type ScriptMergeRequest,
  type StoryboardRedoStartRequest,
} from "./recovery.ts";
import {
  isDefiniteStartRejection,
  usePoll,
  value as answer,
  type AgentsRemote,
  type AutomationRemote,
  type ChangePreview,
  type ChapterMerge,
  type CreationInput,
  type CreationMerge,
  type CreationOperation,
  type CreationStage,
  type CreationWorkflow,
  type Translate,
  type WritingRemote,
} from "./remote.ts";
import { IssueEvidence } from "./SourceCoverage.tsx";

/** The `production` Remote namespace: the records a record workbench revises. */
export type ProductionRemote = Context["remote"]["production"];

/** The Remote namespaces a workbench reads and writes, injected by its registration. */
export interface CreationWorkbenchRemotes {
  automation: AutomationRemote;
  agents: AgentsRemote;
  writing: WritingRemote;
  system: SystemRemote;
}

/** The stages in which a run still works. */
const ACTIVE: ReadonlySet<CreationStage> = new Set([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
]);
const ENDED: ReadonlySet<CreationStage> = new Set([
  "failed",
  "canceled",
  "interrupted",
]);
/** Operations whose drafts are reviewed on their own tools page. */
const REVIEWED_ELSEWHERE: ReadonlySet<CreationOperation> = new Set([
  "author-intent",
  "adaptation-diagnosis",
  "adaptation-strategy",
  "season-plan",
  "quality-review",
]);
/** Operations that start from a chosen production narrative. */
const NEEDS_NARRATIVE: ReadonlySet<CreationOperation> = new Set([
  "episode",
  "script-revision",
  "review-check",
  "shot-prompt",
]);

/**
 * The plugin that owns the operation's target, which must be active for the
 * workbench to start or settle anything.
 * @param operation - the operation.
 */
function ownerOf(operation: CreationOperation): string {
  if (operation === "author-intent") return "workspace";
  if (operation === "quality-review") return "creative-quality";
  if (
    [
      "chapter",
      "story-setup",
      "characters",
      "book-outline",
      "chapter-outline",
      "story-arc",
      "creator-content",
    ].includes(operation)
  )
    return "writing";
  if (
    ["chapter-memory", "knowledge-plan", "narrative-summary"].includes(
      operation,
    )
  )
    return "knowledge";
  if (["delivery-copy", "localization"].includes(operation)) return "delivery";
  return "production";
}

/** The run's project AI settings the workbench reads. */
interface EngineSettings {
  defaultEngineKind: CreationInput["engineKind"];
  defaultModel?: CreationInput["model"];
}

/** The runtime graph's plugin states. */
interface RuntimeInfo {
  plugins: readonly { id: string; status: string }[];
}

/** The production narrative a source selector settled on. */
export interface NarrativeSelection {
  request?: CreationInput["productionNarrativeRequest"];
  startDisabled: boolean;
}

/** Props of the production source selector a new production run starts from. */
export interface NarrativeSourcesProps {
  projectId: string;
  storageKey: string;
  legacySourceIds?: string[] | undefined;
  disabled?: boolean | undefined;
  children: (selection: NarrativeSelection) => ReactNode;
}

/** What the caller decides about a workbench: the run's scope and its hooks. */
export interface CreationWorkbenchProps {
  projectId: string;
  workflowId?: string | undefined;
  operation: CreationOperation;
  targetId?: string | undefined;
  baseVersion?: number | undefined;
  sourceIds?: string[] | undefined;
  productionNarrativeRequest?: CreationInput["productionNarrativeRequest"];
  diagnosisRequest?: CreationInput["diagnosisRequest"];
  adaptationStrategyRequest?: CreationInput["adaptationStrategyRequest"];
  seasonPlanRequest?: CreationInput["seasonPlanRequest"];
  episodeDevelopmentRequest?: CreationInput["episodeDevelopmentRequest"];
  qualityReviewRequest?: CreationInput["qualityReviewRequest"];
  narrativeContextRequest?: CreationInput["narrativeContextRequest"];
  narrativePlanningRequest?: CreationInput["narrativePlanningRequest"];
  narrativePlanningRequired?: boolean | undefined;
  startDisabled?: boolean | undefined;
  narrativeSummaryRequest?: CreationInput["narrativeSummaryRequest"];
  authorIntentRequest?: CreationInput["authorIntentRequest"];
  /** The draft is reviewed somewhere else; the workbench offers no adoption. */
  externalReview?: boolean | undefined;
  reviewPackageId?: string | undefined;
  feedbackClusterId?: string | undefined;
  language?: string | undefined;
  defaultInstruction?: string | undefined;
  resultLabel?: string | undefined;
  wordGoal?: number | undefined;
  docked?: boolean | undefined;
  disabled?: boolean | undefined;
  engineKind?: CreationInput["engineKind"];
  model?: CreationInput["model"];
  renderQuickActions?:
    | ((controls: {
        disabled: boolean;
        instruction: string;
        start(instruction: string, selectionOnly?: boolean): void;
      }) => ReactNode)
    | undefined;
  /** Re-read the target before a start or an adoption; answers its version. */
  onPrepare?: (() => Promise<number>) | undefined;
  onCandidate?:
    ((workflow: CreationWorkflow, preview: ChangePreview) => void) | undefined;
  onStarted?: ((workflow: CreationWorkflow) => void) | undefined;
  renderCandidate?: ((workflow: CreationWorkflow) => ReactNode) | undefined;
  onDiscarded?: ((preview: ChangePreview) => void) | undefined;
  /** Adopt the draft the caller's way; false keeps it pending. */
  onAdopt?: ((preview: ChangePreview) => Promise<boolean>) | undefined;
  selectedText?: string | undefined;
  onApplied?: (() => void | Promise<void>) | undefined;
  onContinue?: (() => void | Promise<void>) | undefined;
}

/** Full props of a workbench as its registration renders it. */
export type CreationWorkbenchViewProps = CreationWorkbenchProps &
  CreationWorkbenchRemotes & {
    t: Translate;
    renderFactorySlot: RenderFactorySlot;
  };

/**
 * One AI creation workbench: the run its scope names or the latest one, its
 * progress, sources, draft and checks, and the actions that start, stop,
 * retry, adopt or discard it. A new production run without a chosen
 * narrative first asks the production source selector for one.
 */
export function CreationWorkbench(props: CreationWorkbenchViewProps) {
  const render = (selection?: NarrativeSelection) => (
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
    NEEDS_NARRATIVE.has(props.operation)
  ) {
    const scope = `${props.projectId}:${props.operation}:${props.targetId ?? "project"}:${JSON.stringify(props.sourceIds ?? [])}`;
    return (
      <div key={scope}>
        {props.renderFactorySlot(
          "production.narrative-sources",
          {
            projectId: props.projectId,
            legacySourceIds: props.sourceIds,
            disabled: props.disabled,
            storageKey: `dramaip-production-source-choice:${scope}`,
            children: render,
          },
          {
            fallback: (
              <p role="status" className={css.muted}>
                {props.t("workbench.sourcesUnavailable")}
              </p>
            ),
          },
        )}
      </div>
    );
  }
  return render();
}

/** One start, action or merge's idempotency keys, by what it sends. */
function useRequestKeys(scope: string) {
  const keys = useRef(new Map<string, string>());
  const fingerprint = (request: unknown) => JSON.stringify({ scope, request });
  return {
    /** The key of this exact request, kept until a settled action clears it. */
    of(request: unknown): string {
      const id = fingerprint(request);
      const existing = keys.current.get(id);
      if (existing) return existing;
      const created = crypto.randomUUID();
      keys.current.set(id, created);
      return created;
    },
    /** Free one request's key once its rejection proves nothing started. */
    release(request: unknown, key: string) {
      const id = fingerprint(request);
      if (keys.current.get(id) === key) keys.current.delete(id);
    },
    clear() {
      keys.current.clear();
    },
  };
}

const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, text: string) => {
  try {
    window.localStorage.setItem(key, text);
  } catch {
    // The draft stays in memory; nothing else depends on it being kept.
  }
};

/** The link to the tools page that reviews a draft, and its copy. */
function reviewLink(
  operation: CreationOperation,
  projectId: string,
  value: CreationWorkflow,
): { href: string; label: string; hint: string } {
  const page = (tool: string, query: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [name, item] of Object.entries(query))
      if (item !== undefined) search.set(name, item);
    return `#/projects/${projectId}/tools/${tool}?${search.toString()}`;
  };
  switch (operation) {
    case "author-intent":
      return {
        href: page("author-intent", {
          intentWorkflowId: value.id,
          intentId: value.authorIntentId,
        }),
        label: "review.intent",
        hint: "review.intent.hint",
      };
    case "adaptation-strategy":
      return {
        href: page("adaptation-strategy", {
          workflowId: value.id,
          strategyId: value.adaptationStrategyId,
        }),
        label: "review.strategy",
        hint: "review.strategy.hint",
      };
    case "quality-review":
      return {
        href: page("quality-review", {
          workflowId: value.id,
          reportId: value.narrativeReportId,
        }),
        label: "review.quality",
        hint: "review.quality.hint",
      };
    case "season-plan":
      return {
        href: page("season-plan", {
          workflowId: value.id,
          seasonPlanId: value.seasonPlanId,
        }),
        label: "review.season",
        hint: "review.season.hint",
      };
    default:
      return {
        href: page("adaptation-diagnosis", {
          workflowId: value.id,
          diagnosisId: value.diagnosisId,
        }),
        label: "review.diagnosis",
        hint: "review.diagnosis.hint",
      };
  }
}

function CreationWorkbenchInstance(props: CreationWorkbenchViewProps) {
  const { automation, agents, writing, system, t } = props;
  const runtime = usePoll(
    "runtime",
    () => answer<RuntimeInfo>(system.runtime()),
    { interval: 3000 },
  );
  const capabilityReady = [
    "automation",
    "agents",
    "creative-quality",
    ownerOf(props.operation),
    ...(props.reviewPackageId ? ["review"] : []),
    ...(props.feedbackClusterId ? ["insights"] : []),
  ].every((id) =>
    runtime.data?.plugins.some(
      (plugin) => plugin.id === id && plugin.status === "active",
    ),
  );
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
  const scope = { ...props, sourceIds: props.sourceIds ?? [] };
  const requestKeys = useRequestKeys(key);

  const operationLabel = t(`operation.${props.operation}`);
  const defaultText =
    props.defaultInstruction ??
    t("workbench.defaultInstruction", { label: operationLabel });
  const resultLabel = props.resultLabel ?? operationLabel;
  const storedDraft = () =>
    readStorage(draftStorageKey) ??
    (props.renderQuickActions ? "" : defaultText);
  const [draft, setDraft] = useState(() => ({ key, value: storedDraft() }));
  const instruction = draft.key === key ? draft.value : storedDraft();

  const [selected, setSelected] = useState<{ key: string; id: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [merge, setMerge] = useState<{
    data: ChapterMerge;
    preview: ChangePreview;
    continueNext: boolean;
  }>();
  const [mergeChoices, setMergeChoices] = useState<
    Record<string, ChapterChoice>
  >({});
  const [scriptMerge, setScriptMerge] = useState<CreationMerge>();
  const [scriptChoices, setScriptChoices] = useState<
    Record<string, ScriptChoice>
  >({});
  const [scriptOrder, setScriptOrder] = useState<string[]>();
  const [scriptOrderConfirmed, setScriptOrderConfirmed] = useState(false);
  const activeScope = useRef(key);
  activeScope.current = key;
  useEffect(() => {
    setError(undefined);
    setMerge(undefined);
    setScriptMerge(undefined);
    setScriptOrder(undefined);
    setScriptOrderConfirmed(false);
  }, [key]);

  // A storyboard redo from a source review keeps its whole start request on
  // this device until its receipt is checked.
  const redoKey = props.episodeDevelopmentRequest?.redoSourceReview
    ? storyboardRedoStartStorageKey(
        props.projectId,
        props.episodeDevelopmentRequest.episodeId,
      )
    : undefined;
  const [redoRecovery, setRedoRecovery] = useState<{
    storageKey: string;
    request?: StoryboardRedoStartRequest;
    error?: string;
  }>();
  useEffect(() => {
    if (!redoKey || !props.episodeDevelopmentRequest) {
      setRedoRecovery(undefined);
      return;
    }
    try {
      const request = parseStoryboardRedoStartRequest(
        readStorage(redoKey),
        props.projectId,
        props.episodeDevelopmentRequest.episodeId,
      );
      setRedoRecovery({
        storageKey: redoKey,
        ...(request ? { request } : {}),
      });
    } catch (cause) {
      setRedoRecovery({ storageKey: redoKey, error: failureText(t, cause) });
    }
  }, [
    redoKey,
    key,
    props.projectId,
    props.episodeDevelopmentRequest?.episodeId,
  ]);

  // A script merge keeps its request likewise.
  const mergeKey =
    props.operation === "script-revision" && props.targetId
      ? scriptMergeStorageKey(props.projectId, props.targetId)
      : undefined;
  const [mergeRecovery, setMergeRecovery] = useState<{
    storageKey: string;
    request?: ScriptMergeRequest;
    error?: string;
    raw?: string;
  }>();
  useEffect(() => {
    if (!mergeKey || !props.targetId) {
      setMergeRecovery(undefined);
      return;
    }
    const raw = readStorage(mergeKey);
    try {
      const request = parseScriptMergeRequest(
        raw,
        props.projectId,
        props.targetId,
      );
      setMergeRecovery({
        storageKey: mergeKey,
        ...(request ? { request } : {}),
      });
    } catch (cause) {
      setMergeRecovery({
        storageKey: mergeKey,
        error: failureText(t, cause),
        ...(raw === null ? {} : { raw }),
      });
    }
  }, [mergeKey, props.projectId, props.targetId]);

  const callbacks = useRef(props);
  callbacks.current = props;
  const delivered = useRef<string | undefined>(undefined);

  const settings = usePoll(`settings:${props.projectId}`, () =>
    answer<EngineSettings>(agents.enginesGetProjectSettings(props.projectId)),
  );
  const list = usePoll(
    `list:${props.projectId}:${props.targetId ?? ""}`,
    async () => {
      const page = await answer<{ items: CreationWorkflow[] }>(
        automation.creationList({
          projectId: props.projectId,
          ...(props.targetId ? { targetId: props.targetId } : {}),
        }),
      );
      const ids = new Set<string>();
      for (const item of page.items) {
        if (
          item.input.projectId !== props.projectId ||
          ids.has(item.id) ||
          (props.targetId && item.input.targetId !== props.targetId)
        )
          throw new Error(t("workbench.listForeign"));
        ids.add(item.id);
      }
      return page;
    },
    { interval: 1500 },
  );
  const latest = list.data?.items
    .filter(
      (item) =>
        !item.recordMergeSource &&
        matchesCreationWorkbenchWorkflow(item, scope),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const id =
    selected?.key === key ? selected.id : (props.workflowId ?? latest?.id);
  const current = usePoll(
    `workflow:${id ?? ""}`,
    async () => {
      const result = await answer<CreationWorkflow>(
        automation.creationGet(id!),
      );
      if (
        !matchesCreationWorkbenchWorkflow(result, { ...scope, workflowId: id! })
      )
        throw new Error(t("workbench.workflowForeign"));
      return result;
    },
    {
      enabled: Boolean(id),
      interval: (data) => (data && ACTIVE.has(data.stage) ? 500 : 1500),
    },
  );
  const value =
    id &&
    matchesCreationWorkbenchWorkflow(current.data, { ...scope, workflowId: id })
      ? current.data
      : undefined;
  const activeWorkflow = useRef(value?.id);
  activeWorkflow.current = value?.id;
  const running = Boolean(value && ACTIVE.has(value.stage));
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (running && contentRef.current) contentRef.current.scrollTop = 0;
  }, [id, running]);

  const preview = usePoll(
    `preview:${value?.previewId ?? ""}`,
    async () => {
      const result = await answer<ChangePreview>(
        automation.changePreviewsGet(value!.previewId!),
      );
      if (!matchesCreationWorkbenchPreview(result, value))
        throw new Error(t("workbench.previewForeign"));
      return result;
    },
    { enabled: Boolean(value?.previewId), interval: 1500 },
  );
  usePublishedEvents(system, (event) => {
    if (
      event.type !== "automation.creation-updated.v1" ||
      !event.payload ||
      typeof event.payload !== "object"
    )
      return;
    const payload = event.payload as Record<string, unknown>;
    if (payload.projectId !== props.projectId) return;
    list.refresh();
    if (payload.id === id) current.refresh();
  });
  // The run can read while its declared preview fails; keep the run's status
  // but show no draft or evidence until this mount verified that preview.
  const displayValue =
    value?.previewId && !matchesCreationWorkbenchPreview(preview.data, value)
      ? undefined
      : value;
  useEffect(() => {
    if (
      !value?.output ||
      !preview.data ||
      current.fetching ||
      preview.fetching ||
      !matchesCreationWorkbenchPreview(preview.data, value)
    )
      return;
    const mark = `${key}:${preview.data.id}:${preview.data.status}`;
    if (delivered.current === mark) return;
    delivered.current = mark;
    if (preview.data.status === "pending")
      callbacks.current.onCandidate?.(value, preview.data);
    if (preview.data.status === "committed")
      void callbacks.current.onApplied?.();
    if (preview.data.status === "discarded")
      callbacks.current.onDiscarded?.(preview.data);
  }, [key, value, preview.data, current.fetching, preview.fetching]);

  const pending = preview.data?.status === "pending";
  const ownerReadBlocked = Boolean(
    (id && (current.fetching || current.error || !value)) ||
    (value?.previewId &&
      (preview.fetching ||
        preview.error ||
        !preview.data ||
        !matchesCreationWorkbenchPreview(preview.data, value))) ||
    (!props.workflowId &&
      selected?.key !== key &&
      (list.fetching || list.error || !list.data)),
  );
  const actionBusy = busy || Boolean(props.disabled) || ownerReadBlocked;
  const redoWaiting = Boolean(
    redoRecovery &&
    redoRecovery.storageKey === redoKey &&
    (redoRecovery.request || redoRecovery.error),
  );
  const mergeWaiting = Boolean(
    mergeRecovery &&
    mergeRecovery.storageKey === mergeKey &&
    (mergeRecovery.request || mergeRecovery.error),
  );

  const refresh = () => {
    list.refresh();
    current.refresh();
    preview.refresh();
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy || props.disabled || ownerReadBlocked) return;
    if (!capabilityReady) {
      setError(t("workbench.capabilityMissing"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await work();
      if (activeScope.current === key) {
        requestKeys.clear();
        refresh();
      }
    } catch (cause) {
      if (activeScope.current === key) setError(failureText(t, cause));
    } finally {
      setBusy(false);
    }
  };
  const started = (workflow: CreationWorkflow) => {
    setSelected({ key, id: workflow.id });
    props.onStarted?.(workflow);
  };

  const start = (actionInstruction?: string, selectionOnly = true) =>
    act(async () => {
      if (
        props.startDisabled ||
        (props.narrativePlanningRequired && !props.narrativePlanningRequest)
      )
        throw new Error(t("workbench.planningRequired"));
      if (!settings.data) throw new Error(t("workbench.settingsLoading"));
      const version = props.onPrepare
        ? await props.onPrepare()
        : props.targetId &&
            (props.operation === "chapter" ||
              props.operation === "chapter-memory")
          ? (
              await answer<{ version: number }>(
                writing.chaptersGet(props.targetId),
              )
            ).version
          : props.baseVersion;
      const requested = actionInstruction
        ? [actionInstruction, instruction.trim()]
            .filter(Boolean)
            .join(t("workbench.instruction.extra"))
        : instruction.trim() || defaultText;
      // A run the owner answered may have come from elsewhere with its own
      // narrative scope; a new draft keeps that scope rather than dropping it.
      const productionNarrativeRequest =
        props.productionNarrativeRequest ??
        value?.input.productionNarrativeRequest;
      const model =
        props.model &&
        props.model.modelId !== settings.data.defaultModel?.modelId
          ? props.model
          : settings.data.defaultModel
            ? { ...settings.data.defaultModel, ...props.model }
            : props.model;
      const input = Object.fromEntries(
        Object.entries({
          projectId: props.projectId,
          operation: props.operation,
          targetId: props.targetId,
          baseVersion: version,
          instruction:
            selectionOnly && props.selectedText
              ? `${requested}${t("workbench.instruction.selection")}${props.selectedText}`
              : requested,
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
          model,
        }).filter(([, item]) => item !== undefined),
      ) as CreationInput;
      if (redoKey) {
        const original = freezeStoryboardRedoStartRequest(input);
        saveStoryboardRedoStartRequest(window.localStorage, original);
        setRedoRecovery({ storageKey: redoKey, request: original });
        const created = await resendStoryboardRedoStart(automation, original);
        if (
          !clearExactStoryboardRedoStartRequest(window.localStorage, original)
        )
          throw new Error(t("workbench.redo.changed"));
        if (activeScope.current !== key) return;
        setRedoRecovery({ storageKey: redoKey });
        started(created);
        return;
      }
      const request = ["start", input];
      const idempotencyKey = requestKeys.of(request);
      const created = await answer<CreationWorkflow>(
        automation.creationStart(input, undefined, idempotencyKey),
      ).catch((cause: unknown) => {
        if (isDefiniteStartRejection(cause))
          requestKeys.release(request, idempotencyKey);
        throw cause;
      });
      started(created);
    });

  const action = (kind: "cancel" | "retry" | "continue") =>
    act(async () => {
      const result = await answer<CreationWorkflow>(
        automation.creationAction(
          value!.id,
          { action: kind },
          undefined,
          requestKeys.of([kind, value!.id]),
        ),
      );
      started(result);
    });

  const commit = async (candidate: ChangePreview, continueNext: boolean) => {
    if (props.onAdopt) {
      if (!(await props.onAdopt(candidate))) return;
    } else
      await answer(
        automation.changePreviewsCommit(
          candidate.id,
          undefined,
          requestKeys.of(["commit", candidate.id]),
        ),
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
          await answer<CreationMerge>(automation.creationMerge(value.id)),
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
        const data = await answer<ChapterMerge>(
          automation.changePreviewsMerge(candidate.id),
        );
        if (data.currentVersion !== target.baseVersion) {
          if (data.segments.some((item) => item.conflict)) {
            setMerge({ data, preview: candidate, continueNext });
            setMergeChoices({});
            return;
          }
          candidate = await answer<ChangePreview>(
            automation.changePreviewsRebase(
              candidate.id,
              {
                baseVersion: data.currentVersion,
                content: data.segments.map((item) => item.content).join(""),
              },
              undefined,
              requestKeys.of(["chapter-rebase", candidate.id, data]),
            ),
          );
        }
      }
      await commit(candidate, continueNext);
    });

  const discard = () =>
    act(() =>
      answer(
        automation.changePreviewsDiscard(
          preview.data!.id,
          undefined,
          crypto.randomUUID(),
        ),
      ),
    );

  const resendRedo = () =>
    act(async () => {
      const request = redoRecovery!.request!;
      if (readStorage(redoKey!) !== JSON.stringify(request))
        throw new Error(t("workbench.redo.storageChanged"));
      const result = await resendStoryboardRedoStart(automation, request);
      if (!clearExactStoryboardRedoStartRequest(window.localStorage, request))
        throw new Error(t("workbench.redo.receiptMismatch"));
      if (activeScope.current !== key) return;
      setRedoRecovery({ storageKey: redoKey! });
      started(result);
    });

  const resendMerge = () =>
    act(async () => {
      const request = mergeRecovery!.request!;
      const next = await resendScriptMerge(automation, request);
      const cleared = clearExactScriptMergeRequest(
        window.localStorage,
        request,
      );
      if (activeScope.current !== key || !cleared) return;
      setMergeRecovery({ storageKey: mergeKey! });
      setSelected({ key, id: next.id });
      setScriptMerge(undefined);
    });

  const dropMergeRecord = () => {
    const request = mergeRecovery!.request;
    if (
      request
        ? !clearExactScriptMergeRequest(window.localStorage, request)
        : mergeRecovery!.raw === undefined ||
          readStorage(mergeKey!) !== mergeRecovery!.raw
    ) {
      setError(t("workbench.merge.dropChanged"));
      return;
    }
    if (!request) window.localStorage.removeItem(mergeKey!);
    setMergeRecovery({ storageKey: mergeKey! });
  };

  const mergeScript = () =>
    act(async () => {
      if (!value || !scriptMerge) return;
      if (!props.targetId || !mergeKey)
        throw new Error(t("workbench.merge.noTarget"));
      if (readStorage(mergeKey) !== null)
        throw new Error(t("workbench.merge.unchecked"));
      const reorder =
        scriptMerge.blockOrder?.conflict || scriptOrder !== undefined;
      const request = freezeScriptMergeRequest(
        props.projectId,
        props.targetId,
        value.id,
        {
          baseVersion: scriptMerge.currentVersion,
          choices: scriptChoices,
          ...(scriptMerge.basis ? { basis: scriptMerge.basis } : {}),
          ...(reorder
            ? {
                blockOrder: completeScriptMergeOrder(
                  scriptOrder ?? scriptMerge.blockOrder!.proposed,
                  selectedScriptMergeIds(scriptMerge, scriptChoices),
                ),
              }
            : {}),
        },
      );
      window.localStorage.setItem(mergeKey, JSON.stringify(request));
      setMergeRecovery({ storageKey: mergeKey, request });
      const next = await resendScriptMerge(automation, request);
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
      setMergeRecovery({ storageKey: mergeKey });
      setSelected({ key, id: next.id });
      setScriptMerge(undefined);
    });

  const mergeChapter = () =>
    act(async () => {
      if (!merge) return;
      const content = mergedChapter(merge.data, mergeChoices);
      const candidate = await answer<ChangePreview>(
        automation.changePreviewsRebase(
          merge.preview.id,
          { baseVersion: merge.data.currentVersion, content },
          undefined,
          requestKeys.of([
            "chapter-rebase",
            merge.preview.id,
            merge.data.currentVersion,
            content,
          ]),
        ),
      );
      setMerge(undefined);
      await commit(candidate, merge.continueNext);
    });

  const readFailure = current.error ?? preview.error;
  const failure =
    value?.error ?? error ?? readFailure ?? settings.error ?? list.error;
  const stageText = value
    ? value.input.operation === "review-check" && value.stage === "applied"
      ? t("stage.rechecked")
      : t(`stage.${value.stage}`)
    : t("stage.ready");
  const startBlocked =
    actionBusy || running || pending || redoWaiting || !capabilityReady;

  return (
    <>
      <section
        aria-label={t("workbench.aria", { label: resultLabel })}
        className={clsx(css.workbench, props.docked && css.docked)}
      >
        <header className={css.header}>
          <h2 className={css.title}>
            {t("workbench.title", { label: resultLabel })}
          </h2>
          <span className={css.muted} role="status" aria-live="polite">
            {stageText}
          </span>
        </header>
        <div ref={contentRef} className={css.body}>
          {props.operation === "episode" && (
            <p className={clsx(css.block, css.muted)}>
              {t("workbench.episodeLegacy")}
            </p>
          )}
          {redoWaiting && redoRecovery && (
            <section
              aria-label={t("workbench.redo.aria")}
              className={css.block}
            >
              <p className={css.text}>{t("workbench.redo.note")}</p>
              {redoRecovery.error && (
                <p role="alert" className={css.danger}>
                  {t("workbench.redo.unreadable", {
                    error: redoRecovery.error,
                  })}
                </p>
              )}
              {redoRecovery.request && (
                <>
                  <p className={clsx(css.text, css.breakAll)}>
                    {t("workbench.redo.request", {
                      key: redoRecovery.request.key,
                      attribution:
                        redoRecovery.request.input.episodeDevelopmentRequest
                          ?.redoSourceReview?.attribution.id ?? "",
                    })}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      actionBusy ||
                      !capabilityReady ||
                      creationWorkbenchScopeKey(redoRecovery.request.input) !==
                        key
                    }
                    onClick={() => void resendRedo()}
                  >
                    {t("workbench.redo.resend")}
                  </Button>
                </>
              )}
            </section>
          )}
          {mergeWaiting && mergeRecovery && (
            <section
              aria-label={t("workbench.merge.aria")}
              className={css.block}
            >
              <p className={css.text}>{t("workbench.merge.note")}</p>
              {mergeRecovery.error && (
                <p role="alert" className={css.danger}>
                  {t("workbench.merge.unreadable", {
                    error: mergeRecovery.error,
                  })}
                </p>
              )}
              {mergeRecovery.request && (
                <>
                  <p className={clsx(css.text, css.breakAll)}>
                    {t("workbench.merge.request", {
                      workflowId: mergeRecovery.request.workflowId,
                      version: mergeRecovery.request.input.baseVersion,
                      key: mergeRecovery.request.key,
                    })}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionBusy || !capabilityReady}
                    onClick={() => void resendMerge()}
                  >
                    {t("workbench.merge.resend")}
                  </Button>
                </>
              )}
              <p className={css.text}>{t("workbench.merge.dropNote")}</p>
              <Button size="sm" disabled={actionBusy} onClick={dropMergeRecord}>
                {t("workbench.merge.drop")}
              </Button>
            </section>
          )}
          {id && current.fetching && (
            <p role="status" className={css.muted}>
              {t(
                value
                  ? "workbench.rechecking.kept"
                  : "workbench.rechecking.none",
              )}
            </p>
          )}
          {failure !== undefined && (
            <div role="alert" className={css.alert}>
              <p className={css.text}>{failure}</p>
              <p className={css.text}>
                {t(
                  readFailure !== undefined
                    ? "workbench.failure.read"
                    : "workbench.failure.kept",
                )}
              </p>
              <a className={css.link} href="#/settings?setup=ai">
                {t("workbench.checkConnection")}
              </a>
            </div>
          )}
          {value && (running || ENDED.has(value.stage)) && (
            <CreationProgress
              key={`${value.id}:${value.runId ?? "preparing"}`}
              agents={agents}
              system={system}
              t={t}
              value={value}
            />
          )}
          {value?.runId && (
            <UsageObservations
              key={`${value.input.projectId}:${value.runId}`}
              agents={agents}
              t={t}
              runId={value.runId}
              projectId={value.input.projectId}
            />
          )}
          {value && (
            <CreationExecutionPanel
              key={`${value.input.projectId}:${value.id}`}
              automation={automation}
              agents={agents}
              t={t}
              workflow={value}
            />
          )}
          {props.renderQuickActions?.({
            disabled:
              startBlocked || Boolean(props.startDisabled) || !settings.data,
            instruction,
            start: (text, selectionOnly = false) => {
              if (
                actionBusy ||
                running ||
                pending ||
                redoWaiting ||
                props.startDisabled
              )
                return;
              void start(text, selectionOnly);
            },
          })}
          {!capabilityReady && (
            <p role="status" className={css.muted}>
              {t("workbench.capabilityOff")}
            </p>
          )}
          {!value && !props.renderQuickActions && (
            <p className={css.muted}>{t("workbench.intro")}</p>
          )}
          {value && <p className={css.text}>{value.input.instruction}</p>}
          {props.selectedText && (
            <blockquote className={css.selection}>
              {t("workbench.selected", {
                text: props.selectedText.slice(0, 500),
              })}
            </blockquote>
          )}
          {displayValue?.output?.brief && (
            <details open>
              <summary className={css.summary}>{t("workbench.brief")}</summary>
              <p className={css.prose}>{displayValue.output.brief}</p>
            </details>
          )}
          {value && <CreationSources workflow={value} t={t} />}
          {displayValue?.output && props.renderCandidate?.(displayValue)}
          {displayValue?.output &&
            !props.onCandidate &&
            !props.renderCandidate && (
              <article className={css.prose}>
                <h3 className={css.heading}>
                  {displayValue.output.title || t("workbench.draftTitle")}
                </h3>
                {displayValue.output.content}
                {(displayValue.output.items ?? []).map((item) => (
                  <details key={item.ref} className={css.block}>
                    <summary>{item.title}</summary>
                    <dl className={css.dl}>
                      {Object.entries(item.data).map(([label, detail]) => (
                        <div key={label}>
                          <dt>{label}</dt>
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
              <summary className={css.summary}>
                {t("workbench.adoptionCheck")}
              </summary>
              <CreationRunCard
                automation={automation}
                agents={agents}
                writing={writing}
                system={system}
                t={t}
                renderFactorySlot={props.renderFactorySlot}
                id={value.adoptionCheckId}
              />
            </details>
          )}
          {value?.adoptionCheckError && (
            <p role="alert" className={css.danger}>
              {t("workbench.adoptionCheckFailed", {
                error: value.adoptionCheckError,
              })}
            </p>
          )}
          {value?.memoryState && (
            <p className={css.status} role="status">
              {value.memoryState === "synced" ||
              value.memoryState === "running" ||
              value.memoryState === "review-required"
                ? t(`workbench.memory.${value.memoryState}`)
                : t("workbench.memory.other", {
                    detail: value.memoryError ?? t("workbench.memory.failed"),
                  })}
            </p>
          )}
          {Boolean(displayValue?.issues.length) && (
            <div className={css.stack}>
              <h3 className={css.heading}>{t("workbench.issues")}</h3>
              {displayValue!.issues.map((issue, index) => (
                <article key={index} className={css.block}>
                  <p className={css.heading}>{issue.message}</p>
                  <p className={css.muted}>
                    {issue.location} ·{" "}
                    {t(
                      issue.source === "rule"
                        ? "workbench.issue.rule"
                        : "workbench.issue.model",
                    )}
                  </p>
                  {issue.evidence && (
                    <blockquote className={css.evidence}>
                      {issue.evidence}
                    </blockquote>
                  )}
                  <p className={css.text}>{issue.suggestion}</p>
                  <IssueEvidence issue={issue} t={t} />
                </article>
              ))}
            </div>
          )}
        </div>
        <footer className={css.footer}>
          <label className={css.label}>
            {t(
              props.renderQuickActions
                ? "workbench.instruction.optional"
                : value?.output
                  ? "workbench.instruction.revise"
                  : "workbench.instruction.goal",
            )}
            <textarea
              aria-label={t("workbench.instruction.aria")}
              className={clsx(
                css.textarea,
                props.renderQuickActions && css.short,
              )}
              rows={props.renderQuickActions ? 2 : 3}
              placeholder={
                props.renderQuickActions
                  ? t("workbench.instruction.placeholder")
                  : undefined
              }
              value={instruction}
              onChange={(event) => {
                const text = event.target.value;
                setDraft({ key, value: text });
                writeStorage(draftStorageKey, text);
                requestKeys.clear();
              }}
            />
          </label>
          <div className={css.actions}>
            {running ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actionBusy || !capabilityReady}
                onClick={() => void action("cancel")}
              >
                {t("workbench.cancel")}
              </Button>
            ) : pending ? (
              props.externalReview ||
              REVIEWED_ELSEWHERE.has(props.operation) ? (
                (() => {
                  const link = reviewLink(
                    props.operation,
                    props.projectId,
                    value!,
                  );
                  return (
                    <p className={css.muted}>
                      {t("workbench.review.before")}
                      <a className={css.link} href={link.href}>
                        {t(link.label as "review.intent")}
                      </a>
                      {t(link.hint as "review.intent.hint")}
                    </p>
                  );
                })()
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={actionBusy || !capabilityReady}
                    onClick={() => void adopt(false)}
                  >
                    {t("workbench.adopt")}
                  </Button>
                  {props.onContinue && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionBusy || !capabilityReady}
                      onClick={() => void adopt(true)}
                    >
                      {t("workbench.adoptNext")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={actionBusy || !capabilityReady}
                    onClick={() => void discard()}
                  >
                    {t("workbench.discard")}
                  </Button>
                </>
              )
            ) : (
              <Button
                variant="primary"
                className={css.wide}
                disabled={
                  actionBusy ||
                  !capabilityReady ||
                  Boolean(props.startDisabled) ||
                  redoWaiting ||
                  (!props.renderQuickActions && !instruction.trim()) ||
                  !settings.data
                }
                onClick={() => void start()}
              >
                {t("workbench.start", { label: resultLabel })}
              </Button>
            )}
            {preview.data?.status === "conflicted" &&
              (props.operation === "chapter" ||
                props.operation === "script-revision") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionBusy || !capabilityReady}
                  onClick={() => void adopt(false)}
                >
                  {t("workbench.resolveConflict")}
                </Button>
              )}
            {pending && (
              <Button
                size="sm"
                variant="outline"
                disabled={
                  actionBusy ||
                  !capabilityReady ||
                  Boolean(props.startDisabled) ||
                  redoWaiting ||
                  !instruction.trim()
                }
                onClick={() => void start()}
              >
                {t("workbench.restart")}
              </Button>
            )}
            {value && ENDED.has(value.stage) && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionBusy || !capabilityReady}
                onClick={() => void action("retry")}
              >
                {t("workbench.retry")}
              </Button>
            )}
            {value?.stage === "failed" && value.output && (
              <Button
                size="sm"
                disabled={actionBusy || !capabilityReady}
                onClick={() => void action("continue")}
              >
                {t("workbench.continue")}
              </Button>
            )}
          </div>
        </footer>
      </section>
      <ScriptMergeDialog
        merge={scriptMerge}
        choices={scriptChoices}
        order={scriptOrder}
        orderConfirmed={scriptOrderConfirmed}
        blocked={actionBusy || mergeWaiting}
        t={t}
        onChoose={(unitId, choice) => {
          setScriptChoices((choices) => ({ ...choices, [unitId]: choice }));
          setScriptOrderConfirmed(false);
        }}
        onOrder={(order) => {
          setScriptOrder(order);
          setScriptOrderConfirmed(false);
        }}
        onConfirmOrder={setScriptOrderConfirmed}
        onMerge={() => void mergeScript()}
        onClose={() => setScriptMerge(undefined)}
      />
      <ChapterMergeDialog
        merge={merge?.data}
        choices={mergeChoices}
        blocked={actionBusy}
        t={t}
        onChoose={(segmentId, choice) =>
          setMergeChoices((choices) => ({ ...choices, [segmentId]: choice }))
        }
        onMerge={() => void mergeChapter()}
        onClose={() => setMerge(undefined)}
      />
    </>
  );
}

/** What names one creation run to reopen. */
export interface CreationRunCardProps {
  id: string;
  projectId?: string | undefined;
  taskId?: string | undefined;
}

/**
 * The workbench of one existing run, scoped to exactly its frozen input once
 * its identity, project and task are checked.
 */
export function CreationRunCard(
  props: CreationRunCardProps &
    CreationWorkbenchRemotes & {
      t: Translate;
      renderFactorySlot: RenderFactorySlot;
    },
) {
  const { automation, t } = props;
  const { data, error } = usePoll(
    `run:${props.id}:${props.projectId ?? ""}:${props.taskId ?? ""}`,
    async () => {
      const workflow = await answer<CreationWorkflow>(
        automation.creationGet(props.id),
      );
      if (
        workflow.id !== props.id ||
        (props.projectId && workflow.input.projectId !== props.projectId) ||
        (props.taskId && workflow.taskId !== props.taskId)
      )
        throw new Error(t("run.foreign"));
      return workflow;
    },
    { interval: 1500 },
  );
  if (error)
    return (
      <p role="alert" className={css.danger}>
        {error}
      </p>
    );
  if (!data) return <p className={css.muted}>{t("run.loading")}</p>;
  const { input } = data;
  return (
    <CreationWorkbench
      key={props.id}
      automation={automation}
      agents={props.agents}
      writing={props.writing}
      system={props.system}
      t={t}
      renderFactorySlot={props.renderFactorySlot}
      workflowId={props.id}
      projectId={input.projectId}
      operation={input.operation}
      targetId={input.targetId}
      baseVersion={input.baseVersion}
      defaultInstruction={input.instruction}
      sourceIds={input.sourceIds}
      authorIntentRequest={input.authorIntentRequest}
      diagnosisRequest={input.diagnosisRequest}
      adaptationStrategyRequest={input.adaptationStrategyRequest}
      seasonPlanRequest={input.seasonPlanRequest}
      episodeDevelopmentRequest={input.episodeDevelopmentRequest}
      qualityReviewRequest={input.qualityReviewRequest}
      narrativeContextRequest={input.narrativeContextRequest}
      narrativePlanningRequest={input.narrativePlanningRequest}
      productionNarrativeRequest={input.productionNarrativeRequest}
      narrativeSummaryRequest={input.narrativeSummaryRequest}
      reviewPackageId={input.reviewPackageId}
      feedbackClusterId={input.feedbackClusterId}
      language={input.language}
      wordGoal={input.wordGoal}
      engineKind={input.engineKind}
      model={input.model}
    />
  );
}

/** The production records a record workbench can revise. */
export type CreationRecordDomain =
  "scripts" | "shots" | "episodes" | "adaptations";

/** What a record workbench revises: one production record, by its domain. */
export interface CreationRecordWorkbenchProps {
  projectId: string;
  targetId: string;
  domain: CreationRecordDomain;
  sourceIds?: string[] | undefined;
  operation: CreationOperation;
  reviewPackageId?: string | undefined;
  feedbackClusterId?: string | undefined;
  defaultInstruction?: string | undefined;
  resultLabel?: string | undefined;
  onApplied?: (() => void | Promise<void>) | undefined;
}

/** One production record as the workbench checks it. */
interface ProductionRecord {
  id: string;
  domain: string;
  projectId: string;
  version: number;
}

/**
 * Read one production record by its domain.
 * @param production - the `production` Remote namespace.
 * @param domain - the record's domain.
 * @param id - the record.
 */
function readRecord(
  production: ProductionRemote,
  domain: CreationRecordDomain,
  id: string,
): Promise<ProductionRecord> {
  const read =
    domain === "scripts"
      ? production.scriptsGet(id)
      : domain === "shots"
        ? production.shotsGet(id)
        : domain === "episodes"
          ? production.episodesGet(id)
          : production.adaptationsGet(id);
  return answer<ProductionRecord>(read);
}

/**
 * The workbench of one production record, opened once the record's identity
 * and project are checked; a localization also asks for its language.
 */
export function CreationRecordWorkbench(
  props: CreationRecordWorkbenchProps &
    CreationWorkbenchRemotes & {
      production: ProductionRemote;
      t: Translate;
      renderFactorySlot: RenderFactorySlot;
    },
) {
  const { production, t } = props;
  const [language, setLanguage] = useState(() => t("record.defaultLanguage"));
  const belongs = (record: ProductionRecord) =>
    record.id === props.targetId &&
    record.domain === props.domain &&
    record.projectId === props.projectId;
  const { data: target, error } = usePoll(
    `record:${props.domain}:${props.targetId}:${props.projectId}`,
    () => readRecord(production, props.domain, props.targetId),
    { enabled: Boolean(props.targetId) },
  );
  if (!target)
    return (
      <p role={error ? "alert" : "status"} className={css.muted}>
        {error ?? t("record.loading")}
      </p>
    );
  if (!belongs(target))
    return (
      <p role="alert" className={css.danger}>
        {t("record.foreign")}
      </p>
    );
  return (
    <div className={css.stack}>
      {props.operation === "localization" && (
        <label className={css.inline}>
          {t("record.language")}
          <input
            className={css.input}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          />
        </label>
      )}
      <CreationWorkbench
        automation={props.automation}
        agents={props.agents}
        writing={props.writing}
        system={props.system}
        t={t}
        renderFactorySlot={props.renderFactorySlot}
        projectId={props.projectId}
        targetId={props.targetId}
        sourceIds={props.sourceIds}
        operation={props.operation}
        reviewPackageId={props.reviewPackageId}
        feedbackClusterId={props.feedbackClusterId}
        defaultInstruction={props.defaultInstruction}
        resultLabel={props.resultLabel}
        onApplied={props.onApplied}
        onPrepare={async () => {
          const current = await readRecord(
            production,
            props.domain,
            props.targetId,
          );
          if (!belongs(current)) throw new Error(t("record.foreign"));
          return current.version;
        }}
        baseVersion={target.version}
        language={props.operation === "localization" ? language : undefined}
      />
    </div>
  );
}
