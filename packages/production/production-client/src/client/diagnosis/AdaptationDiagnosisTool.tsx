import { clsx } from "clsx";
import { useRef, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/writing-writing-client/client/contract";
import type { DiagnosesListResult } from "@dramaip/production-production/types";
import type { ToolProps } from "../strategy/AdaptationStrategyTool.tsx";
import { useConfirm } from "../tools/confirm.tsx";
import { usePublishedEvents } from "../tools/events.ts";
import { useOwnerRead } from "../tools/owner-read.ts";
import type { NarrativeContextRequest } from "../tools/parse.ts";
import { ambiguousNavigation, messageOf, value } from "../tools/remote.ts";
import css from "../tools/Tools.module.css";
import {
  confirmDiagnosisRequest,
  diagnosisDraftKey,
  originalDiagnosisCandidate,
  originalDiagnosisWorkflow,
  readDiagnosisDraft,
  type Diagnosis,
  type DiagnosisRequest,
  type DiagnosisTarget,
} from "./diagnosis.ts";

type Summary = DiagnosesListResult["items"][number];

const EMPTY_CONTEXT: NarrativeContextRequest = {
  format: "narrative-context-v1",
  chapters: [],
};
const EVENTS = /^(production\.|writing\.|workspace\.|automation\.creation-)/u;
const LEGACY_ACTIONS = [
  "preserve",
  "merge",
  "remove",
  "reorder",
  "restructure",
] as const;
const TERMS = [
  "theme",
  "emotionalPromise",
  "mainLine",
  "sellingPoints",
  "characterArcs",
  "relationships",
] as const;

/** The diagnosis tool, started over for each project. */
export function AdaptationDiagnosisEntry(props: ToolProps) {
  return <AdaptationDiagnosisTool key={props.projectId} {...props} />;
}

/**
 * The adaptation diagnosis: confirm the chapters, rights, target and,
 * optionally, the mixed expressions a run reads, run it in the creation
 * workbench, then review its evidence and adopt it explicitly. A link
 * names a run and a diagnosis exactly; neither the latest diagnosis nor
 * the last choice stands in for one that does not match.
 */
export function AdaptationDiagnosisTool(props: ToolProps) {
  const { t, projectId, production } = props;
  const params = new URLSearchParams(props.search);
  const navigationError = ambiguousNavigation(params, [
    "workflowId",
    "diagnosisId",
  ]);
  const workflowId = params.get("workflowId") ?? undefined;
  const requestedId = params.get("diagnosisId") ?? undefined;
  const [draft, setDraft] = useState<DiagnosisRequest | undefined>(() => {
    try {
      return readDiagnosisDraft(
        window.localStorage.getItem(diagnosisDraftKey(projectId)),
      );
    } catch {
      return undefined;
    }
  });
  const [selected, setSelected] = useState<string[]>(
    () => draft?.chapters.map((item) => item.id) ?? [],
  );
  const [mixed, setMixed] = useState(Boolean(draft?.context));
  const [context, setContext] = useState<NarrativeContextRequest>(
    draft?.context ?? EMPTY_CONTEXT,
  );
  const [rights, setRights] = useState(draft?.rightsDeclared ?? false);
  const [scope, setScope] = useState<DiagnosisRequest["scope"]>(
    draft?.scope ?? "selected-chapters",
  );
  const [target, setTarget] = useState<DiagnosisTarget>(
    draft?.target ?? {
      format: "short-drama",
      episodeCount: 12,
      durationSeconds: 90,
    },
  );
  const [focused, setFocused] = useState<string>();
  const [choice, setChoice] = useState<{ id: string; strategy: string }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const adoptConfirm = useConfirm({
    title: t("diagnosis.adopt.title"),
    cancel: t("diagnosis.cancel"),
    close: t("diagnosis.close"),
    accept: t("diagnosis.adopt.accept"),
  });
  const legacyConfirm = useConfirm({
    title: t("diagnosis.legacy.adopt.title"),
    cancel: t("diagnosis.cancel"),
    close: t("diagnosis.close"),
    accept: t("diagnosis.legacy.adopt.accept"),
  });
  const discardConfirm = useConfirm({
    title: t("diagnosis.discard.title"),
    cancel: t("diagnosis.cancel"),
    close: t("diagnosis.close"),
    accept: t("diagnosis.discard.accept"),
  });

  const original = useOwnerRead(
    workflowId && !navigationError ? `workflow:${workflowId}` : undefined,
    () => value(props.automation.creationGet(workflowId!)),
    1500,
  );
  const validWorkflow =
    workflowId && !navigationError
      ? originalDiagnosisWorkflow(original.data, { projectId, workflowId })
      : undefined;
  const request = workflowId ? validWorkflow?.input.diagnosisRequest : draft;
  const catalog = useOwnerRead(
    `sources:${projectId}`,
    async () => {
      const sources = await value(production.diagnosesSources(projectId));
      if (sources.projectId !== projectId)
        throw new Error(t("diagnosis.sources.owner"));
      return sources;
    },
    2000,
  );
  const expressionChapters = useOwnerRead(
    mixed
      ? `chapters:${projectId}:${catalog.data?.inventoryFingerprint ?? ""}`
      : undefined,
    async () => {
      const rows = await value(props.writing.chaptersList(projectId));
      if (rows.some((row) => row.projectId !== projectId))
        throw new Error(t("diagnosis.mixed.owner"));
      return rows;
    },
  );
  const history = useOwnerRead(
    `history:${projectId}`,
    async () => {
      const items: Summary[] = [];
      const cursors = new Set<string>();
      const identities = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await value(
          production.diagnosesList(projectId, {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
          }),
        );
        for (const item of page.items) {
          if (item.projectId !== projectId || identities.has(item.id))
            throw new Error(t("diagnosis.history.owner"));
          identities.add(item.id);
          items.push(item);
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error(t("diagnosis.history.cursor"));
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return items;
    },
    1500,
  );
  const id = navigationError
    ? undefined
    : (requestedId ??
      (workflowId
        ? validWorkflow?.diagnosisId
        : (focused ?? history.data?.[0]?.id)));
  const candidate = useOwnerRead(
    id ? `diagnosis:${id}` : undefined,
    () => value(production.diagnosesGet(id!)),
    1500,
  );
  const shown = id
    ? originalDiagnosisCandidate(
        candidate.data,
        {
          projectId,
          diagnosisId: id,
          ...(workflowId ? { workflowId } : {}),
        },
        validWorkflow,
      )
    : undefined;
  const exactMismatch = Boolean(
    navigationError ||
    (workflowId &&
      (original.error !== undefined || (original.data && !validWorkflow))) ||
    candidate.error !== undefined ||
    (candidate.data && !shown),
  );
  const strategyId = choice?.id === shown?.id ? choice?.strategy : undefined;
  const accepted = history.data?.find((item) => item.isCurrent);
  const refresh = () =>
    Promise.all([
      catalog.refetch(),
      history.refetch(),
      candidate.refetch(),
      original.refetch(),
    ]);
  usePublishedEvents(props.system, (event) => {
    const payload = event.payload as { projectId?: unknown } | undefined;
    if (
      EVENTS.test(event.type) &&
      payload &&
      typeof payload === "object" &&
      payload.projectId === projectId
    )
      void refresh();
  });

  const path = (search: URLSearchParams) =>
    `/projects/${projectId}/tools/adaptation-diagnosis${
      String(search) ? `?${search}` : ""
    }`;
  const confirmSources = () => {
    const available = catalog.data;
    if (!available) return;
    const result = confirmDiagnosisRequest(available, {
      scope,
      selected,
      rights,
      target,
      context: mixed ? context : undefined,
    });
    if ("error" in result) {
      setError(t(`diagnosis.error.${result.error}`));
      return;
    }
    try {
      window.localStorage.setItem(
        diagnosisDraftKey(projectId),
        JSON.stringify(result.request),
      );
    } catch {
      // The confirmed scope still holds for this window.
    }
    setDraft(result.request);
    const next = new URLSearchParams(props.search);
    next.delete("workflowId");
    next.delete("diagnosisId");
    props.navigate(path(next));
    setError(undefined);
  };
  const transition = async (
    diagnosis: Diagnosis,
    action: "adopt" | "discard",
    legacy = false,
  ) => {
    if (busy || (legacy && !strategyId)) return;
    const selectedId = legacy ? strategyId : undefined;
    const chosen = diagnosis.content.strategies.find(
      (item) => item.id === selectedId,
    );
    const ok =
      action === "discard"
        ? await discardConfirm.ask(t("diagnosis.discard.description"))
        : legacy
          ? await legacyConfirm.ask(
              t("diagnosis.legacy.adopt.description", {
                version: diagnosis.version,
                title: chosen?.title ?? "",
              }),
            )
          : await adoptConfirm.ask(
              t("diagnosis.adopt.description", { version: diagnosis.version }),
            );
    if (!ok) return;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify([
      diagnosis.id,
      diagnosis.stateVersion,
      action,
      action === "adopt" ? selectedId : undefined,
    ]);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const ifMatch = `"${diagnosis.stateVersion}"`;
    try {
      await value(
        action === "adopt"
          ? production.diagnosesAdopt(
              diagnosis.id,
              {
                confirmed: true,
                ...(selectedId === undefined ? {} : { strategyId: selectedId }),
              },
              ifMatch,
              key,
            )
          : production.diagnosesDiscard(diagnosis.id, {}, ifMatch, key),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const readError =
    error ??
    [catalog.error, history.error, candidate.error]
      .filter((cause) => cause !== undefined)
      .map(messageOf)[0];
  const status = (item: Summary) => t(`diagnosis.status.${item.status}`);
  return (
    <section aria-label={t("diagnosis.label")} className={css.tool}>
      <div className={css.card}>
        <h2 className={css.heading}>{t("diagnosis.scope.title")}</h2>
        <p className={css.muted}>{t("diagnosis.scope.description")}</p>
        <p>
          {t("diagnosis.intent", {
            intent: catalog.data?.authorIntent
              ? t("diagnosis.intent.version", {
                  version: catalog.data.authorIntent.version,
                })
              : t("diagnosis.intent.none"),
          })}
          <a
            className={css.link}
            href={`#/projects/${projectId}/tools/author-intent`}
          >
            {t("diagnosis.intent.check")}
          </a>
        </p>
        <div className={css.actions}>
          <label>
            {t("diagnosis.scope")}{" "}
            <select
              className={css.select}
              aria-label={t("diagnosis.scope.label")}
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as DiagnosisRequest["scope"])
              }
            >
              <option value="selected-chapters">
                {t("diagnosis.scope.selected-chapters")}
              </option>
              <option value="whole-book">
                {t("diagnosis.scope.whole-book")}
              </option>
            </select>
          </label>
          <label>
            {t("diagnosis.format")}{" "}
            <select
              className={css.select}
              aria-label={t("diagnosis.format.label")}
              value={target.format}
              onChange={(event) =>
                setTarget({
                  ...target,
                  format: event.target.value as DiagnosisTarget["format"],
                })
              }
            >
              <option value="short-drama">
                {t("diagnosis.format.short-drama")}
              </option>
              <option value="motion-comic">
                {t("diagnosis.format.motion-comic")}
              </option>
            </select>
          </label>
          <label>
            {t("diagnosis.episodes")}{" "}
            <input
              aria-label={t("diagnosis.episodes.label")}
              type="number"
              min={1}
              max={120}
              value={target.episodeCount}
              onChange={(event) =>
                setTarget({
                  ...target,
                  episodeCount: Number(event.target.value),
                })
              }
              className={css.number}
            />
          </label>
          <label>
            {t("diagnosis.duration")}{" "}
            <input
              aria-label={t("diagnosis.duration.label")}
              type="number"
              min={30}
              max={1800}
              value={target.durationSeconds}
              onChange={(event) =>
                setTarget({
                  ...target,
                  durationSeconds: Number(event.target.value),
                })
              }
              className={css.number}
            />
          </label>
        </div>
        <div className={css.scroll}>
          <div className={css.actions}>
            <Button
              size="sm"
              variant="ghost"
              disabled={!catalog.data}
              onClick={() =>
                setSelected(catalog.data!.chapters.map((item) => item.id))
              }
            >
              {t("diagnosis.select.all")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              {t("diagnosis.select.clear")}
            </Button>
          </div>
          {catalog.data?.chapters.map((chapter) => (
            <label key={chapter.id} className={css.check}>
              <input
                type="checkbox"
                aria-label={t("diagnosis.source.label", {
                  title: chapter.title,
                })}
                checked={selected.includes(chapter.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, chapter.id]
                      : selected.filter((item) => item !== chapter.id),
                  )
                }
              />
              {t("diagnosis.source", {
                title: chapter.title,
                version: chapter.version,
                characters: chapter.characters,
              })}
            </label>
          ))}
          {catalog.data && !catalog.data.chapters.length && (
            <p className={css.muted}>{t("diagnosis.source.none")}</p>
          )}
        </div>
        <label className={css.check}>
          <input
            type="checkbox"
            aria-label={t("diagnosis.mixed.label")}
            checked={mixed}
            onChange={(event) => setMixed(event.target.checked)}
          />
          {t("diagnosis.mixed")}
        </label>
        {mixed && (
          <div>
            {props.renderFactorySlot("writing.context-picker", {
              scope: { projectId, title: t("diagnosis.mixed.title") },
              chapters: (expressionChapters.data ?? []).filter((item) =>
                selected.includes(item.id),
              ),
              request: context,
              disabled: busy || expressionChapters.loading,
              onChange: setContext,
            })}
            {expressionChapters.error !== undefined && (
              <p role="alert">
                {t("diagnosis.mixed.failed", {
                  message: messageOf(expressionChapters.error),
                })}
              </p>
            )}
          </div>
        )}
        <label className={css.check}>
          <input
            aria-label={t("diagnosis.rights.label")}
            type="checkbox"
            checked={rights}
            onChange={(event) => setRights(event.target.checked)}
          />
          {t("diagnosis.rights")}
        </label>
        <div className={css.actions}>
          <Button
            size="sm"
            variant="primary"
            disabled={!catalog.data || busy}
            onClick={confirmSources}
          >
            {t("diagnosis.confirm")}
          </Button>
        </div>
        {request && (
          <p role="status">
            {t("diagnosis.confirmed", {
              chapters: request.chapters.length,
              scope: request.context
                ? t("diagnosis.confirmed.mixed")
                : t("diagnosis.confirmed.complete"),
              intent: request.authorIntent.version,
              episodes: request.target.episodeCount,
              duration: request.target.durationSeconds,
            })}
          </p>
        )}
        {request &&
          catalog.data &&
          catalog.data.inventoryFingerprint !==
            request.inventoryFingerprint && (
            <p role="alert" className={css.danger}>
              {t("diagnosis.inventory.changed")}
            </p>
          )}
      </div>
      {readError !== undefined && (
        <p role="alert" className={css.alert}>
          {readError}
        </p>
      )}
      {(!requestedId || shown) &&
        (!workflowId || validWorkflow) &&
        !exactMismatch &&
        props.renderFactorySlot("automation.creation-workbench", {
          projectId,
          operation: "adaptation-diagnosis",
          workflowId,
          diagnosisRequest: request,
          externalReview: true,
          disabled: !request || exactMismatch,
          onStarted: (workflow) => {
            const next = new URLSearchParams(props.search);
            next.set("workflowId", workflow.id);
            next.delete("diagnosisId");
            props.navigate(path(next));
          },
          defaultInstruction: t("diagnosis.instruction"),
          onCandidate: (workflow) => {
            if (workflow.diagnosisId) setFocused(workflow.diagnosisId);
          },
          onApplied: async () => {
            await refresh();
          },
        })}
      {exactMismatch && <p role="alert">{t("diagnosis.navigation")}</p>}
      {accepted && (
        <p className={css.notice}>
          {t("diagnosis.accepted", {
            version: accepted.version,
            strategy: accepted.selectedStrategyId
              ? t("diagnosis.accepted.legacy", {
                  title:
                    accepted.content.strategies.find(
                      (item) => item.id === accepted.selectedStrategyId,
                    )?.title ?? accepted.selectedStrategyId,
                })
              : t("diagnosis.accepted.narrative"),
            state:
              accepted.sourceState === "stale"
                ? t("diagnosis.accepted.stale")
                : t("diagnosis.accepted.current"),
          })}
          {accepted.sourceState === "current" && (
            <>
              {" "}
              <a
                className={css.link}
                href={`#/projects/${projectId}/tools/adaptation-strategy`}
              >
                {t("diagnosis.accepted.strategy")}
              </a>
            </>
          )}
          {accepted.sourceState === "current" &&
            accepted.selectedStrategyId && (
              <>
                {" "}
                <a
                  className={css.link}
                  href={`#/projects/${projectId}/tools/season-plan`}
                >
                  {t("diagnosis.accepted.season")}
                </a>
              </>
            )}
        </p>
      )}
      {history.data?.length ? (
        <nav aria-label={t("diagnosis.history")} className={css.actions}>
          {history.data.map((item) => (
            <a
              key={item.id}
              className={clsx(css.chip, item.id === id && css.chipActive)}
              href={`#${path(
                new URLSearchParams({
                  diagnosisId: item.id,
                  workflowId: item.workflowId,
                }),
              )}`}
            >
              {t("diagnosis.history.item", {
                version: item.version,
                status: status(item),
              })}
            </a>
          ))}
        </nav>
      ) : null}
      {shown && (
        <DiagnosisCandidate
          {...props}
          diagnosis={shown}
          busy={busy}
          strategyId={strategyId}
          onChoose={(strategy) => setChoice({ id: shown.id, strategy })}
          onAction={(action, legacy) => void transition(shown, action, legacy)}
        />
      )}
      {adoptConfirm.dialog}
      {legacyConfirm.dialog}
      {discardConfirm.dialog}
    </section>
  );
}

/** One diagnosis: its basis, evidence, older strategies and its actions. */
function DiagnosisCandidate(
  props: ToolProps & {
    diagnosis: Diagnosis;
    busy: boolean;
    strategyId: string | undefined;
    onChoose(strategy: string): void;
    onAction(action: "adopt" | "discard", legacy?: boolean): void;
  },
) {
  const { t, diagnosis, busy } = props;
  const { basis, content } = diagnosis;
  const join = (items: readonly string[]) =>
    items.join(t("diagnosis.separator"));
  return (
    <article
      aria-label={t("diagnosis.candidate.label", {
        version: diagnosis.version,
      })}
      data-diagnosis-state-version={diagnosis.stateVersion}
      className={css.card}
    >
      <h2 className={css.heading}>
        {t("diagnosis.candidate.title", {
          title: diagnosis.title || t("diagnosis.candidate.untitled"),
          version: diagnosis.version,
        })}
      </h2>
      <p className={css.muted}>
        {t("diagnosis.candidate.note", {
          version: diagnosis.authorIntent.version,
        })}
      </p>
      {basis.sourceBasis &&
        props.renderFactorySlot("automation.source-coverage", {
          basis: basis.sourceBasis,
          chapters: basis.chapters,
          label: t("diagnosis.coverage"),
        })}
      <p>
        {t("diagnosis.covered", {
          chapters: basis.chapters.length,
          total: basis.chapters.length + basis.omittedChapters.length,
          scope: t(`diagnosis.covered.${basis.scope}`),
          episodes: basis.target.episodeCount,
          duration: basis.target.durationSeconds,
        })}
      </p>
      <details>
        <summary>{t("diagnosis.sources")}</summary>
        {basis.chapters.map((item) => (
          <p key={item.id}>
            {t("diagnosis.sources.included", {
              title: item.title,
              version: item.version,
            })}
          </p>
        ))}
        {basis.omittedChapters.map((item) => (
          <p key={item.id} className={css.muted}>
            {t("diagnosis.sources.omitted", {
              title: item.title,
              version: item.version,
            })}
          </p>
        ))}
      </details>
      <p className={css.prose}>{content.summary}</p>
      <dl className={css.terms}>
        {TERMS.map((term) => {
          const detail = content[term];
          return (
            <div key={term}>
              <dt>{t(`diagnosis.term.${term}`)}</dt>
              <dd>{typeof detail === "string" ? detail : join(detail)}</dd>
            </div>
          );
        })}
      </dl>
      {content.findings.map((finding, index) => (
        <section key={index} className={css.notice}>
          <h3 className={css.heading}>{finding.claim}</h3>
          {finding.evidence.map((evidence, at) => (
            <blockquote key={at} className={css.quote}>
              {t("diagnosis.evidence", {
                title:
                  basis.chapters.find((item) => item.id === evidence.chapterId)
                    ?.title ?? "",
                version: evidence.chapterVersion,
                quote: evidence.quote,
              })}
              {evidence.source && (
                <span className={clsx(css.source, css.small, css.muted)}>
                  {t("diagnosis.evidence.source", {
                    source: evidence.source.sourceId,
                    version: evidence.source.sourceVersion,
                    field: evidence.source.fieldPath,
                    path: evidence.source.valuePath,
                  })}
                </span>
              )}
            </blockquote>
          ))}
          <p>{t("diagnosis.suggestion", { suggestion: finding.suggestion })}</p>
        </section>
      ))}
      <details>
        <summary>{t("diagnosis.legacy")}</summary>
        <p className={css.muted}>{t("diagnosis.legacy.note")}</p>
        <fieldset className={clsx(css.fieldset, css.grid)}>
          <legend className={css.heading}>
            {t("diagnosis.legacy.choose")}
          </legend>
          {content.strategies.map((strategy) => (
            <label key={strategy.id} className={css.option}>
              <span className={css.optionTitle}>
                <input
                  type="radio"
                  name={`diagnosis-strategy-${diagnosis.id}`}
                  aria-label={t("diagnosis.legacy.option", {
                    title: strategy.title,
                  })}
                  checked={
                    props.strategyId === strategy.id ||
                    (diagnosis.status === "adopted" &&
                      diagnosis.selectedStrategyId === strategy.id)
                  }
                  disabled={diagnosis.status !== "pending" || busy}
                  onChange={() => props.onChoose(strategy.id)}
                />
                {strategy.title}
              </span>
              <p>{strategy.rationale}</p>
              {LEGACY_ACTIONS.map((name) => (
                <p key={name}>
                  {t(`diagnosis.legacy.action.${name}`, {
                    items:
                      join(strategy[name]) || t("diagnosis.legacy.action.none"),
                  })}
                </p>
              ))}
              <p>{t("diagnosis.legacy.rhythm", { rhythm: strategy.rhythm })}</p>
              <p>
                {t("diagnosis.legacy.risks", { risks: join(strategy.risks) })}
              </p>
              <p>
                {t("diagnosis.legacy.production", {
                  level: strategy.productionRisk,
                  notes: strategy.productionNotes,
                })}
              </p>
              <p className={css.muted}>
                {t("diagnosis.legacy.findings", {
                  findings: strategy.findingIds.join(
                    t("diagnosis.legacy.findings.separator"),
                  ),
                })}
              </p>
            </label>
          ))}
        </fieldset>
        <div className={css.actions}>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              diagnosis.status !== "pending" ||
              diagnosis.sourceState === "stale" ||
              !props.strategyId
            }
            onClick={() => props.onAction("adopt", true)}
          >
            {t("diagnosis.legacy.adopt")}
          </Button>
        </div>
      </details>
      {diagnosis.staleReasons.length > 0 && (
        <p role="alert" className={css.danger}>
          {t("diagnosis.stale", { reasons: join(diagnosis.staleReasons) })}
        </p>
      )}
      <div className={css.actions}>
        <Button
          size="sm"
          variant="primary"
          disabled={
            busy ||
            diagnosis.status !== "pending" ||
            diagnosis.sourceState === "stale"
          }
          onClick={() => props.onAction("adopt")}
        >
          {t("diagnosis.adopt")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={
            busy || !["pending", "conflicted"].includes(diagnosis.status)
          }
          onClick={() => props.onAction("discard")}
        >
          {t("diagnosis.discard")}
        </Button>
      </div>
    </article>
  );
}
