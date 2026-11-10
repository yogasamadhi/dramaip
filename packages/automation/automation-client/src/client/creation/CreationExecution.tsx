import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import { clsx } from "clsx";
import css from "./Creation.module.css";
import { RecoveryError } from "./recovery.ts";
import {
  messageOf,
  value,
  type AgentsRemote,
  type AutomationRemote,
  type CreationExecutionReceipt,
  type CreationWorkflow,
  type PreviewRevisionEffort,
  type Translate,
} from "./remote.ts";
import {
  readExecution,
  readRevisionEffort,
  readRunContext,
  VerifyError,
  type ContextSnapshot,
} from "./verify.ts";

/**
 * A failed read's text: the refusal's own copy, or the failure's message.
 * @param t - copy.
 * @param cause - what the read threw.
 */
export function failureText(t: Translate, cause: unknown): string {
  return cause instanceof VerifyError
    ? t(`verify.${cause.problem}`)
    : cause instanceof RecoveryError
      ? t(cause.problem)
      : messageOf(cause);
}

/**
 * One on-request read, scoped: a new scope forgets the answer, and an answer
 * that lands after the scope moved is dropped.
 * @param scope - what is read.
 * @param read - the read.
 */
function useScopedRead<T>(scope: string, read: () => Promise<T>) {
  const current = useRef(scope);
  current.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    data?: T;
    error?: unknown;
    pending: boolean;
  }>({ scope, pending: false });
  useEffect(() => {
    setState({ scope, pending: false });
    return () => {
      generation.current += 1;
    };
  }, [scope]);
  const run = async () => {
    const own = ++generation.current;
    setState({ scope, pending: true });
    try {
      const data = await read();
      if (generation.current === own && current.current === scope)
        setState({ scope, data, pending: false });
    } catch (error) {
      if (generation.current === own && current.current === scope)
        setState({ scope, error, pending: false });
    }
  };
  const own = state.scope === scope ? state : { scope, pending: false };
  return { ...own, run };
}

const PHASES = {
  generating: "execution.phase.generating",
  checking: "execution.phase.checking",
  revising: "execution.phase.revising",
  rechecking: "execution.phase.rechecking",
} as const;

/** Props of {@link CreationExecutionView}. */
export interface CreationExecutionViewProps {
  receipt: CreationExecutionReceipt;
  t: Translate;
  renderUsage?: (runId: string) => ReactNode;
  renderContext?: (runId: string) => ReactNode;
}

/** The stage runs of one workflow attempt, in their run order. */
export function CreationExecutionView({
  receipt,
  t,
  renderUsage,
  renderContext,
}: CreationExecutionViewProps) {
  return (
    <div className={css.compact} aria-label={t("execution.aria")}>
      <p className={css.breakAll}>
        {t("execution.workflow", {
          workflowId: receipt.workflowId,
          version: receipt.version,
          operation: receipt.operation,
        })}
      </p>
      <p className={css.small}>
        {t("execution.scope")}
        {receipt.sourceWorkflowId
          ? t("execution.source", { workflowId: receipt.sourceWorkflowId })
          : ""}
        {t("execution.cost")}
      </p>
      {!receipt.runs.length && <p>{t("execution.none")}</p>}
      {receipt.runs.map((run, index) => (
        <section key={run.runId} className={css.block}>
          <p className={css.breakAll}>
            {t("execution.run", {
              index: index + 1,
              phase:
                run.state === "recorded"
                  ? t(PHASES[run.phase])
                  : t("execution.phase.unknown"),
              runId: run.runId,
            })}
          </p>
          {run.state === "missing" ? (
            <p>{t("execution.missing")}</p>
          ) : (
            <>
              <p>
                {t("execution.engine", {
                  engine: run.execution.engineKind,
                  status: run.execution.status,
                })}
              </p>
              <p>
                {t("execution.model", {
                  model:
                    run.execution.model.status === "recorded"
                      ? `${run.execution.model.modelId}${run.execution.model.providerId ? ` · Provider ${run.execution.model.providerId}` : ""}${run.execution.model.profileId ? ` · Profile ${run.execution.model.profileId}` : ""}`
                      : run.execution.model.status === "invalid"
                        ? t("execution.model.invalid")
                        : t("execution.model.unrecorded"),
                })}
              </p>
              <p>
                {t("execution.timing", {
                  timing:
                    run.execution.timing.status === "measured"
                      ? t("execution.timing.measured", {
                          startedAt: run.execution.timing.startedAt,
                          completedAt: run.execution.timing.completedAt,
                          durationMs: run.execution.timing.durationMs,
                        })
                      : run.execution.timing.status === "in-progress"
                        ? t("execution.timing.progress", {
                            startedAt: run.execution.timing.startedAt,
                          })
                        : run.execution.timing.status === "invalid"
                          ? t("execution.timing.invalid")
                          : t("execution.timing.unrecorded"),
                })}
              </p>
              {renderUsage?.(run.runId)}
              {renderContext?.(run.runId)}
            </>
          )}
        </section>
      ))}
    </div>
  );
}

/** The frozen context of one stage run. */
export function CreationRunContextView({
  runId,
  snapshot,
  t,
}: {
  runId: string;
  snapshot: ContextSnapshot;
  t: Translate;
}) {
  return (
    <section
      aria-label={t("context.aria")}
      className={clsx(css.stack, css.breakAll)}
    >
      <p>{t("context.run", { runId, snapshotId: snapshot.id })}</p>
      <p>
        {t("context.tokens", {
          estimated: snapshot.estimatedTokens,
          budget: snapshot.tokenBudget,
        })}
      </p>
      <p>
        {t("context.entries", {
          included: snapshot.entries.filter((entry) => entry.included).length,
          excluded: snapshot.entries.filter((entry) => !entry.included).length,
        })}
      </p>
      <p className={css.small}>{t("context.note")}</p>
      <p>{t("context.promptDigest", { digest: snapshot.finalPromptSha256 })}</p>
      <p>{t("context.manifestDigest", { digest: snapshot.manifestSha256 })}</p>
      <ul className={css.list}>
        {snapshot.entries.map((entry, index) => (
          <li key={index}>
            <p>
              {t("context.entry", {
                kind: entry.sourceKind,
                id: entry.sourceId,
                version: entry.sourceVersion,
                state: entry.included
                  ? t("context.included")
                  : t("context.excluded"),
              })}
            </p>
            <p>
              {t("context.entryReason", {
                field: entry.fieldPath,
                reason: entry.reason,
                tokens: entry.estimatedTokens,
              })}
            </p>
            {entry.included && (
              <details>
                <summary className={css.summary}>
                  {t("context.entryValue")}
                </summary>
                <pre className={css.code}>
                  {typeof entry.value === "string"
                    ? entry.value
                    : JSON.stringify(entry.value, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <details>
        <summary className={css.summary}>{t("context.prompt")}</summary>
        <pre className={css.code}>{snapshot.finalPrompt}</pre>
      </details>
    </section>
  );
}

/** Read one stage run's frozen context on request. */
export function CreationRunContextPanel({
  automation,
  agents,
  t,
  workflow,
  runId,
}: {
  automation: AutomationRemote;
  agents: AgentsRemote;
  t: Translate;
  workflow: CreationWorkflow;
  runId: string;
}) {
  const read = useScopedRead(
    `${workflow.input.projectId}:${workflow.id}:${workflow.version}:${runId}:${workflow.runIds.join(",")}`,
    () => readRunContext({ automation, agents }, workflow, runId),
  );
  return (
    <section aria-label={t("context.panel", { runId })} className={css.stack}>
      <Button
        variant="outline"
        size="sm"
        disabled={read.pending}
        onClick={() => void read.run()}
      >
        {read.pending ? t("context.pending") : t("context.read")}
      </Button>
      {read.error !== undefined && (
        <p role="alert" className={css.danger}>
          {t("context.error", { error: failureText(t, read.error) })}
        </p>
      )}
      {read.data && (
        <CreationRunContextView runId={runId} snapshot={read.data} t={t} />
      )}
    </section>
  );
}

/** The saved text revisions of one chapter draft. */
export function RevisionEffortView({
  value: effort,
  t,
}: {
  value: PreviewRevisionEffort;
  t: Translate;
}) {
  return (
    <div className={css.compact} aria-label={t("effort.aria")}>
      <p>
        {t("effort.counts", {
          updates: effort.observedContentUpdates,
          rebases: effort.observedRebases,
          changing: effort.observedContentChangingRebases,
        })}
      </p>
      <p>
        {t(
          effort.status === "committed"
            ? "effort.committed"
            : "effort.uncommitted",
          {
            count:
              effort.localRevisionCount === null
                ? t("effort.unknown")
                : effort.localRevisionCount,
          },
        )}
      </p>
      <p className={css.small}>{t("effort.note")}</p>
      {effort.coverage !== "complete" && <p>{t("effort.partial")}</p>}
      <details>
        <summary className={css.summary}>{t("effort.range")}</summary>
        <p className={css.breakAll}>
          {t("effort.previews", {
            root: effort.rootPreviewId,
            preview: effort.previewId,
            coverage: effort.coverage,
          })}
        </p>
        <p className={css.breakAll}>
          {t("effort.journal", { digest: effort.journalSha256 })}
        </p>
      </details>
    </div>
  );
}

/** Read one chapter draft's saved text revisions on request. */
export function RevisionEffortPanel({
  automation,
  t,
  projectId,
  previewId,
  taskId,
}: {
  automation: AutomationRemote;
  t: Translate;
  projectId: string;
  previewId: string;
  taskId?: string;
}) {
  const read = useScopedRead(`${projectId}:${previewId}:${taskId ?? ""}`, () =>
    readRevisionEffort(automation, { projectId, previewId, taskId }),
  );
  return (
    <section aria-label={t("effort.panel")} className={css.stack}>
      <Button
        variant="outline"
        size="sm"
        disabled={read.pending}
        onClick={() => void read.run()}
      >
        {read.pending ? t("effort.pending") : t("effort.read")}
      </Button>
      {read.error !== undefined && (
        <p role="alert" className={css.danger}>
          {t("effort.error", { error: failureText(t, read.error) })}
        </p>
      )}
      {read.data && <RevisionEffortView value={read.data} t={t} />}
    </section>
  );
}

/** One page of a run's usage reports, as the agents namespace answers it. */
interface UsagePage {
  runId: string;
  projectId?: string;
  observationCount: number;
  nextCursor?: number;
  items: UsageItem[];
}

interface UsageNumber {
  status: string;
  value?: unknown;
}

interface UsageItem {
  cursor: number;
  sessionId: string;
  engineKind: string;
  measurementScope: keyof typeof USAGE_SCOPES;
  inputTokens: UsageNumber;
  outputTokens: UsageNumber;
  cachedTokens: UsageNumber;
  costEstimate?: { amount: UsageNumber; currency: UsageNumber };
  inputAccounting: string;
  recordedAt: string;
}

const USAGE_SCOPES = {
  "response-increment": "usage.scope.response",
  "run-total": "usage.scope.run",
  "session-total": "usage.scope.session",
  unspecified: "usage.scope.unspecified",
} as const;

const ACCOUNTING = {
  "includes-cache": "usage.accounting.includes",
  "excludes-cache": "usage.accounting.excludes",
} as const;

function reported(
  t: Translate,
  number: UsageNumber,
  invalid: Parameters<Translate>[0],
  unreported: Parameters<Translate>[0],
  format: (value: never) => string = String,
): string {
  return number.status === "reported"
    ? format(number.value as never)
    : t(number.status === "invalid" ? invalid : unreported);
}

const tokens = (t: Translate, number: UsageNumber) =>
  reported(
    t,
    number,
    "usage.token.invalid",
    "usage.token.unreported",
    (count: number) => count.toLocaleString(),
  );

/** The engine's own usage reports for one run, never billing or totals. */
function UsageView({
  pages,
  t,
}: {
  pages: readonly UsagePage[];
  t: Translate;
}) {
  const current = pages[0]!;
  return (
    <div className={css.compact} aria-label={t("usage.aria")}>
      <p className={css.small}>
        {t("usage.run", {
          runId: current.runId,
          count: current.observationCount,
        })}
      </p>
      <p className={css.small}>
        {t("usage.scopeLine", {
          scope: current.projectId
            ? t("usage.scope.project", { projectId: current.projectId })
            : t("usage.scope.global"),
        })}
      </p>
      {!current.observationCount && <p>{t("usage.empty")}</p>}
      {pages
        .flatMap((page) => page.items)
        .map((item) => (
          <div key={item.cursor} className={css.block}>
            <p>
              {t("usage.item.scope", {
                scope: t(USAGE_SCOPES[item.measurementScope]),
                cursor: item.cursor,
              })}
            </p>
            <p>
              {t("usage.item.tokens", {
                input: tokens(t, item.inputTokens),
                output: tokens(t, item.outputTokens),
                cached: tokens(t, item.cachedTokens),
              })}
            </p>
            <p>
              {item.costEstimate
                ? t("usage.cost", {
                    amount: reported(
                      t,
                      item.costEstimate.amount,
                      "usage.amount.invalid",
                      "usage.amount.unreported",
                    ),
                    currency: reported(
                      t,
                      item.costEstimate.currency,
                      "usage.currency.invalid",
                      "usage.currency.unreported",
                    ),
                  })
                : t("usage.noCost")}
            </p>
            <p className={css.small}>
              {t("usage.accounting", {
                accounting: t(
                  ACCOUNTING[item.inputAccounting as keyof typeof ACCOUNTING] ??
                    "usage.accounting.unspecified",
                ),
                at: item.recordedAt,
              })}
            </p>
          </div>
        ))}
      <p className={css.small}>{t("usage.note")}</p>
    </div>
  );
}

/**
 * Read one run's usage reports on request, a page at a time. A report from
 * another session or engine, or a page whose identity moved, stops the read.
 */
export function UsageObservations({
  agents,
  t,
  runId,
  projectId,
}: {
  agents: AgentsRemote;
  t: Translate;
  runId: string;
  projectId?: string;
}) {
  const [pages, setPages] = useState<UsagePage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const scope = `${projectId ?? "global"}:${runId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  useEffect(() => {
    setPages([]);
    setError(undefined);
    setPending(false);
    return () => {
      generation.current += 1;
    };
  }, [scope]);
  const load = async (cursor?: number) => {
    const current = ++generation.current;
    setPending(true);
    setError(undefined);
    try {
      const page = await value<UsagePage>(
        agents.agentUsageObservationsList(runId, {
          ...(projectId === undefined ? {} : { projectId }),
          ...(cursor === undefined ? {} : { cursor }),
          limit: 25,
        }),
      );
      if (generation.current !== current || currentScope.current !== scope)
        return;
      if (
        cursor !== undefined &&
        (pages.at(-1)?.nextCursor !== cursor ||
          page.items.some((item) =>
            pages.some((old) =>
              old.items.some((saved) => saved.cursor === item.cursor),
            ),
          ))
      ) {
        setError(t("usage.changed"));
        return;
      }
      setPages(cursor === undefined ? [page] : [...pages, page]);
    } catch (cause) {
      if (generation.current === current && currentScope.current === scope)
        setError(messageOf(cause));
    } finally {
      if (generation.current === current && currentScope.current === scope)
        setPending(false);
    }
  };
  const next = pages.at(-1)?.nextCursor;
  return (
    <section aria-label={t("usage.panel")} className={css.stack}>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void load()}
      >
        {t(
          pending
            ? "usage.load.pending"
            : pages.length
              ? "usage.load.again"
              : "usage.load.first",
        )}
      </Button>
      {error && (
        <p role="alert" className={css.danger}>
          {t("usage.error", { error })}
        </p>
      )}
      {pages.length > 0 &&
        pages[0]!.runId === runId &&
        pages[0]!.projectId === projectId && <UsageView pages={pages} t={t} />}
      {next !== undefined && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void load(next)}
        >
          {t("usage.older")}
        </Button>
      )}
    </section>
  );
}

/** Props of {@link CreationExecutionPanel}. */
export interface CreationExecutionPanelProps {
  automation: AutomationRemote;
  agents: AgentsRemote;
  t: Translate;
  workflow: CreationWorkflow;
}

/**
 * Every stage run of one workflow attempt on request, with each run's usage
 * reports and frozen context, and for a chapter draft its saved revisions.
 */
export function CreationExecutionPanel({
  automation,
  agents,
  t,
  workflow,
}: CreationExecutionPanelProps) {
  const read = useScopedRead(
    `${workflow.input.projectId}:${workflow.id}:${workflow.version}:${workflow.runIds.join(",")}`,
    () => readExecution(automation, workflow),
  );
  const receipt = read.data;
  return (
    <section aria-label={t("execution.panel")} className={css.stack}>
      {workflow.input.operation === "chapter" && workflow.previewId && (
        <RevisionEffortPanel
          automation={automation}
          t={t}
          projectId={workflow.input.projectId}
          previewId={workflow.previewId}
          taskId={workflow.taskId}
        />
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={read.pending}
        onClick={() => void read.run()}
      >
        {read.pending ? t("execution.pending") : t("execution.read")}
      </Button>
      {read.error !== undefined && (
        <p role="alert" className={css.danger}>
          {t("execution.error", { error: failureText(t, read.error) })}
        </p>
      )}
      {receipt && (
        <CreationExecutionView
          receipt={receipt}
          t={t}
          renderUsage={(runId) => (
            <UsageObservations
              key={`${workflow.input.projectId}:${runId}`}
              agents={agents}
              t={t}
              runId={runId}
              projectId={workflow.input.projectId}
            />
          )}
          renderContext={(runId) => (
            <CreationRunContextPanel
              key={`${workflow.input.projectId}:${runId}`}
              automation={automation}
              agents={agents}
              t={t}
              workflow={workflow}
              runId={runId}
            />
          )}
        />
      )}
    </section>
  );
}
