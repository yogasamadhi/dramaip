import { useState } from "react";
import type {
  CreativeExecutionRequestList,
  CreativeWorkflowExecution,
  CreativeWorkflowExecutionDetail,
} from "@dramaip/insights-insights/types";
import {
  usePaged,
  value,
  type AgentsRemote,
  type InsightsRemote,
  type RecordedModel,
  type Translate,
} from "./outcome-reads.ts";
import {
  UsageObservations,
  UsageObservationView,
} from "./UsageObservations.tsx";
import css from "./Outcomes.module.css";

const STATES = {
  missing: "outcomes.exec.state.missing",
  unavailable: "outcomes.exec.state.unavailable",
  "read-failed": "outcomes.exec.state.readFailed",
} as const;

const PHASES = {
  generating: "outcomes.exec.phase.generating",
  checking: "outcomes.exec.phase.checking",
  revising: "outcomes.exec.phase.revising",
  rechecking: "outcomes.exec.phase.rechecking",
} as const;

type Phase = keyof typeof PHASES;
type History = CreativeWorkflowExecution["facts"]["items"];

const groupModel = (t: Translate, model: RecordedModel) =>
  model.status === "recorded"
    ? t("outcomes.exec.group.model", {
        model: model.modelId,
        provider: model.providerId ?? t("outcomes.unrecorded"),
        profile: model.profileId ?? t("outcomes.unrecorded"),
      })
    : t(
        model.status === "invalid"
          ? "outcomes.exec.group.model.invalid"
          : "outcomes.exec.group.model.unrecorded",
      );

const runModel = (t: Translate, model: RecordedModel) =>
  model.status === "recorded"
    ? t("outcomes.exec.run.model", {
        model: model.modelId,
        provider: model.providerId ?? t("outcomes.unrecorded"),
      })
    : t(
        model.status === "invalid"
          ? "outcomes.model.invalid"
          : "outcomes.model.unrecorded",
      );

/** The run statistics of one original attempt, grouped by its configuration. */
export function ExecutionStatisticsView({
  statistics,
  t,
}: {
  statistics: CreativeWorkflowExecutionDetail["statistics"];
  t: Translate;
}) {
  return (
    <section aria-label={t("outcomes.exec.stats.title")} className={css.item}>
      <h4 className={css.subheading}>{t("outcomes.exec.stats.title")}</h4>
      <p className={css.small}>{t("outcomes.exec.stats.intro")}</p>
      {statistics.state !== "recorded" ? (
        <p role="status" className={css.text}>
          {t("outcomes.exec.stats.none", {
            state: t(STATES[statistics.state]),
          })}
        </p>
      ) : (
        <>
          <p className={css.text}>
            {t("outcomes.exec.stats.counts", {
              runs: statistics.runCount,
              recorded: statistics.recordedRunCount,
              missing: statistics.missingRunIds.length,
              revisions: statistics.revisionRunIds.length,
            })}
          </p>
          {statistics.runCount === 0 && (
            <p className={css.text}>{t("outcomes.exec.stats.noRuns")}</p>
          )}
          {statistics.missingRunIds.map((id) => (
            <p key={id} className={css.text}>
              {t("outcomes.exec.stats.missingRun", { id })}
            </p>
          ))}
          {statistics.groups.map((group, index) => {
            const { model, engineKind } = group.configuration;
            const timing = group.timing;
            return (
              <section
                key={index}
                aria-label={t("outcomes.exec.group.aria", {
                  index: index + 1,
                })}
                className={css.flat}
              >
                <p className={css.text}>
                  {t("outcomes.exec.group.line", {
                    index: index + 1,
                    engine: engineKind,
                    model: groupModel(t, model as RecordedModel),
                  })}
                </p>
                <p className={css.text}>
                  {t("outcomes.exec.group.timing", {
                    runs: group.runs.length,
                    measured: timing.measuredCount,
                    inProgress: timing.inProgressCount,
                    unrecorded: timing.unrecordedCount,
                    invalid: timing.invalidCount,
                    range:
                      timing.minDurationMs === null
                        ? t("outcomes.unknown")
                        : t("outcomes.exec.group.range", {
                            min: timing.minDurationMs,
                            max: timing.maxDurationMs,
                          }),
                  })}
                </p>
                {group.runs.map((run) => (
                  <p key={run.runId} className={css.text}>
                    {t("outcomes.exec.group.run", {
                      phase: t(PHASES[run.phase as Phase]),
                      status: run.status,
                      runId: run.runId,
                    })}
                  </p>
                ))}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

/** One original workflow: its request, its recorded facts and each run. */
export function WorkflowExecutionView({
  detail,
  history = detail.execution.facts.items,
  t,
}: {
  detail: CreativeWorkflowExecutionDetail;
  history?: History;
  t: Translate;
}) {
  const value = detail.execution;
  const request = value.request.record.fact;
  return (
    <section
      aria-label={t("outcomes.exec.workflow.aria")}
      className={css.flat}
      data-creative-execution-workflow-id={value.workflowId}
    >
      <p className={css.text}>
        {t("outcomes.exec.workflow.line", {
          workflowId: value.workflowId,
          operation: detail.operation,
          eventId: value.request.record.eventId,
        })}
      </p>
      {request.kind === "request" && (
        <p className={css.text}>
          {t(
            request.parentWorkflowId
              ? "outcomes.exec.workflow.request.parent"
              : "outcomes.exec.workflow.request",
            {
              attempt: request.targetAttempt,
              kind: request.requestKind,
              at: request.requestedAt,
              parent: request.parentWorkflowId ?? "",
            },
          )}
        </p>
      )}
      {value.projection.state !== "healthy" && (
        <p role="status" className={css.text}>
          {t("outcomes.exec.workflow.lag")}
        </p>
      )}
      <p className={css.small}>{t("outcomes.exec.workflow.note")}</p>
      <ExecutionStatisticsView statistics={detail.statistics} t={t} />
      <div className={css.flat} aria-label={t("outcomes.exec.history.aria")}>
        {history.map((item) => {
          const fact =
            item.family === "outcome" ? item.record : item.record.fact;
          let line = t("outcomes.exec.history.line", {
            eventId: item.record.eventId,
            cursor: item.record.cursor,
            kind: fact.kind,
          });
          if ("candidate" in fact && fact.candidate)
            line += t("outcomes.exec.history.candidate", {
              id: fact.candidate.id,
              fingerprint: fact.candidate.contentFingerprint,
            });
          if (item.family === "outcome")
            line += t("outcomes.exec.history.formal", {
              versions: item.record.formalVersions
                .map((ref) => `${ref.kind}:${ref.id}@${ref.version}`)
                .join(t("outcomes.list")),
            });
          if (item.family === "planning-adoption")
            line += t("outcomes.exec.history.batch", {
              count: item.record.fact.records.length,
            });
          return (
            <p key={item.record.eventId} className={css.text}>
              {line}
            </p>
          );
        })}
      </div>
      {value.execution.state !== "recorded" ? (
        <p role="status" className={css.text}>
          {t(STATES[value.execution.state])}
        </p>
      ) : value.execution.receipt.runs.length === 0 ? (
        <p className={css.text}>{t("outcomes.exec.noRuns")}</p>
      ) : (
        value.execution.receipt.runs.map((run) => {
          if (run.state === "missing")
            return (
              <p key={run.runId} className={css.text}>
                {t("outcomes.exec.run.missing", {
                  runId: run.runId,
                  state: t(STATES.missing),
                })}
              </p>
            );
          const observation =
            value.execution.state === "recorded"
              ? value.execution.usage.find((usage) => usage.runId === run.runId)
              : undefined;
          const phase = t(PHASES[run.phase as Phase]);
          const timing = run.execution.timing;
          return (
            <section
              key={run.runId}
              aria-label={t("outcomes.exec.run.aria", { phase })}
              className={css.item}
            >
              <p className={css.text}>
                {t("outcomes.exec.run.line", {
                  phase,
                  runId: run.runId,
                  sessionId: run.execution.sessionId,
                  engine: run.execution.engineKind,
                  status: run.execution.status,
                })}
              </p>
              <p className={css.text}>
                {t("outcomes.exec.run.context", {
                  context:
                    run.execution.contextSnapshotId ?? t("outcomes.unrecorded"),
                  model: runModel(t, run.execution.model as RecordedModel),
                })}
              </p>
              <p className={css.text}>
                {t("outcomes.exec.run.timing", {
                  timing:
                    timing.status === "measured"
                      ? t("outcomes.exec.run.timing.measured", {
                          ms: timing.durationMs,
                        })
                      : t(
                          timing.status === "in-progress"
                            ? "outcomes.exec.run.timing.running"
                            : timing.status === "invalid"
                              ? "outcomes.exec.run.timing.invalid"
                              : "outcomes.exec.run.timing.unrecorded",
                        ),
                })}
              </p>
              {observation?.state === "recorded" ? (
                <UsageObservationView pages={[observation.page]} t={t} />
              ) : (
                <p className={css.text}>
                  {observation
                    ? t(STATES[observation.state])
                    : t("outcomes.exec.run.noUsage")}
                </p>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}

/** One workflow read on request; a keyed mount keeps no other's pages. */
function WorkflowDetail({
  insights,
  agents,
  projectId,
  workflowId,
  t,
}: {
  insights: InsightsRemote;
  agents: AgentsRemote;
  projectId: string;
  workflowId: string;
  t: Translate;
}) {
  const detail = usePaged(
    (cursor: number | undefined) =>
      value<CreativeWorkflowExecutionDetail>(
        insights.executionDetail(
          projectId,
          workflowId,
          cursor === undefined ? {} : { cursor },
        ),
      ),
    (page) => page.execution.facts.nextCursor,
  );
  const fetching = detail.pending || detail.pendingMore;
  const current = fetching ? undefined : detail.pages[0];
  return (
    <div className={css.flat}>
      {fetching && (
        <p className={css.text}>{t("outcomes.exec.detail.loading")}</p>
      )}
      {detail.error ? (
        <p role="alert" className={css.alert}>
          {t("outcomes.exec.detail.error", { error: detail.error })}
        </p>
      ) : (
        current && (
          <>
            <WorkflowExecutionView
              detail={current}
              history={detail.pages.flatMap(
                (page) => page.execution.facts.items,
              )}
              t={t}
            />
            {detail.hasMore && (
              <button
                type="button"
                className={css.link}
                disabled={fetching}
                onClick={detail.more}
              >
                {t("outcomes.exec.detail.older")}
              </button>
            )}
            {current.execution.execution.state === "recorded" &&
              current.execution.execution.receipt.runs.map(
                (run) =>
                  run.state === "recorded" && (
                    <details key={run.runId} className={css.item}>
                      <summary>
                        {t("outcomes.exec.detail.usage", {
                          phase: t(PHASES[run.phase as Phase]),
                        })}
                      </summary>
                      <UsageObservations
                        agents={agents}
                        t={t}
                        runId={run.runId}
                        projectId={projectId}
                        expectedSessionId={run.execution.sessionId}
                        expectedEngineKind={run.execution.engineKind}
                      />
                    </details>
                  ),
              )}
          </>
        )
      )}
      <button
        type="button"
        className={css.link}
        disabled={fetching}
        onClick={detail.refresh}
      >
        {t("outcomes.exec.detail.reload")}
      </button>
    </div>
  );
}

/**
 * The recorded requests of a project, read on request, and one workflow's
 * runs once the author picks it.
 */
export function ExecutionsPanel({
  insights,
  agents,
  projectId,
  t,
}: {
  insights: InsightsRemote;
  agents: AgentsRemote;
  projectId: string;
  t: Translate;
}) {
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<string>();
  const requests = usePaged(
    (cursor: number | undefined) =>
      value<CreativeExecutionRequestList>(
        insights.executionList(
          projectId,
          cursor === undefined ? {} : { cursor },
        ),
      ),
    (page) => page.nextCursor,
    enabled,
  );
  const items = requests.pages.flatMap((page) =>
    page.items.map((item) => ({
      workflowId: item.record.fact.workflowId,
      operation: page.operations[item.record.fact.workflowId] ?? "",
    })),
  );
  return (
    <section aria-label={t("outcomes.exec.aria")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.exec.title")}</h3>
      <p className={css.small}>{t("outcomes.exec.intro")}</p>
      <button
        type="button"
        className={css.link}
        disabled={requests.pending || requests.pendingMore}
        onClick={() => {
          setSelected(undefined);
          if (enabled) requests.refresh();
          else setEnabled(true);
        }}
      >
        {t("outcomes.exec.read")}
      </button>
      {requests.error ? (
        <p role="alert" className={css.alert}>
          {t("outcomes.exec.error", { error: requests.error })}
        </p>
      ) : (
        enabled &&
        requests.pages.length > 0 &&
        !requests.pending && (
          <>
            {requests.pages[0]?.projection.state !== "healthy" && (
              <p role="status" className={css.text}>
                {t("outcomes.exec.lag")}
              </p>
            )}
            {items.map((item) => (
              <div key={item.workflowId}>
                <button
                  type="button"
                  className={css.link}
                  onClick={() => setSelected(item.workflowId)}
                >
                  {t("outcomes.exec.item", item)}
                </button>
              </div>
            ))}
            {!items.length && (
              <p className={css.text}>{t("outcomes.exec.empty")}</p>
            )}
            {requests.hasMore && (
              <button
                type="button"
                className={css.link}
                disabled={requests.pendingMore}
                onClick={requests.more}
              >
                {t("outcomes.exec.older")}
              </button>
            )}
            {selected && (
              <WorkflowDetail
                key={`${projectId}:${selected}`}
                insights={insights}
                agents={agents}
                projectId={projectId}
                workflowId={selected}
                t={t}
              />
            )}
          </>
        )
      )}
    </section>
  );
}
