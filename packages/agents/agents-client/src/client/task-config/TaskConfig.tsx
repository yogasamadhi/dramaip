import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";
import { Button } from "@dramaip/infra-ui-primitives";
import type { Context } from "@deepseek-ai/cordis";
import type { FactoryComponentPropsOf } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/writing-writing/remote";
import { messageOf, value, type AgentsRemote } from "../ai-settings.ts";
import {
  contextActions,
  contextPage,
  needsChapter,
  preflight,
  type ContextAction,
  type EngineDescriptor,
  type TaskDefinition,
} from "./context-actions.ts";
import { statusText, type Translate } from "./copy.ts";
import { UsageObservations } from "./UsageObservations.tsx";
import css from "./TaskConfig.module.css";

export type { Translate } from "./copy.ts";

/** The `writing` Remote namespace: the project's chapters. */
export type WritingRemote = Context["remote"]["writing"];
/** The `production` Remote namespace: the director board's shots. */
export type ProductionRemote = Context["remote"]["production"];

/** Injected face: the namespaces the panel reads and writes. */
export interface TaskConfigRemotes {
  agents: AgentsRemote;
  writing: WritingRemote;
  production: ProductionRemote;
}

/** The projects the panel chooses from, kept in step with the app's choice. */
export interface TaskConfigProjectScope {
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  /** The active project; empty when none is chosen. */
  readonly projectId: string;
  /** Choose a project and make it the active one. */
  select(projectId: string): void;
}

/** What the author left for settings to fix, to resume once they return. */
export interface AssistantIntent {
  readonly actionId: string;
  readonly input?: string | undefined;
}

/** The settings return intent the app keeps across pages. */
export interface AssistantIntentScope {
  /** The intent waiting to resume, if any. */
  readonly current: AssistantIntent | undefined;
  clear(): void;
  /** Keep an intent before the author leaves for settings. */
  save(intent: {
    returnTo: string;
    projectId?: string;
    chapterId?: string;
    actionId: string;
    input?: string;
  }): void;
}

/** Owner share of the new-task settings. */
export interface AgentTaskConfigProps {
  /** The route the panel opens on, path and query, such as `/tasks?shotId=…`. */
  readonly route: string;
  readonly scope: TaskConfigProjectScope;
  readonly intent: AssistantIntentScope;
  /** The creation run card of a run the panel started. */
  readonly renderRun: (workflowId: string, projectId: string) => ReactNode;
}

/** Full component props of the `agents.task-config` Factory. */
export type AgentTaskConfigComponentProps =
  FactoryComponentPropsOf<"agents.task-config">;

type EngineKind = "pi";
type AssistantMode = "simple" | "advanced";

interface ProjectSettings {
  defaultEngineKind: EngineKind;
  defaultModel?: { modelId: string };
  assistantMode: AssistantMode;
}

interface Chapter {
  id: string;
  title: string;
  content: string;
}

interface Shot {
  id: string;
  title: string;
  payload: Record<string, unknown>;
}

interface Run {
  id: string;
  status: string;
}

interface RunItem {
  id: string;
  type: string;
  content?: string;
}

interface Started {
  runId: string;
  taskId: string;
  workflowId?: string;
}

/**
 * A read keyed by `key`, again every `interval(data)` milliseconds while that
 * answers a number. A failed read keeps the previous value.
 */
function useRead<T>(
  key: string | undefined,
  read: () => Promise<T>,
  interval?: (data: T | undefined) => number | undefined,
): { data: T | undefined; set: (next: T) => void } {
  const [state, setState] = useState<{
    key?: string | undefined;
    data?: T | undefined;
  }>({});
  const [tick, setTick] = useState(0);
  const latest = useRef({ read, interval });
  latest.current = { read, interval };
  const data = state.key === key ? state.data : undefined;
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void latest.current.read().then(
      (next) => {
        if (!live) return;
        setState({ key, data: next });
        const wait = latest.current.interval?.(next);
        if (wait !== undefined)
          timer = setTimeout(() => setTick((count) => count + 1), wait);
      },
      () => {
        const wait = latest.current.interval?.(undefined);
        if (live && wait !== undefined)
          timer = setTimeout(() => setTick((count) => count + 1), wait);
      },
    );
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, tick]);
  const set = useCallback((next: T) => setState({ key, data: next }), [key]);
  return { data, set };
}

const ITEM_TYPES = new Set([
  "message",
  "tool_call",
  "tool_result",
  "usage",
  "structured_output",
  "error",
]);

/** Resolve the explicitly selected project from the current route. */
function routeProjectId(pathname: string, query: URLSearchParams) {
  const fromQuery = query.get("projectId");
  if (fromQuery) return fromQuery;
  const match = /^\/projects\/([^/?]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * The new-task settings. The simple mode offers the page's recommended
 * actions, each checked before it runs; the advanced mode offers every task
 * and a model, all executed by Pi. A run it starts shows
 * its creation run card, or its item stream and usage.
 */
export function TaskConfig({
  agents,
  writing,
  production,
  t,
  route,
  scope,
  intent,
  renderRun,
}: AgentTaskConfigComponentProps) {
  const [pathname = "", search = ""] = route.split("?");
  const query = new URLSearchParams(search);
  const requestedProjectId =
    routeProjectId(pathname, query) ?? (scope.projectId || undefined);
  const requestedShotId = query.get("shotId");
  const [projectId, setProjectId] = useState(requestedProjectId ?? "");
  const [chapterId, setChapterId] = useState("");
  const engineKind: EngineKind = "pi";
  const [taskType, setTaskType] = useState("chapter_diagnostic");
  const [modelId, setModelId] = useState("");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("simple");
  const [prompt, setPrompt] = useState(() => intent.current?.input ?? "");
  const [notice, setNotice] = useState<string>();
  const [active, setActive] = useState<Started>();
  const [pending, setPending] = useState<
    "mode" | "run" | "interrupt" | "resume"
  >();
  useEffect(() => {
    if (requestedProjectId) setProjectId(requestedProjectId);
  }, [requestedProjectId]);
  useEffect(() => setChapterId(""), [projectId]);
  const engines =
    useRead(
      "engines",
      () => value<EngineDescriptor[]>(agents.enginesList()),
      () => 5_000,
    ).data ?? [];
  const tasks =
    useRead("tasks", () => value<TaskDefinition[]>(agents.enginesListTasks()))
      .data ?? [];
  const settings = useRead(projectId || undefined, () =>
    value<ProjectSettings>(agents.enginesGetProjectSettings(projectId)),
  ).data;
  const chapters =
    useRead(projectId || undefined, () =>
      value<Chapter[]>(writing.chaptersList(projectId)),
    ).data ?? [];
  const shots =
    useRead(projectId || undefined, () =>
      value<Shot[]>(production.shotsList({ projectId })),
    ).data ?? [];
  useEffect(() => {
    if (!settings) return;
    setModelId(settings.defaultModel?.modelId ?? "");
    setAssistantMode(settings.assistantMode);
  }, [settings]);
  const run = useRead(
    active?.runId,
    () => value<Run>(agents.sessionsGetRun(active!.runId)),
    (data) => (data?.status === "running" ? 1_000 : undefined),
  );
  const items =
    useRead(
      active ? `${active.runId}:${run.data?.status ?? ""}` : undefined,
      () => value<RunItem[]>(agents.sessionsListItems(active!.runId)),
      () => (run.data?.status === "running" ? 1_000 : undefined),
    ).data ?? [];

  const selectedTask = tasks.find((item) => item.id === taskType);
  const requiresChapter = needsChapter(selectedTask);
  const selectedShot = shots.find((shot) => shot.id === requestedShotId);
  const shotPayload = selectedShot?.payload ?? {};
  const shotContext = selectedShot
    ? [
        t("task.shot.prompt.title", { title: selectedShot.title }),
        shotPayload["镜头描述"]
          ? t("task.shot.prompt.frame", {
              value: String(shotPayload["镜头描述"]),
            })
          : "",
        shotPayload["生成提示"]
          ? t("task.shot.prompt.hint", {
              value: String(shotPayload["生成提示"]),
            })
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const contextualPrompt = [shotContext, prompt.trim()]
    .filter(Boolean)
    .join("\n\n");
  const recommended = contextActions(contextPage(pathname), tasks);
  const selectedEngine = engines.find((engine) => engine.kind === engineKind);
  const model = modelId.trim();

  const attempt = async (
    step: NonNullable<typeof pending>,
    work: () => Promise<void>,
  ) => {
    setPending(step);
    try {
      await work();
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setPending(undefined);
    }
  };

  const updateMode = (next: AssistantMode) => {
    setAssistantMode(next);
    void attempt("mode", async () => {
      try {
        if (!projectId) throw new Error(t("task.mode.noProject"));
        const saved = await value<ProjectSettings>(
          agents.enginesUpdateProjectSettings(
            projectId,
            {
              defaultEngineKind: engineKind,
              ...(settings?.defaultModel
                ? { defaultModel: settings.defaultModel }
                : {}),
              assistantMode: next,
            },
            undefined,
            undefined,
          ),
        );
        setAssistantMode(saved.assistantMode);
        setNotice(
          t(
            saved.assistantMode === "advanced"
              ? "task.mode.saved.advanced"
              : "task.mode.saved.simple",
          ),
        );
      } catch (cause) {
        setAssistantMode(settings?.assistantMode ?? "simple");
        throw cause;
      }
    });
  };

  const runAgent = (requested?: string) =>
    attempt("run", async () => {
      if (!projectId) throw new Error(t("task.error.project"));
      const type = requested ?? taskType;
      const definition = tasks.find((item) => item.id === type);
      if (needsChapter(definition) && !chapterId)
        throw new Error(t("task.error.chapter"));
      const session = await value<{ id: string }>(
        agents.sessionsCreate(
          {
            projectId,
            ...(chapterId ? { chapterId } : {}),
            engineKind,
            taskType: type,
            ...(definition?.label ? { title: definition.label } : {}),
            ...(model ? { model: { modelId: model } } : {}),
          },
          undefined,
          undefined,
        ),
      );
      const started = await value<Started>(
        agents.sessionsRun(
          session.id,
          {
            taskType: type,
            ...(model ? { model: { modelId: model } } : {}),
            ...(contextualPrompt ? { prompt: contextualPrompt } : {}),
          },
          undefined,
          undefined,
        ),
      );
      setActive(started);
      setNotice(
        t("task.created", {
          label: definition?.label ?? t("task.created.default"),
          id: started.taskId.slice(0, 8),
        }),
      );
    });

  const control = (step: "interrupt" | "resume") =>
    attempt(step, async () => {
      const id = active!.runId;
      const next = await value<Run>(
        step === "interrupt"
          ? agents.sessionsInterrupt(id, undefined, undefined, undefined)
          : agents.sessionsResume(id, undefined, undefined, undefined),
      );
      run.set(next);
      setNotice(t(step === "interrupt" ? "run.interrupted" : "run.resumed"));
    });

  const recommendedAction = (action: ContextAction) => {
    const check = preflight({
      action,
      projectId,
      chapterId,
      engine: selectedEngine,
      modelId,
    });
    const returned = intent.current?.actionId === action.actionId;
    return (
      <article key={action.actionId} className={css.block}>
        <p className={css.strong}>{action.label}</p>
        <p className={css.small}>
          {t(`action.${action.actionId}` as Parameters<Translate>[0])}
        </p>
        <p className={css.small}>
          {t("task.input", {
            state: t(
              check.input === "ready"
                ? "task.input.ready"
                : check.input === "chapter-required"
                  ? "task.input.chapter"
                  : "task.input.project",
            ),
          })}
        </p>
        <p className={css.small}>
          {t("task.capability", {
            state:
              check.capability === "ready"
                ? t("task.capability.ready", {
                    name: selectedEngine?.name ?? t("task.capability.engine"),
                  })
                : t(
                    check.capability === "unavailable"
                      ? "task.capability.unavailable"
                      : "task.capability.missing",
                  ),
          })}
        </p>
        <p className={css.small}>
          {t(
            check.cost === "unknown" ? "task.cost.unknown" : "task.cost.billed",
          )}
        </p>
        {!check.ready && (
          <div className={css.warn}>
            {check.fixes.map((fix) => (
              <p key={fix.key}>{t(fix.key, fix.values)}</p>
            ))}
            <a
              className={css.link}
              href="#/settings?setup=ai"
              onClick={() =>
                intent.save({
                  returnTo: route,
                  ...(projectId ? { projectId } : {}),
                  ...(chapterId ? { chapterId } : {}),
                  actionId: action.actionId,
                  ...(prompt ? { input: prompt } : {}),
                })
              }
            >
              {t("task.fix.link")}
            </a>
          </div>
        )}
        <Button
          variant="outline"
          className={clsx(css.wide, returned && css.returned)}
          disabled={pending === "run" || !check.ready}
          onClick={() => {
            if (returned) intent.clear();
            void runAgent(action.id);
          }}
        >
          {pending === "run"
            ? t("task.run.pending")
            : returned
              ? t("task.run.resume")
              : t("task.run.preview", { label: action.label })}
        </Button>
      </article>
    );
  };

  const categories = Array.from(new Set(tasks.map((item) => item.category)));
  return (
    <section aria-label={t("task.aria")} className={css.panel}>
      <div className={css.head}>
        <p className={css.strong}>{t("task.context")}</p>
        <span className={css.badge}>{t("task.controlled")}</span>
      </div>
      <p className={css.muted}>{t("task.lead")}</p>
      <div className={css.modes} role="group" aria-label={t("task.mode")}>
        {(["simple", "advanced"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={clsx(css.mode, assistantMode === mode && css.modeOn)}
            disabled={!projectId || pending === "mode"}
            onClick={() => updateMode(mode)}
          >
            {t(mode === "simple" ? "task.mode.simple" : "task.mode.advanced")}
          </button>
        ))}
      </div>
      <select
        aria-label={t("task.project")}
        className={css.select}
        value={projectId}
        onChange={(event) => {
          setProjectId(event.target.value);
          if (event.target.value) scope.select(event.target.value);
        }}
      >
        <option value="">{t("task.project.none")}</option>
        {scope.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
      {selectedShot && (
        <p className={css.callout} aria-label={t("task.shot")}>
          {t("task.shot.text", { title: selectedShot.title })}
        </p>
      )}
      <select
        aria-label={t("task.chapter")}
        className={css.select}
        value={chapterId}
        disabled={!projectId}
        onChange={(event) => setChapterId(event.target.value)}
      >
        <option value="">{t("task.chapter.none")}</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {t("task.chapter.option", { title: chapter.title })}
          </option>
        ))}
      </select>
      {assistantMode === "simple" && (
        <section className={css.stack} aria-label={t("task.recommended.aria")}>
          <div>
            <p className={css.strong}>{t("task.recommended")}</p>
            <p className={css.small}>{t("task.recommended.hint")}</p>
          </div>
          {recommended.actions.map(recommendedAction)}
          {!recommended.actions.length && !recommended.missing.length && (
            <p className={css.block}>{t("task.catalog.loading")}</p>
          )}
          {recommended.missing.length > 0 && (
            <p className={css.warnBox}>{t("task.catalog.missing")}</p>
          )}
        </section>
      )}
      {assistantMode === "advanced" && (
        <>
          <label className={css.field}>
            {t("task.task")}
            <select
              className={css.select}
              value={taskType}
              onChange={(event) => setTaskType(event.target.value)}
            >
              {categories.map((category) => (
                <optgroup key={category} label={category}>
                  {tasks
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={css.field}>
            {t("task.model")}
            <input
              className={css.input}
              placeholder={t("task.model.placeholder")}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          {requiresChapter && !chapterId && (
            <p className={css.warn}>{t("task.chapter.required")}</p>
          )}
          <label className={css.field}>
            {t("task.prompt")}
            <textarea
              className={css.textarea}
              placeholder={t(
                selectedTask?.writePolicy === "change-preview"
                  ? "task.prompt.change"
                  : "task.prompt.read",
              )}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <Button
            variant="outline"
            className={css.wide}
            disabled={
              pending === "run" ||
              !projectId ||
              (requiresChapter && !chapterId) ||
              selectedEngine?.status !== "available"
            }
            onClick={() => void runAgent()}
          >
            {pending === "run"
              ? t("task.run.pending")
              : t("task.run", {
                  label: selectedTask?.label ?? t("task.run.default"),
                })}
          </Button>
        </>
      )}
      {active?.workflowId && renderRun(active.workflowId, projectId)}
      {run.data && !active?.workflowId && (
        <section className={css.panel}>
          <div className={css.head}>
            <p className={css.strong}>{t("run.items")}</p>
            <span className={css.small}>{statusText(t, run.data.status)}</span>
          </div>
          <div className={css.items}>
            {items.map((item) => (
              <div key={item.id} className={css.block}>
                <p className={css.strong}>
                  {t(
                    (ITEM_TYPES.has(item.type)
                      ? `run.item.${item.type}`
                      : "run.item.reasoning") as Parameters<Translate>[0],
                  )}
                </p>
                {item.content && <p className={css.pre}>{item.content}</p>}
              </div>
            ))}
            {!items.length && <p className={css.small}>{t("run.waiting")}</p>}
          </div>
          <UsageObservations
            key={`${projectId}:${run.data.id}`}
            agents={agents}
            t={t}
            runId={run.data.id}
            projectId={projectId}
          />
          <div className={css.row}>
            {run.data.status === "running" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending === "interrupt"}
                onClick={() => void control("interrupt")}
              >
                {t("run.interrupt")}
              </Button>
            )}
            {run.data.status === "interrupted" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending === "resume"}
                onClick={() => void control("resume")}
              >
                {t("run.resume")}
              </Button>
            )}
          </div>
        </section>
      )}
      {notice && <p className={css.small}>{notice}</p>}
      <p className={css.small}>{t("task.sync")}</p>
    </section>
  );
}
