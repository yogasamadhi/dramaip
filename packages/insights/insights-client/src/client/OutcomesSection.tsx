import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import type {
  CreativeContinuationGlobal,
  CreativeOutcomePage,
  CreativeOutcomeSummary,
} from "@dramaip/insights-insights/types";
import { ExecutionsPanel } from "./ExecutionsPanel.tsx";
import {
  ConfigurationFunnelPanel,
  DeliveryCoveragePanel,
  RevisionEffortPanel,
} from "./MeasurePanels.tsx";
import {
  percent,
  seconds,
  useRead,
  usePaged,
  value,
  when,
  type AgentsRemote,
  type InsightsRemote,
  type Translate,
} from "./outcome-reads.ts";
import css from "./Outcomes.module.css";
import { PlanningOutcomes } from "./PlanningOutcomes.tsx";
import { SourceConfirmations } from "./SourceConfirmations.tsx";
import type {} from "./contract.ts";

type Summary = CreativeOutcomeSummary;
type OutcomeKind = Summary["counts"][number]["kind"];
type Metric = Summary["funnel"]["measures"][number]["metric"];
type ContinuationState =
  Summary["continuation"]["observations"][number]["state"];

const OUTCOME_KINDS = {
  "novel.chapter-adopted": "outcomes.kind.chapterAdopted",
  "novel.planning-adopted": "outcomes.kind.planningAdopted",
  "novel.chapter-memory-written": "outcomes.kind.memoryWritten",
  "novel.manuscript-exported": "outcomes.kind.manuscriptExported",
  "adaptation.diagnosis-adopted": "outcomes.kind.diagnosisAdopted",
  "adaptation.strategy-adopted": "outcomes.kind.strategyAdopted",
  "adaptation.season-plan-adopted": "outcomes.kind.seasonPlanAdopted",
  "adaptation.script-adopted": "outcomes.kind.scriptAdopted",
  "adaptation.pilot-package-exported": "outcomes.kind.pilotExported",
} as const satisfies Record<OutcomeKind, string>;

const METRICS = {
  "novel.chapter": "outcomes.metric.chapter",
  "adaptation.diagnosis": "outcomes.metric.diagnosis",
  "adaptation.strategy": "outcomes.metric.strategy",
  "adaptation.season-plan": "outcomes.metric.seasonPlan",
  "adaptation.script": "outcomes.metric.script",
} as const satisfies Record<Metric, string>;

const CONTINUATION_STATES = {
  unobserved: "outcomes.continuation.state.unobserved",
  pending: "outcomes.continuation.state.pending",
  continued: "outcomes.continuation.state.continued",
  "not-started": "outcomes.continuation.state.notStarted",
  "clock-inconsistent": "outcomes.continuation.state.clockInconsistent",
} as const satisfies Record<ContinuationState, string>;

const PATHS = {
  novel: {
    results: "outcomes.counts.novel",
    window: "outcomes.continuation.aria.novel",
    heading: "outcomes.continuation.novel",
  },
  adaptation: {
    results: "outcomes.counts.adaptation",
    window: "outcomes.continuation.aria.adaptation",
    heading: "outcomes.continuation.adaptation",
  },
} as const;

/** The full-book chapter set a source-change rejection compared. */
function ChapterCollectionEvidence({
  frozenIds,
  currentIds,
  t,
}: {
  frozenIds: readonly string[];
  currentIds: readonly string[];
  t: Translate;
}) {
  const added = currentIds.filter((id) => !frozenIds.includes(id));
  const left = frozenIds.filter((id) => !currentIds.includes(id));
  const ids = (list: readonly string[]) =>
    list.join(t("outcomes.list")) || t("outcomes.none");
  return (
    <section aria-label={t("outcomes.chapters.aria")} className={css.flat}>
      <p className={css.text}>
        {t("outcomes.chapters.counts", {
          frozen: frozenIds.length,
          current: currentIds.length,
        })}
      </p>
      <p className={css.text}>
        {t("outcomes.chapters.added", { ids: ids(added) })}
      </p>
      <p className={css.text}>
        {t("outcomes.chapters.left", { ids: ids(left) })}
      </p>
      <p className={css.text}>{t("outcomes.chapters.note")}</p>
    </section>
  );
}

/** The initial goals the project creations confirmed. */
function GoalConfirmations({
  value,
  t,
}: {
  value: Summary["goalConfirmations"];
  t: Translate;
}) {
  if (value.recordedProjects === 0) return null;
  return (
    <section aria-label={t("outcomes.goal.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.goal.title")}</h3>
      {value.items.map((goal) => (
        <div key={goal.eventId} data-initial-goal-project-id={goal.projectId}>
          <p className={css.text}>
            {t("outcomes.goal.choice", {
              goal: t(
                goal.goal === "novel-first"
                  ? "outcomes.goal.novelFirst"
                  : "outcomes.goal.scriptFirst",
              ),
              material: t(
                goal.material === "inspiration"
                  ? "outcomes.goal.material.inspiration"
                  : goal.material === "source-import"
                    ? "outcomes.goal.material.sourceImport"
                    : "outcomes.goal.material.script",
              ),
            })}
          </p>
          <p className={css.text}>
            {t("outcomes.goal.origin", {
              projectId: goal.projectId,
              version: goal.projectVersion,
              at: when(goal.occurredAt),
            })}
          </p>
        </div>
      ))}
      <p className={css.small}>{t("outcomes.goal.note")}</p>
    </section>
  );
}

/** The quality-report adoptions and the recorded outcomes they name. */
function QualityAssociations({
  value,
  t,
}: {
  value: Summary["qualityAssociations"];
  t: Translate;
}) {
  if (value.recordedReports === 0) return null;
  return (
    <section aria-label={t("outcomes.quality.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.quality.title")}</h3>
      <p className={css.text}>
        {t("outcomes.quality.counts", {
          recorded: value.recordedReports,
          exact: value.reportsWithExactTarget,
          scope: value.reportsWithScopeMembers,
          unlinked: value.reportsWithoutRecordedOutcome,
        })}
      </p>
      <p className={css.small}>{t("outcomes.quality.note")}</p>
      <p className={css.small}>
        {t("outcomes.quality.units", { units: value.linkedResultUnits })}
      </p>
      {value.items.map((report) => (
        <details
          key={report.report.id}
          className={css.item}
          data-quality-adoption-report-id={report.report.id}
        >
          <summary className={css.summary}>
            {t("outcomes.quality.report", {
              id: report.report.id,
              version: report.report.version,
              links: report.links.length,
            })}
          </summary>
          <p className={css.text}>
            {t("outcomes.quality.target", {
              workflowId: report.workflowId,
              kind: report.target.kind,
              id: report.target.id,
              version: report.target.version,
            })}
          </p>
          {report.target.sourceFingerprint && (
            <p className={css.text}>
              {t("outcomes.quality.source", {
                fingerprint: report.target.sourceFingerprint,
              })}
            </p>
          )}
          <p className={css.text}>
            {t("outcomes.quality.dimensions", {
              dimensions: report.requestedDimensions.join(t("outcomes.list")),
            })}
          </p>
          {report.chapterScope && (
            <div>
              <p className={css.text}>
                {t("outcomes.quality.scope", {
                  mode: t(
                    report.chapterScope.mode === "full"
                      ? "outcomes.quality.scope.full"
                      : "outcomes.quality.scope.selected",
                  ),
                  included: report.chapterScope.included.length,
                  nonEmpty: report.chapterScope.nonEmptyChapterCount,
                  total: report.chapterScope.totalChapterCount,
                })}
              </p>
              {report.chapterScope.included.map((chapter) => (
                <p key={chapter.id} className={css.text}>
                  {t("outcomes.quality.chapter", {
                    id: chapter.id,
                    version: chapter.version,
                    representations: chapter.representations.join(
                      t("outcomes.list"),
                    ),
                  })}
                </p>
              ))}
            </div>
          )}
          {report.links.length ? (
            report.links.map((link) => (
              <p
                key={`${link.unitKey}:${link.formalVersion.kind}:${link.formalVersion.id}`}
                className={css.text}
              >
                {t("outcomes.quality.link", {
                  relation: t(
                    link.relation === "exact-target-version"
                      ? "outcomes.quality.link.exact"
                      : "outcomes.quality.link.scope",
                  ),
                  kind: t(OUTCOME_KINDS[link.outcomeKind]),
                  id: link.formalVersion.id,
                  version: link.formalVersion.version,
                })}
              </p>
            ))
          ) : (
            <p className={css.text}>{t("outcomes.quality.noLinks")}</p>
          )}
          <p className={css.small}>
            {t("outcomes.quality.at", { at: when(report.occurredAt) })}
          </p>
        </details>
      ))}
    </section>
  );
}

/** Each path's fixed seven-day continuation window, with the global cohort. */
function ContinuationWindows({
  value,
  global,
  t,
}: {
  value: Summary["continuation"];
  global: CreativeContinuationGlobal | undefined;
  t: Translate;
}) {
  return (
    <section
      aria-label={t("outcomes.continuation.title")}
      className={css.block}
    >
      <h3 className={css.heading}>{t("outcomes.continuation.title")}</h3>
      <p className={css.small}>{t("outcomes.continuation.intro")}</p>
      {global?.projection.state !== "healthy" && (
        <p role="status" className={css.smallWarning}>
          {t("outcomes.continuation.lag")}
        </p>
      )}
      <div className={css.grid}>
        {value.observations.map((item) => {
          const cohort = global?.measures.find(
            (measure) => measure.workflowPath === item.workflowPath,
          );
          const path = PATHS[item.workflowPath];
          return (
            <section
              key={item.workflowPath}
              aria-label={t(path.window)}
              className={css.item}
            >
              <h4 className={css.subheading}>{t(path.heading)}</h4>
              <p className={css.text}>
                {t("outcomes.continuation.current", {
                  state: t(CONTINUATION_STATES[item.state]),
                })}
              </p>
              {item.baseline && (
                <p className={css.small}>
                  {t("outcomes.continuation.baseline", {
                    start: when(item.baseline.adoptedAt),
                    deadline: when(item.baseline.deadline),
                  })}
                </p>
              )}
              <p className={css.small}>
                {t("outcomes.continuation.counts", {
                  requests: item.recordedRequests,
                  starts: item.successfulStarts,
                  next: item.nextAdoptedTargets,
                  unlinked: item.unlinkedRequests,
                })}
              </p>
              <p className={css.small}>
                {t("outcomes.continuation.started", {
                  state: t(
                    item.firstStarted
                      ? item.firstStarted.withinWindow
                        ? "outcomes.continuation.started.within"
                        : "outcomes.continuation.started.outside"
                      : "outcomes.continuation.started.none",
                  ),
                })}
              </p>
              {cohort ? (
                <div className={css.small}>
                  <p className={css.text}>
                    {t("outcomes.continuation.cohort", {
                      continued: cohort.continuedProjects,
                      matured: cohort.maturedProjects,
                      ratio:
                        cohort.continuationRatio === null
                          ? t("outcomes.continuation.cohort.none")
                          : percent(cohort.continuationRatio),
                    })}
                  </p>
                  <p className={css.text}>
                    {t("outcomes.continuation.cohort.pending", {
                      pending: cohort.pendingProjects,
                      early: cohort.observedEarlyContinuations,
                      clock: cohort.clockUnknownProjects,
                      unobserved: cohort.unobservedBaselineProjects,
                    })}
                  </p>
                </div>
              ) : (
                <p className={css.small}>
                  {t("outcomes.continuation.cohort.unread")}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <p className={css.small}>{t("outcomes.continuation.note")}</p>
    </section>
  );
}

type Measure = Summary["funnel"]["measures"][number];

/** The last source change a rejected first candidate recorded. */
function SourceConflict({
  conflict,
  t,
}: {
  conflict: NonNullable<Measure["lastSourceConflict"]>;
  t: Translate;
}) {
  const source = conflict.sourceConflict;
  const chapters =
    "chapterCollection" in source ? source.chapterCollection : undefined;
  return (
    <details
      className={css.small}
      data-source-conflict-workflow={source.workflowId}
    >
      <summary className={css.brandSummary}>
        {t("outcomes.first.conflict.summary")}
      </summary>
      <p className={css.text}>
        {t("outcomes.first.conflict.ids", {
          workflowId: source.workflowId,
          candidateId: conflict.candidate.id,
          fingerprint: conflict.candidate.contentFingerprint,
        })}
      </p>
      {conflict.ownerRejection && (
        <p className={css.text}>
          {t("outcomes.first.conflict.owner", {
            type: conflict.ownerRejection.aggregateType,
            version: conflict.ownerRejection.stateVersion,
          })}
        </p>
      )}
      {source.changes.map((change) => (
        <p
          key={`${change.sourceKind}:${change.frozen.id}`}
          className={css.text}
        >
          {t("outcomes.first.conflict.change", {
            kind: change.sourceKind,
            frozenId: change.frozen.id,
            frozenVersion: change.frozen.version,
            currentId: change.current.id,
            currentVersion: change.current.version,
          })}
        </p>
      ))}
      {chapters && <ChapterCollectionEvidence {...chapters} t={t} />}
      <p className={css.text}>
        {t("outcomes.first.conflict.at", { at: when(conflict.occurredAt) })}
      </p>
    </details>
  );
}

/** Each target's first candidate: adopted as is, revised, or still open. */
function FirstCandidates({
  value,
  t,
}: {
  value: Summary["funnel"];
  t: Translate;
}) {
  return (
    <section aria-label={t("outcomes.first.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.first.title")}</h3>
      <details>
        <summary className={css.summary}>
          <span className={css.small}>{t("outcomes.scope.summary")}</span>
        </summary>
        <div className={css.flat}>
          <p className={css.small}>{t("outcomes.first.scope.requests")}</p>
          <p className={css.small}>{t("outcomes.first.scope.conflicts")}</p>
          <p className={css.small}>{t("outcomes.first.scope.rejections")}</p>
        </div>
      </details>
      <div className={css.grid}>
        {value.measures.map((measure) => {
          const metric = t(METRICS[measure.metric]);
          const accepted = measure.firstAccepted;
          return (
            <section
              key={measure.metric}
              aria-label={t("outcomes.first.aria", { metric })}
              className={css.item}
            >
              <h4 className={css.subheading}>{metric}</h4>
              <p className={css.text}>
                {t("outcomes.first.adopted", {
                  mode: t(
                    measure.metric === "adaptation.strategy"
                      ? "outcomes.first.adopted.option"
                      : "outcomes.first.adopted.direct",
                  ),
                  adopted: measure.firstAdopted,
                  first: measure.firstCandidates,
                  ratio:
                    measure.firstCandidateAdoptionRatio === null
                      ? t("outcomes.first.ratio.none")
                      : percent(measure.firstCandidateAdoptionRatio),
                })}
              </p>
              <p className={css.small}>
                {t("outcomes.first.decisions", {
                  pending: measure.pendingDecision,
                  closed: measure.closedWithoutFirstAdoption,
                  revised: measure.revisedAdoption,
                })}
              </p>
              <p className={css.small}>
                {t("outcomes.first.requests", {
                  requests: measure.recordedRequests,
                  targets: measure.requestedTargets,
                  unobserved: measure.unobservedFirstTargets,
                  retries: measure.retryCandidates,
                  rejected: measure.adoptionRejectedCount,
                })}
              </p>
              <p className={css.small}>
                {t("outcomes.first.conflicts", {
                  count: measure.sourceConflictCandidateCount,
                })}
              </p>
              {measure.lastSourceConflict && (
                <SourceConflict conflict={measure.lastSourceConflict} t={t} />
              )}
              {accepted ? (
                <div className={css.small}>
                  <p className={css.text}>
                    {t("outcomes.first.accepted", {
                      mode:
                        accepted.adoptionMode === "selected-option"
                          ? t("outcomes.first.accepted.option", {
                              id: accepted.selectedOption!.id,
                            })
                          : t(
                              accepted.adoptionMode === "exact-candidate"
                                ? "outcomes.first.accepted.exact"
                                : "outcomes.first.accepted.revised",
                            ),
                    })}
                  </p>
                  <p className={css.text}>
                    {t("outcomes.first.durations", {
                      ready: seconds(t, accepted.requestToReadyMs),
                      review: seconds(t, accepted.readyToAdoptMs),
                      total: seconds(t, accepted.requestToAdoptMs),
                    })}
                  </p>
                </div>
              ) : (
                <p className={css.small}>{t("outcomes.first.noTiming")}</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

const RECEIPT_STATUSES = {
  saved: "outcomes.receipt.saved",
  written: "outcomes.receipt.written",
  adopted: "outcomes.receipt.adopted",
} as const;

/** The authoritative receipts, newest first, without any manuscript text. */
function Receipts({
  pages,
  more,
  hasMore,
  pendingMore,
  t,
}: {
  pages: readonly CreativeOutcomePage[] | undefined;
  more: () => void;
  hasMore: boolean;
  pendingMore: boolean;
  t: Translate;
}) {
  const items = pages?.flatMap((page) => page.items) ?? [];
  return (
    <details>
      <summary className={css.brandSummary}>
        {t("outcomes.receipt.summary")}
      </summary>
      <ol className={css.list}>
        {items.map((item) => (
          <li key={item.eventId} className={css.receipt}>
            <p className={css.text}>
              {t("outcomes.receipt.line", {
                kind: t(OUTCOME_KINDS[item.kind]),
                status: t(
                  RECEIPT_STATUSES[
                    item.resultStatus as keyof typeof RECEIPT_STATUSES
                  ] ?? RECEIPT_STATUSES.adopted,
                ),
                at: when(item.occurredAt),
              })}
            </p>
            <p className={css.small}>
              {t("outcomes.receipt.object", {
                objectId: item.objectId,
                label: t(
                  item.resultStatus === "written"
                    ? "outcomes.receipt.version.written"
                    : "outcomes.receipt.version.formal",
                ),
                versions: item.formalVersions
                  .map((ref) => `${ref.kind}:${ref.id}@${ref.version}`)
                  .join(t("outcomes.list")),
              })}
            </p>
            <p className={css.small}>
              {t("outcomes.receipt.unit", { unitKey: item.unitKey })}
            </p>
            {item.selectedOption && (
              <p className={css.small}>
                {t("outcomes.receipt.option", {
                  id: item.selectedOption.id,
                  fingerprint: item.selectedOption.contentFingerprint,
                })}
              </p>
            )}
            {item.memoryWrite && (
              <p className={css.small}>
                {t("outcomes.receipt.memory", {
                  id: item.memoryWrite.source.id,
                  version: item.memoryWrite.source.version,
                  fingerprint: item.memoryWrite.source.contentFingerprint,
                  count: item.memoryWrite.records.length,
                })}
              </p>
            )}
          </li>
        ))}
      </ol>
      {pages && !items.length && (
        <p className={css.muted}>{t("outcomes.receipt.empty")}</p>
      )}
      {hasMore && (
        <button
          type="button"
          className={css.link}
          disabled={pendingMore}
          onClick={more}
        >
          {t("outcomes.receipt.more")}
        </button>
      )}
    </details>
  );
}

/** Props of the outcomes ledger once a project is chosen. */
export interface OutcomesLedgerProps {
  insights: InsightsRemote;
  agents: AgentsRemote;
  projectId: string;
  t: Translate;
}

/**
 * The project's local outcome ledger: what the author formally adopted,
 * wrote into memory and saved, its first-candidate and continuation measures,
 * and the authoritative receipts. Mount it keyed by project, so no ledger of
 * an earlier project survives a switch.
 */
export function OutcomesLedger({
  insights,
  agents,
  projectId,
  t,
}: OutcomesLedgerProps) {
  const continuation = useRead(() =>
    value<CreativeContinuationGlobal>(insights.continuationSummary()),
  );
  const summary = useRead(() =>
    value<Summary>(insights.outcomeSummary(projectId)),
  );
  const events = usePaged(
    (cursor: number | undefined) =>
      value<CreativeOutcomePage>(
        insights.outcomes(projectId, {
          ...(cursor === undefined ? {} : { cursor: String(cursor) }),
          limit: 25,
        }),
      ),
    (page) => page.nextCursor,
  );
  const error = summary.error ?? events.error ?? continuation.error;
  const data = summary.data;
  return (
    <section aria-label={t("outcomes.title")} className={css.section}>
      <div className={css.head}>
        <h2 className={css.title}>{t("outcomes.title")}</h2>
        <button
          type="button"
          className={css.link}
          disabled={summary.pending || events.pending || continuation.pending}
          onClick={() => {
            summary.refresh();
            events.refresh();
            continuation.refresh();
          }}
        >
          {t("outcomes.refresh")}
        </button>
      </div>
      <p className={css.muted}>{t("outcomes.intro")}</p>
      <details>
        <summary className={css.summary}>
          <span className={css.small}>{t("outcomes.scope.summary")}</span>
        </summary>
        <div className={css.flat}>
          <p className={css.muted}>{t("outcomes.scope.counts")}</p>
          <p className={css.muted}>{t("outcomes.scope.facts")}</p>
          <p className={css.small}>{t("outcomes.scope.memory")}</p>
        </div>
      </details>
      <ExecutionsPanel
        key={projectId}
        insights={insights}
        agents={agents}
        projectId={projectId}
        t={t}
      />
      <DeliveryCoveragePanel
        key={`delivery:${projectId}`}
        insights={insights}
        projectId={projectId}
        t={t}
      />
      <RevisionEffortPanel
        key={`revisions:${projectId}`}
        insights={insights}
        projectId={projectId}
        t={t}
      />
      <ConfigurationFunnelPanel
        key={`configuration:${projectId}`}
        insights={insights}
        projectId={projectId}
        t={t}
      />
      {error && (
        <p role="alert" className={css.alert}>
          {t("outcomes.error", { error })}
        </p>
      )}
      {summary.pending && !data && (
        <p className={css.muted}>{t("outcomes.loading")}</p>
      )}
      {data && !error && (
        <>
          {data.projection.state !== "healthy" && (
            <p role="status" className={css.warning}>
              {t("outcomes.lag")}
            </p>
          )}
          <GoalConfirmations value={data.goalConfirmations} t={t} />
          <SourceConfirmations value={data.sourceConfirmations} t={t} />
          <PlanningOutcomes
            batches={data.planningBatches}
            funnel={data.planningFunnel}
            t={t}
          />
          <div className={css.grid}>
            {(["novel", "adaptation"] as const).map((path) => (
              <section key={path} className={css.block}>
                <h3 className={css.heading}>{t(PATHS[path].results)}</h3>
                {data.counts
                  .filter((item) => item.kind.startsWith(`${path}.`))
                  .map((item) => (
                    <p key={item.kind} className={css.row}>
                      <span>{t(OUTCOME_KINDS[item.kind])}</span>
                      <span>
                        {t("outcomes.counts.line", {
                          total: item.total,
                          recent: item.lastSevenDays,
                        })}
                      </span>
                    </p>
                  ))}
              </section>
            ))}
          </div>
          <p className={css.small}>{t("outcomes.counts.note")}</p>
          <QualityAssociations value={data.qualityAssociations} t={t} />
          <ContinuationWindows
            value={data.continuation}
            global={continuation.data}
            t={t}
          />
          <FirstCandidates value={data.funnel} t={t} />
        </>
      )}
      <Receipts
        pages={
          error ? undefined : events.pages.length ? events.pages : undefined
        }
        more={events.more}
        hasMore={events.hasMore}
        pendingMore={events.pendingMore}
        t={t}
      />
    </section>
  );
}

/** Props of the outcomes section of the insights page. */
export type OutcomesSectionProps = PropsRuntime<"insights.section"> &
  PropsLocale<"insights"> & {
    insights: InsightsRemote;
    agents: AgentsRemote;
  };

/** The outcome ledgers of the chosen project; nothing before one is chosen. */
export function OutcomesSection({
  projectId,
  insights,
  agents,
  t,
}: OutcomesSectionProps) {
  return projectId ? (
    <OutcomesLedger
      key={projectId}
      insights={insights}
      agents={agents}
      projectId={projectId}
      t={t}
    />
  ) : null;
}
