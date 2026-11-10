import { useCallback, useState } from "react";
import clsx from "clsx";
import type { RenderFactorySlot } from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import { usePublishedEvents, type SystemRemote } from "../creation/events.ts";
import { usePoll, value } from "../creation/remote.ts";
import type {} from "@dramaip/agents-agents-client/client/contract";
import type {
  LegacyAssistantIntent,
  LegacyProjectScope,
} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "../contract.ts";
import css from "./Confirmations.module.css";
import { providerStatusText } from "./provider-review.ts";
import {
  ChangePreviewCard,
  ProviderPreviewCard,
  RevisionPreviewCard,
} from "./PreviewCards.tsx";
import {
  explained,
  fields,
  type Task,
  type TaskRemotes,
  type Translate,
  type WorklistPage,
} from "./remote.ts";
import {
  readActualTaskResult,
  readTaskConfirmationContext,
  taskConfirmationKey,
  taskPreviews,
  taskResultReferenceKey,
  taskResultText,
} from "./task-context.ts";

type Category = "pending-result" | "running" | "attention" | "history";

const CATEGORIES: ReadonlyArray<{
  id: Category;
  countKey: keyof WorklistPage["counts"];
}> = [
  { id: "pending-result", countKey: "pendingResult" },
  { id: "running", countKey: "running" },
  { id: "attention", countKey: "attention" },
  { id: "history", countKey: "history" },
];

/** Tasks whose old fixed or count scores are kept only as history. */
const isLegacyQualityTask = (kind: string) =>
  kind === "quality-check" || kind === "creative_diagnostics";

/**
 * Where a task's own operation lives.
 * @param task - the task.
 */
export function taskSourceRoute(task: Task): string {
  const scoped = task.projectId
    ? `projectId=${encodeURIComponent(task.projectId)}`
    : "";
  if (isLegacyQualityTask(task.kind))
    return `/create${scoped ? `?${scoped}` : ""}`;
  const result = fields(task.result);
  const separator = scoped ? "&" : "";
  if (/image|video|tts|media/iu.test(task.kind)) {
    const shotId =
      typeof result.shotId === "string" ? result.shotId : undefined;
    return `/produce?${scoped}${separator}stage=${task.kind === "video-generation" ? "video-generation" : "assets"}${shotId ? `&shotId=${encodeURIComponent(shotId)}` : ""}`;
  }
  if (/feedback|review|delivery/iu.test(task.kind)) return `/review?${scoped}`;
  if (/chapter|writing|analysis/iu.test(task.kind) && task.projectId)
    return `/projects/${encodeURIComponent(task.projectId)}`;
  return task.projectId
    ? `/projects/${encodeURIComponent(task.projectId)}/tools/cockpit`
    : "/";
}

function statusTone(task: Task): string {
  if (task.status === "failed" || task.status === "interrupted")
    return "danger";
  if (task.status === "running" || task.status === "queued") return "info";
  if (task.resultStatus === "pending") return "warning";
  if (task.status === "succeeded") return "success";
  return "neutral";
}

/**
 * A task's error as shown: its own words when they are the author's
 * language, otherwise a general failure.
 */
function taskErrorText(t: Translate, text: string): string {
  if (/[㐀-鿿]/u.test(text)) return text;
  return /[A-Za-z]{2,}/.test(text) ? t("task.errorGeneric") : text;
}

/** What the task center reads with: its Remotes, copy and factories. */
export interface TaskCenterContext {
  remotes: TaskRemotes;
  system: SystemRemote;
  t: Translate;
  renderFactorySlot: RenderFactorySlot;
}

function TaskCard({
  task,
  context,
  acknowledging,
  onAcknowledge,
  onChanged,
}: {
  task: Task;
  context: TaskCenterContext;
  acknowledging: boolean;
  onAcknowledge: (task: Task) => void;
  onChanged: () => void;
}) {
  const { remotes, t, renderFactorySlot } = context;
  const legacyQuality = isLegacyQualityTask(task.kind);
  const actual = usePoll(
    `task:${task.id}:${task.projectId ?? ""}:${task.updatedAt}:${taskResultReferenceKey(task.result)}`,
    explained(t, () => readActualTaskResult(remotes, task)),
    { interval: 1500 },
  );
  const checked = actual.error ? undefined : actual.data;
  const result = checked?.result;
  const previews = taskPreviews(checked);
  const listed = fields(task.result);
  const hasProviderReference =
    listed.providerActionPreviewId !== undefined ||
    listed.providerActionPreview !== undefined;
  const workflowId = fields(result).creationWorkflowId;
  const status = legacyQuality
    ? t("task.badge.legacyQuality")
    : actual.error
      ? t("task.badge.unverified")
      : previews.provider
        ? providerStatusText(t, previews.provider.status)
        : hasProviderReference
          ? t("task.badge.checkingProvider")
          : task.resultStatus === "pending"
            ? t("task.badge.pending")
            : task.resultStatus === "applied"
              ? t("task.badge.applied")
              : t(`task.state.${task.status}`);
  const percent = Math.min(100, Math.max(0, task.progress * 100));
  return (
    <article className={css.card} data-task-id={task.id}>
      <div className={css.cardHeader}>
        <div>
          <h3 className={css.cardTitle}>{task.title}</h3>
          <p className={css.small}>
            {t("task.meta", {
              time: new Date(task.updatedAt).toLocaleString(t("date.locale")),
              kind: task.kind,
            })}
          </p>
        </div>
        <span
          className={css.badge}
          data-tone={legacyQuality ? "warning" : statusTone(task)}
        >
          {status}
        </span>
      </div>
      {legacyQuality && <p className={css.muted}>{t("task.legacyQuality")}</p>}
      {task.stage ? (
        <div
          className={css.progress}
          aria-label={t("task.stage", { stage: task.stage })}
        >
          <div className={css.progressLabel}>
            <span>{task.stage}</span>
            <span>
              {t("task.percent", { percent: Math.round(task.progress * 100) })}
            </span>
          </div>
          <div className={css.track}>
            <div className={css.bar} style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}
      {task.error ? (
        <p className={css.alert} role="alert">
          {taskErrorText(t, task.error)}
        </p>
      ) : null}
      {actual.error && (
        <p role="alert" className={css.alert}>
          {actual.error}
        </p>
      )}
      {!actual.error && !actual.data && task.result !== undefined && (
        <p role="status" className={css.muted}>
          {t("task.checkingResult")}
        </p>
      )}
      {typeof workflowId === "string" &&
        renderFactorySlot("automation.creation-run", {
          id: workflowId,
          projectId: task.projectId,
          taskId: task.id,
        })}
      {previews.revision && (
        <RevisionPreviewCard
          preview={previews.revision}
          projectId={task.projectId}
          remotes={remotes}
          t={t}
          onChanged={onChanged}
        />
      )}
      {previews.change && (
        <ChangePreviewCard
          preview={previews.change}
          remotes={remotes}
          t={t}
          onChanged={onChanged}
        />
      )}
      {previews.provider && checked && (
        <ProviderPreviewCard
          preview={previews.provider}
          task={checked}
          remotes={remotes}
          t={t}
          onChanged={onChanged}
        />
      )}
      <div className={css.row}>
        {task.conversationId ? (
          <button
            type="button"
            className={css.linkButton}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("dramaip:open-assistant-conversation", {
                  detail: { conversationId: task.conversationId },
                }),
              )
            }
          >
            {t("task.openConversation")}
          </button>
        ) : null}
        <a className={css.link} href={`#${taskSourceRoute(task)}`}>
          {t("task.backToSource")}
        </a>
        {(task.status === "failed" || task.status === "interrupted") &&
        task.attentionStatus === "open" ? (
          <Button
            variant="ghost"
            size="sm"
            className={css.push}
            disabled={acknowledging}
            onClick={() => onAcknowledge(task)}
          >
            {t("task.acknowledge")}
          </Button>
        ) : null}
      </div>
      {result !== undefined && task.resultStatus !== "pending" ? (
        <details className={css.details}>
          <summary className={css.summary}>
            {t(legacyQuality ? "task.resultLegacy" : "task.result")}
          </summary>
          <p className={css.text}>
            {taskResultText(result) ?? t("task.resultEmpty")}
          </p>
        </details>
      ) : null}
    </article>
  );
}

/** The events after which the worklist is read again. */
const TASK_EVENT = /^(task\.|automation\.|agent_session\.|agent_item\.)/;

/**
 * The task center: the object a confirmation link names, checked against
 * its project, then the worklist by category, 25 tasks a page.
 */
export function TaskCenter({
  context,
  search,
  scope: projectScope,
  intent,
}: {
  context: TaskCenterContext;
  search: string;
  /** The app's project choice; the new-task settings choose with it. */
  scope: LegacyProjectScope;
  /** The AI action the new-task settings resume after settings. */
  intent: LegacyAssistantIntent;
}) {
  const { remotes, system, t, renderFactorySlot } = context;
  const activeProjectId = projectScope.projectId || undefined;
  const params = new URLSearchParams(search);
  const projectId =
    params.get("projectId") ??
    (params.get("scope") === "all" ? undefined : activeProjectId);
  const requestedTaskId = params.get("taskId");
  const hasRequestedObject = ["taskId", "workflowId", "revisionId"].some(
    (key) => params.has(key),
  );
  const hasRequestedContext = hasRequestedObject || params.has("projectId");
  const selected = usePoll(
    `context:${projectId ?? ""}:${taskConfirmationKey(search)}`,
    explained(t, () => readTaskConfirmationContext(remotes, projectId, search)),
    { enabled: hasRequestedContext, interval: 1500 },
  );
  const renderWorklist =
    !hasRequestedContext || Boolean(selected.data && !selected.error);
  const [category, setCategory] = useState<Category>("pending-result");
  const [configOpen, setConfigOpen] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const scope = `${projectId ?? ""}:${category}`;
  const [pagesScope, setPagesScope] = useState(scope);
  if (pagesScope !== scope) {
    setPagesScope(scope);
    setPageCount(1);
  }
  const worklist = usePoll(
    `worklist:${scope}:${pageCount}`,
    async () => {
      const pages: WorklistPage[] = [];
      let cursor: string | undefined;
      do {
        pages.push(
          await value<WorklistPage>(
            remotes.automation.tasksWorklist({
              category,
              ...(projectId ? { projectId } : {}),
              ...(cursor ? { cursor } : {}),
              limit: 25,
            }),
          ),
        );
        cursor = pages.at(-1)?.nextCursor;
      } while (cursor && pages.length < pageCount);
      return pages;
    },
    { enabled: renderWorklist },
  );
  const refreshWorklist = worklist.refresh;
  const refreshContext = selected.refresh;
  const refresh = useCallback(() => {
    refreshWorklist();
    refreshContext();
  }, [refreshWorklist, refreshContext]);
  usePublishedEvents(system, (event) => {
    if (TASK_EVENT.test(event.type)) refreshWorklist();
  });
  const [acknowledging, setAcknowledging] = useState(false);
  const acknowledge = async (task: Task) => {
    setAcknowledging(true);
    try {
      await value(
        remotes.automation.tasksSetAttention(
          task.id,
          { status: "acknowledged" },
          undefined,
          crypto.randomUUID(),
        ),
      );
    } catch {
      // The worklist read again shows whether it took.
    } finally {
      setAcknowledging(false);
      refresh();
    }
  };
  const pages = renderWorklist ? (worklist.data ?? []) : [];
  const items = pages.flatMap((page) => page.items);
  const counts = pages[0]?.counts ?? {
    pendingResult: 0,
    running: 0,
    attention: 0,
    history: 0,
  };
  const card = (task: Task, key?: string) => (
    <TaskCard
      key={key}
      task={task}
      context={context}
      acknowledging={acknowledging}
      onAcknowledge={(item) => void acknowledge(item)}
      onChanged={refresh}
    />
  );
  const pendingHref = projectId
    ? `#/pending?projectId=${encodeURIComponent(projectId)}`
    : "#/pending";
  return (
    <section className={css.stack}>
      <div className={css.toolbar}>
        <p className={css.muted}>
          {t(projectId ? "tasks.scope.project" : "tasks.scope.all")}
        </p>
        <Button
          variant={configOpen ? "outline" : "primary"}
          size="sm"
          onClick={() => setConfigOpen((open) => !open)}
        >
          {t(configOpen ? "tasks.config.close" : "tasks.config.open")}
        </Button>
      </div>
      {configOpen && renderWorklist
        ? renderFactorySlot("agents.task-config", {
            route: `/tasks${search}`,
            scope: projectScope,
            intent,
            renderRun: (id, runProjectId) =>
              renderFactorySlot("automation.creation-run", {
                id,
                projectId: runProjectId || undefined,
              }),
          })
        : null}
      {(hasRequestedObject || Boolean(selected.error)) && (
        <section
          aria-label={t("tasks.selected")}
          className={clsx(css.card, css.focus)}
        >
          <div className={css.cardHeader}>
            <h2 className={css.heading}>{t("tasks.selected")}</h2>
            <a className={css.link} href={pendingHref}>
              {t("tasks.backToPending")}
            </a>
          </div>
          {selected.error || !selected.data ? (
            <p
              role={selected.error ? "alert" : "status"}
              className={selected.error ? css.alert : css.muted}
            >
              {selected.error ?? t("tasks.selected.checking")}
            </p>
          ) : selected.data.revision ? (
            <RevisionPreviewCard
              preview={selected.data.revision}
              projectId={projectId}
              remotes={remotes}
              t={t}
              onChanged={refresh}
            />
          ) : selected.data.workflow ? (
            renderFactorySlot("automation.creation-run", {
              id: selected.data.workflow.id,
              projectId: selected.data.workflow.input.projectId,
              taskId: selected.data.task?.id,
            })
          ) : selected.data.task ? (
            card(selected.data.task)
          ) : (
            <p className={css.muted}>{t("tasks.selected.none")}</p>
          )}
        </section>
      )}
      <div className={css.tabs} role="tablist" aria-label={t("tasks.tabs")}>
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            className={css.tab}
            onClick={() => setCategory(item.id)}
          >
            {t(`tasks.category.${item.id}`)}
            <span className={css.count}>{counts[item.countKey]}</span>
          </button>
        ))}
      </div>
      {renderWorklist && worklist.error ? (
        <p className={css.alert} role="alert">
          {worklist.error}
        </p>
      ) : null}
      <div className={css.stack} role="tabpanel">
        {items
          .filter((item) => item.id !== requestedTaskId)
          .map((item) => card(item, item.id))}
        {renderWorklist && !worklist.error && worklist.data && !items.length ? (
          <p className={css.empty}>{t("tasks.empty")}</p>
        ) : null}
        {renderWorklist && pages.at(-1)?.nextCursor ? (
          <Button
            variant="outline"
            disabled={worklist.fetching}
            onClick={() => setPageCount((count) => count + 1)}
          >
            {t("tasks.more")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
