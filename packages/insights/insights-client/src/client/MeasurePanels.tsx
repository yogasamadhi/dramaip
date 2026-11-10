import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  CreativeConfigurationFunnel,
  CreativeDeliveryCoverage,
  CreativeDeliveryWindow,
  NovelRevisionConfiguration,
  NovelRevisionEffortResult,
} from "@dramaip/insights-insights/types";
import {
  messageOf,
  useRead,
  value,
  type InsightsRemote,
  type RecordedModel,
  type Translate,
} from "./outcome-reads.ts";
import css from "./Outcomes.module.css";

const FUNNEL_STATES = {
  missing: "outcomes.funnel.state.missing",
  unavailable: "outcomes.funnel.state.unavailable",
  "read-failed": "outcomes.funnel.state.readFailed",
  "missing-generating-run": "outcomes.funnel.state.missingRun",
  "unobserved-first-request": "outcomes.funnel.state.unobserved",
} as const;

const funnelModel = (t: Translate, model: RecordedModel) =>
  model.status === "recorded"
    ? t("outcomes.funnel.model", {
        model: model.modelId,
        provider: model.providerId ?? t("outcomes.unrecorded"),
        profile: model.profileId ?? t("outcomes.unrecorded"),
      })
    : t(
        model.status === "invalid"
          ? "outcomes.model.invalid"
          : "outcomes.model.unrecorded",
      );

/**
 * Two reads behind two buttons, one answer shown at a time. A newer read, a
 * project change or a stop drops the older answer.
 */
function useEitherRead<A, B>(
  projectId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
) {
  const [answer, setAnswer] = useState<
    { kind: "first"; value: A } | { kind: "second"; value: B }
  >();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const stop = () => {
    generation.current += 1;
    setAnswer(undefined);
    setPending(false);
  };
  useEffect(() => {
    setAnswer(undefined);
    setError(undefined);
    setPending(false);
    return () => {
      generation.current += 1;
    };
  }, [projectId]);
  const read = async (kind: "first" | "second") => {
    const current = ++generation.current;
    setAnswer(undefined);
    setError(undefined);
    setPending(true);
    try {
      const next =
        kind === "first"
          ? { kind, value: await first() }
          : { kind, value: await second() };
      if (generation.current === current) setAnswer(next as never);
    } catch (cause) {
      if (generation.current === current) setError(messageOf(cause));
    } finally {
      if (generation.current === current) setPending(false);
    }
  };
  return { answer, error, pending, read, stop };
}

/** A project's requests grouped by each target's first configuration. */
export function ConfigurationFunnelView({
  value,
  t,
}: {
  value: CreativeConfigurationFunnel;
  t: Translate;
}) {
  return (
    <section aria-label={t("outcomes.funnel.result")} className={css.flat}>
      <p className={css.text}>
        {t("outcomes.funnel.head", {
          checkpoint: value.projection.checkpoint,
          workflows: value.recordedWorkflows,
          targets: value.recordedTargets,
        })}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status" className={css.text}>
          {t("outcomes.funnel.lag")}
        </p>
      )}
      {!value.groups.length && (
        <p className={css.text}>{t("outcomes.funnel.empty")}</p>
      )}
      {value.groups.map((group, index) => (
        <section
          key={index}
          aria-label={t("outcomes.funnel.group.aria", { index: index + 1 })}
          className={css.item}
        >
          <p className={css.text}>
            {t("outcomes.funnel.group.line", {
              index: index + 1,
              family: t(
                group.family === "planning"
                  ? "outcomes.funnel.family.planning"
                  : "outcomes.funnel.family.creation",
              ),
              configuration:
                group.configuration.state === "recorded"
                  ? t("outcomes.funnel.configuration", {
                      engine: group.configuration.engineKind,
                      model: funnelModel(
                        t,
                        group.configuration.model as RecordedModel,
                      ),
                    })
                  : t(FUNNEL_STATES[group.configuration.state]),
            })}
          </p>
          {group.summary.measures
            .filter((row) => row.recordedRequests > 0)
            .map((row) => {
              const name = "metric" in row ? row.metric : row.operation;
              return (
                <section key={name} aria-label={name} className={css.flat}>
                  <p className={css.text}>
                    {t("outcomes.funnel.row.head", {
                      name,
                      requests: row.recordedRequests,
                      targets: row.requestedTargets,
                      unobserved: row.unobservedFirstTargets,
                    })}
                  </p>
                  <p className={css.text}>
                    {t("outcomes.funnel.row.first", {
                      first: row.firstCandidates,
                      adopted: row.firstAdopted,
                      pending: row.pendingDecision,
                      closed: row.closedWithoutFirstAdoption,
                      revised: row.revisedAdoption,
                      retries: row.retryCandidates,
                    })}
                  </p>
                  <p className={css.text}>
                    {t("outcomes.funnel.row.ratio", {
                      ratio:
                        row.firstCandidateAdoptionRatio === null
                          ? t("outcomes.funnel.row.ratio.none")
                          : t("outcomes.funnel.row.ratio.value", {
                              adopted: row.firstAdopted,
                              first: row.firstCandidates,
                            }),
                    })}
                  </p>
                  {row.firstAccepted && (
                    <p className={css.text}>
                      {t("outcomes.funnel.row.accepted", {
                        eventId: row.firstAccepted.adoptedEventId,
                        workflowId: row.firstAccepted.workflowId,
                        ready:
                          row.firstAccepted.requestToReadyMs ??
                          t("outcomes.unknown"),
                        adopt:
                          row.firstAccepted.requestToAdoptMs ??
                          t("outcomes.unknown"),
                        clock: row.firstAccepted.clockState,
                      })}
                    </p>
                  )}
                </section>
              );
            })}
          <details>
            <summary>{t("outcomes.funnel.group.ids")}</summary>
            <p className={css.text}>
              {t("outcomes.funnel.group.anchors", {
                ids: group.anchorWorkflowIds.join(t("outcomes.list")),
              })}
            </p>
            <p className={css.text}>
              {t("outcomes.funnel.group.all", {
                ids: group.workflowIds.join(t("outcomes.list")),
              })}
            </p>
          </details>
        </section>
      ))}
    </section>
  );
}

/** Read the whole configuration funnel on request; stop drops the read. */
export function ConfigurationFunnelPanel({
  insights,
  projectId,
  t,
}: {
  insights: InsightsRemote;
  projectId: string;
  t: Translate;
}) {
  const [enabled, setEnabled] = useState(false);
  const funnel = useRead(
    () =>
      value<CreativeConfigurationFunnel>(
        insights.configurationFunnel(projectId),
      ),
    enabled,
  );
  return (
    <section aria-label={t("outcomes.funnel.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.funnel.title")}</h3>
      <p className={css.small}>{t("outcomes.funnel.intro")}</p>
      <button
        type="button"
        className={css.link}
        disabled={funnel.pending}
        onClick={() => {
          if (enabled) funnel.refresh();
          else setEnabled(true);
        }}
      >
        {t("outcomes.funnel.read")}
      </button>
      {funnel.pending && (
        <button
          type="button"
          className={css.link}
          onClick={() => {
            setEnabled(false);
            funnel.reset();
          }}
        >
          {t("outcomes.funnel.stop")}
        </button>
      )}
      {funnel.pending ? (
        <p role="status" className={css.text}>
          {t("outcomes.funnel.pending")}
        </p>
      ) : (
        enabled &&
        (funnel.error ? (
          <p role="alert" className={css.alert}>
            {t("outcomes.funnel.error", { error: funnel.error })}
          </p>
        ) : (
          funnel.data && <ConfigurationFunnelView value={funnel.data} t={t} />
        ))
      )}
    </section>
  );
}

/** Each chapter target's revisions before its first adoption. */
export function RevisionEffortView({
  value,
  t,
}: {
  value: NovelRevisionEffortResult;
  t: Translate;
}) {
  return (
    <div aria-label={t("outcomes.revision.result")} className={css.compact}>
      <p className={css.text}>
        {t("outcomes.revision.head", {
          checkpoint: value.projection.checkpoint,
          targets: value.totalTargets,
        })}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status" className={css.text}>
          {t("outcomes.revision.lag")}
        </p>
      )}
      {!value.items.length && (
        <p className={css.text}>{t("outcomes.revision.empty")}</p>
      )}
      {value.items.map((row) => (
        <section key={row.targetKey} className={css.item}>
          <p className={css.text}>
            {t("outcomes.revision.target", { key: row.targetKey })}
          </p>
          <p className={css.text}>
            {t("outcomes.revision.updates", {
              updates: row.observedContentUpdates,
              rebases: row.observedRebases,
              changing: row.observedContentChangingRebases,
            })}
          </p>
          <p className={css.text}>
            {row.state === "pending"
              ? t("outcomes.revision.state.pending")
              : row.state === "unknown"
                ? t("outcomes.revision.state.unknown")
                : t("outcomes.revision.state.measured", {
                    count: row.localRevisionCount,
                  })}
          </p>
          {row.adoption && (
            <p className={css.text}>
              {t("outcomes.revision.adoption", {
                eventId: row.adoption.eventId,
                chapterId: row.adoption.chapterId,
                version: row.adoption.version,
                workflowId: row.adoption.workflowId ?? t("outcomes.unrecorded"),
              })}
            </p>
          )}
          <details>
            <summary>{t("outcomes.revision.ids")}</summary>
            <p className={css.text}>
              {row.workflowIds.join(t("outcomes.list"))}
            </p>
          </details>
        </section>
      ))}
      <p className={css.small}>{t("outcomes.revision.note")}</p>
    </div>
  );
}

/** The chapter revisions grouped by each target's first configuration. */
export function RevisionConfigurationView({
  value,
  t,
}: {
  value: NovelRevisionConfiguration;
  t: Translate;
}) {
  return (
    <section
      aria-label={t("outcomes.revision.grouped.result")}
      className={css.compact}
    >
      <p className={css.text}>
        {t("outcomes.revision.grouped.head", {
          checkpoint: value.projection.checkpoint,
          targets: value.recordedTargets,
          workflows: value.recordedWorkflows,
        })}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status" className={css.text}>
          {t("outcomes.revision.lag")}
        </p>
      )}
      {!value.groups.length && (
        <p className={css.text}>{t("outcomes.revision.grouped.empty")}</p>
      )}
      {value.groups.map((group, index) => (
        <section
          key={index}
          aria-label={t("outcomes.revision.grouped.aria", {
            index: index + 1,
          })}
          className={css.item}
        >
          <p className={css.text}>
            {t("outcomes.revision.grouped.configuration", {
              configuration:
                group.configuration.state === "recorded"
                  ? t("outcomes.revision.grouped.engine", {
                      engine: group.configuration.engineKind,
                      model: funnelModel(
                        t,
                        group.configuration.model as RecordedModel,
                      ),
                    })
                  : t("outcomes.revision.grouped.unknown", {
                      state: group.configuration.state,
                    }),
            })}
          </p>
          <p className={css.text}>
            {t("outcomes.revision.grouped.summary", {
              measured: group.summary.measuredTargets,
              targets: group.summary.targets,
              unknown: group.summary.unknownAdoptedTargets,
              pending: group.summary.pendingTargets,
            })}
          </p>
          <p className={css.text}>
            {group.summary.mean
              ? t("outcomes.revision.grouped.mean", {
                  minimum: group.summary.minimum,
                  maximum: group.summary.maximum,
                  numerator: group.summary.mean.numerator,
                  denominator: group.summary.mean.denominator,
                })
              : t("outcomes.revision.grouped.mean.none")}
          </p>
          <details>
            <summary>{t("outcomes.revision.grouped.ids")}</summary>
            {group.items.map((row) => (
              <p key={row.targetKey} className={css.text}>
                {t("outcomes.revision.grouped.item", {
                  key: row.targetKey,
                  workflows: row.workflowIds.join(t("outcomes.list")),
                  eventId: row.adoption?.eventId ?? t("outcomes.notYet"),
                  count: row.localRevisionCount ?? t("outcomes.unknown"),
                })}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className={css.small}>{t("outcomes.revision.grouped.note")}</p>
    </section>
  );
}

/** Read the chapter revisions, plain or grouped, on request. */
export function RevisionEffortPanel({
  insights,
  projectId,
  t,
}: {
  insights: InsightsRemote;
  projectId: string;
  t: Translate;
}) {
  const reads = useEitherRead(
    projectId,
    () =>
      value<NovelRevisionEffortResult>(
        insights.revisionEffortResult(projectId),
      ),
    () =>
      value<NovelRevisionConfiguration>(
        insights.revisionConfigurations(projectId),
      ),
  );
  const { answer } = reads;
  return (
    <section aria-label={t("outcomes.revision.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.revision.title")}</h3>
      <div className={css.actions}>
        <Button
          variant="outline"
          size="sm"
          disabled={reads.pending}
          onClick={() => void reads.read("first")}
        >
          {t(
            reads.pending
              ? "outcomes.revision.read.pending"
              : "outcomes.revision.read",
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={reads.pending}
          onClick={() => void reads.read("second")}
        >
          {t("outcomes.revision.readGrouped")}
        </Button>
        {reads.pending && (
          <Button variant="outline" size="sm" onClick={reads.stop}>
            {t("outcomes.revision.stop")}
          </Button>
        )}
      </div>
      {reads.error && (
        <p role="alert" className={css.alert}>
          {t("outcomes.revision.error", { error: reads.error })}
        </p>
      )}
      {answer?.kind === "first" && answer.value.projectId === projectId && (
        <RevisionEffortView value={answer.value} t={t} />
      )}
      {answer?.kind === "second" && answer.value.projectId === projectId && (
        <RevisionConfigurationView value={answer.value} t={t} />
      )}
    </section>
  );
}

const DELIVERY_PATHS = {
  novel: {
    aria: "outcomes.delivery.coverage.aria.novel",
    title: "outcomes.delivery.coverage.title.novel",
    window: "outcomes.delivery.window.path.novel",
  },
  adaptation: {
    aria: "outcomes.delivery.coverage.aria.adaptation",
    title: "outcomes.delivery.coverage.title.adaptation",
    window: "outcomes.delivery.window.path.adaptation",
  },
} as const;

const deliveryPath = (path: string) =>
  path === "novel" ? DELIVERY_PATHS.novel : DELIVERY_PATHS.adaptation;

/** Each adopted version and whether the same version was later saved. */
export function DeliveryCoverageView({
  value,
  t,
}: {
  value: CreativeDeliveryCoverage;
  t: Translate;
}) {
  return (
    <div
      aria-label={t("outcomes.delivery.coverage.result")}
      className={css.compact}
    >
      <p className={css.text}>
        {t("outcomes.delivery.coverage.head", {
          checkpoint: value.projection.checkpoint,
        })}
      </p>
      {value.groups.map((group) => (
        <section
          key={group.workflowPath}
          aria-label={t(deliveryPath(group.workflowPath).aria)}
          className={css.item}
        >
          <p className={css.text}>
            {t(deliveryPath(group.workflowPath).title)}
          </p>
          <p className={css.text}>
            {t("outcomes.delivery.coverage.counts", {
              adopted: group.adoptedVersions,
              delivered: group.deliveredVersions,
              notSaved: group.notSavedVersions,
            })}
          </p>
          <p className={css.text}>
            {group.ratio
              ? t("outcomes.delivery.coverage.ratio", {
                  numerator: group.ratio.numerator,
                  denominator: group.ratio.denominator,
                })
              : t("outcomes.delivery.coverage.ratio.none")}
          </p>
          <p className={css.text}>
            {t("outcomes.delivery.coverage.unlinked", {
              count: group.savedVersionsWithoutEarlierAdoption.length,
            })}
          </p>
          <details>
            <summary>{t("outcomes.delivery.coverage.items")}</summary>
            {group.items.map((row) => (
              <p
                key={`${row.formalVersion.id}:${row.formalVersion.version}`}
                className={css.text}
              >
                {t("outcomes.delivery.coverage.item", {
                  id: row.formalVersion.id,
                  version: row.formalVersion.version,
                  adoption: row.adoption.eventId,
                  saved: row.firstSaved?.eventId ?? t("outcomes.unrecorded"),
                  units: row.savedUnits,
                })}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className={css.small}>{t("outcomes.delivery.coverage.note")}</p>
    </div>
  );
}

/** The fixed seven-day window: new adoptions, first saves and their time. */
export function DeliveryWindowView({
  value,
  t,
}: {
  value: CreativeDeliveryWindow;
  t: Translate;
}) {
  return (
    <div
      aria-label={t("outcomes.delivery.window.result")}
      className={css.compact}
    >
      <p className={css.text}>
        {t("outcomes.delivery.window.head", {
          from: value.window.from,
          to: value.window.to,
        })}
      </p>
      {value.groups.map((group) => (
        <section key={group.workflowPath} className={css.item}>
          <p className={css.text}>
            {t("outcomes.delivery.window.counts", {
              path: t(deliveryPath(group.workflowPath).window),
              adopted: group.adoptedInWindow,
              delivered: group.deliveredInWindow,
            })}
          </p>
          <p className={css.text}>
            {t("outcomes.delivery.window.measured", {
              measured: group.measuredVersions,
              pending: group.pendingVersions,
              clock: group.clockInconsistentVersions,
            })}
          </p>
          <p className={css.text}>
            {group.duration
              ? t("outcomes.delivery.window.duration", {
                  minimum: group.duration.minimumMs,
                  maximum: group.duration.maximumMs,
                  numerator: group.duration.mean.numerator,
                  denominator: group.duration.mean.denominator,
                })
              : t("outcomes.delivery.window.duration.none")}
          </p>
          <details>
            <summary>{t("outcomes.delivery.window.items")}</summary>
            {group.items.map((row) => (
              <p
                key={`${row.formalVersion.id}:${row.formalVersion.version}`}
                className={css.text}
              >
                {t("outcomes.delivery.window.item", {
                  id: row.formalVersion.id,
                  version: row.formalVersion.version,
                  adoption: row.adoptionEventId,
                  saved: row.savedEventId ?? t("outcomes.unrecorded"),
                  clock: row.clockState,
                  reason: row.reason ?? t("outcomes.delivery.window.clockOk"),
                  duration:
                    row.adoptionToSavedMs === null
                      ? t("outcomes.unknown")
                      : t("outcomes.ms", { ms: row.adoptionToSavedMs }),
                })}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className={css.small}>{t("outcomes.delivery.window.note")}</p>
    </div>
  );
}

/** Read the delivery coverage, or its seven-day window, on request. */
export function DeliveryCoveragePanel({
  insights,
  projectId,
  t,
}: {
  insights: InsightsRemote;
  projectId: string;
  t: Translate;
}) {
  const reads = useEitherRead(
    projectId,
    () => value<CreativeDeliveryCoverage>(insights.deliveryCoverage(projectId)),
    () => value<CreativeDeliveryWindow>(insights.deliveryWindow(projectId)),
  );
  const { answer } = reads;
  return (
    <section aria-label={t("outcomes.delivery.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.delivery.title")}</h3>
      <p className={css.small}>{t("outcomes.delivery.intro")}</p>
      <div className={css.actions}>
        <Button
          variant="outline"
          size="sm"
          disabled={reads.pending}
          onClick={() => void reads.read("first")}
        >
          {t("outcomes.delivery.read")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={reads.pending}
          onClick={() => void reads.read("second")}
        >
          {t("outcomes.delivery.readWindow")}
        </Button>
      </div>
      {reads.pending && (
        <>
          <p role="status" className={css.text}>
            {t("outcomes.delivery.pending")}
          </p>
          <Button variant="outline" size="sm" onClick={reads.stop}>
            {t("outcomes.delivery.stop")}
          </Button>
        </>
      )}
      {reads.error && (
        <p role="alert" className={css.alert}>
          {t("outcomes.delivery.error", { error: reads.error })}
        </p>
      )}
      {answer?.kind === "first" && (
        <DeliveryCoverageView value={answer.value} t={t} />
      )}
      {answer?.kind === "second" && (
        <DeliveryWindowView value={answer.value} t={t} />
      )}
    </section>
  );
}
