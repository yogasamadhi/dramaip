import type { CreativeOutcomeSummary } from "@dramaip/insights-insights/types";
import { percent, seconds, when, type Translate } from "./outcome-reads.ts";
import css from "./Outcomes.module.css";

/** The copy key of each planning operation. */
export const PLANNING_OPERATIONS = {
  characters: "outcomes.planning.op.characters",
  "book-outline": "outcomes.planning.op.bookOutline",
  "chapter-outline": "outcomes.planning.op.chapterOutline",
  "story-arc": "outcomes.planning.op.storyArc",
  "knowledge-plan": "outcomes.planning.op.knowledgePlan",
} as const;

/** Independent planning receipts only, never inferred from current records. */
export function PlanningOutcomes({
  batches,
  funnel,
  t,
}: {
  batches: CreativeOutcomeSummary["planningBatches"];
  funnel: CreativeOutcomeSummary["planningFunnel"];
  t: Translate;
}) {
  // No planning activity keeps the ledger as it was; missing older service
  // evidence still renders as unrecorded rather than a made-up zero.
  if (
    batches?.recordedBatches === 0 &&
    funnel?.unmatchedAdoptionBatches === 0 &&
    funnel.measures.every((item) => item.recordedRequests === 0)
  )
    return null;
  const operation = (id: keyof typeof PLANNING_OPERATIONS) =>
    t(PLANNING_OPERATIONS[id]);
  return (
    <section aria-label={t("outcomes.planning.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.planning.title")}</h3>
      <p className={css.text}>{t("outcomes.planning.intro")}</p>
      {!batches ? (
        <p className={css.text}>{t("outcomes.planning.batches.missing")}</p>
      ) : (
        <>
          <p className={css.text}>
            {t("outcomes.planning.batches.recorded", {
              recorded: batches.recordedBatches,
              shown: batches.items.length,
            })}
          </p>
          <p className={css.text}>
            {batches.counts
              .map((row) =>
                t("outcomes.planning.batches.count", {
                  operation: operation(row.operation),
                  batches: row.batches,
                  records: row.actualRecords,
                }),
              )
              .join(t("outcomes.separator"))}
          </p>
          {batches.items.map((batch) => (
            <details
              key={batch.eventId}
              data-planning-batch-workflow-id={batch.fact.workflowId}
              className={css.item}
            >
              <summary>
                {t("outcomes.planning.batch.summary", {
                  operation: operation(batch.fact.operation),
                  count: batch.fact.recordCount,
                  owner: batch.owner,
                })}
              </summary>
              <p className={css.text}>
                {t("outcomes.planning.batch.workflow", {
                  workflowId: batch.fact.workflowId,
                  candidateId: batch.fact.candidate.id,
                })}
              </p>
              <p className={css.text}>
                {t("outcomes.planning.batch.sha", {
                  fingerprint: batch.fact.candidate.contentFingerprint,
                })}
              </p>
              <p className={css.text}>
                {t("outcomes.planning.batch.committed", {
                  at: when(batch.occurredAt),
                  eventId: batch.eventId,
                })}
              </p>
              {batch.fact.records.map((record) => (
                <p
                  key={record.id}
                  data-planning-original-record-id={record.id}
                  className={css.text}
                >
                  {t("outcomes.planning.batch.record", {
                    kind: record.kind,
                    id: record.id,
                    version: record.version,
                  })}
                </p>
              ))}
            </details>
          ))}
        </>
      )}
      {!funnel ? (
        <p className={css.text}>{t("outcomes.planning.funnel.missing")}</p>
      ) : (
        <>
          <p className={css.text}>
            {t("outcomes.planning.funnel.intro", {
              unmatched: funnel.unmatchedAdoptionBatches,
            })}
          </p>
          {funnel.measures.map((row) => (
            <div
              key={row.operation}
              data-planning-funnel-operation={row.operation}
              className={css.item}
            >
              <h4 className={css.subheading}>{operation(row.operation)}</h4>
              <p className={css.text}>
                {t("outcomes.planning.funnel.counts", {
                  requests: row.recordedRequests,
                  targets: row.requestedTargets,
                  first: row.firstCandidates,
                  adopted: row.firstAdopted,
                  pending: row.pendingDecision,
                  closed: row.closedWithoutFirstAdoption,
                  revised: row.revisedAdoption,
                  retries: row.retryCandidates,
                  rejected: row.adoptionRejectedCount,
                })}
              </p>
              <p className={css.text}>
                {t("outcomes.planning.funnel.ratio", {
                  ratio:
                    row.firstCandidateAdoptionRatio === null
                      ? t("outcomes.planning.funnel.ratio.none")
                      : t("outcomes.planning.funnel.ratio.value", {
                          adopted: row.firstAdopted,
                          first: row.firstCandidates,
                          percent: percent(row.firstCandidateAdoptionRatio),
                        }),
                })}
              </p>
              {!row.sourceConflicts ? (
                <p className={css.text}>
                  {t("outcomes.planning.conflicts.missing")}
                </p>
              ) : (
                <>
                  <p className={css.text}>
                    {t("outcomes.planning.conflicts.count", {
                      count: row.sourceConflicts.candidateCount,
                    })}
                  </p>
                  {row.sourceConflicts.last && (
                    <details
                      data-planning-source-conflict-workflow-id={
                        row.sourceConflicts.last.sourceConflict.workflowId
                      }
                    >
                      <summary>
                        {t("outcomes.planning.conflict.summary")}
                      </summary>
                      <p className={css.text}>
                        {t("outcomes.planning.conflict.workflow", {
                          workflowId:
                            row.sourceConflicts.last.sourceConflict.workflowId,
                          candidateId: row.sourceConflicts.last.candidate.id,
                        })}
                      </p>
                      <p className={css.text}>
                        {t("outcomes.planning.conflict.sha", {
                          fingerprint:
                            row.sourceConflicts.last.candidate
                              .contentFingerprint,
                        })}
                      </p>
                      {row.sourceConflicts.last.sourceConflict.changes.map(
                        (change) => (
                          <p
                            key={`${change.sourceKind}:${change.frozen.id}`}
                            className={css.text}
                          >
                            {t("outcomes.planning.conflict.change", {
                              kind: change.sourceKind,
                              frozenId: change.frozen.id,
                              frozenVersion: change.frozen.version,
                              currentId: change.current.id,
                              currentVersion: change.current.version,
                            })}
                          </p>
                        ),
                      )}
                      <p className={css.text}>
                        {t("outcomes.planning.conflict.event", {
                          eventId: row.sourceConflicts.last.eventId,
                          at: when(row.sourceConflicts.last.occurredAt),
                        })}
                      </p>
                    </details>
                  )}
                </>
              )}
              {row.firstAccepted && (
                <details>
                  <summary>{t("outcomes.planning.accepted.summary")}</summary>
                  <p className={css.text}>
                    {t("outcomes.planning.accepted.ids", {
                      workflowId: row.firstAccepted.workflowId,
                      candidateId: row.firstAccepted.candidateId,
                      eventId: row.firstAccepted.adoptedEventId,
                    })}
                  </p>
                  <p className={css.text}>
                    {t("outcomes.planning.accepted.times", {
                      mode: t(
                        row.firstAccepted.adoptionMode === "exact-candidate"
                          ? "outcomes.planning.accepted.exact"
                          : "outcomes.planning.accepted.revised",
                      ),
                      ready: seconds(t, row.firstAccepted.requestToReadyMs),
                      adopt: seconds(t, row.firstAccepted.readyToAdoptMs),
                      total: seconds(t, row.firstAccepted.requestToAdoptMs),
                    })}
                  </p>
                </details>
              )}
            </div>
          ))}
        </>
      )}
      <p className={css.small}>{t("outcomes.planning.note")}</p>
    </section>
  );
}
