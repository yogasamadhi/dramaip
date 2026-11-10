import { clsx } from "clsx";
import { useRef, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button } from "@dramaip/infra-ui-primitives";
import type { SeasonPlansListResult } from "@dramaip/production-production/types";
import type { ToolProps } from "../strategy/AdaptationStrategyTool.tsx";
import { useConfirm } from "../tools/confirm.tsx";
import { usePublishedEvents } from "../tools/events.ts";
import { useOwnerRead } from "../tools/owner-read.ts";
import { ambiguousNavigation, messageOf, value } from "../tools/remote.ts";
import css from "../tools/Tools.module.css";
import {
  originalSeasonWorkflow,
  readSeasonDraft,
  seasonDraftKey,
  seasonPlanLineageError,
  seasonPlanRequest,
  type SeasonPlan,
  type SeasonPlanRequest,
} from "./season.ts";

type Summary = SeasonPlansListResult["items"][number];
type Operation = "adopt" | "discard" | "reorder";

const EVENTS = /^(production\.|writing\.|workspace\.|automation\.creation-)/u;

/** The season plan tool, started over for each project. */
export function SeasonPlanEntry(props: ToolProps) {
  return <SeasonPlanTool key={props.projectId} {...props} />;
}

/**
 * The season plan: confirm the adopted diagnosis and strategy it starts
 * from, run the plan in the creation workbench, then review its coverage
 * and episode order, reorder it into a new draft and adopt one explicitly.
 * A link names a run and a plan exactly; a plan shows under its run only
 * when its whole lineage back to the run's model plan checks out.
 */
export function SeasonPlanTool(props: ToolProps) {
  const { t, projectId, production } = props;
  const params = new URLSearchParams(props.search);
  const navigationError = ambiguousNavigation(params, [
    "workflowId",
    "seasonPlanId",
  ]);
  const workflowId = params.get("workflowId") ?? undefined;
  const requestedId = params.get("seasonPlanId") ?? undefined;
  const [draft, setDraft] = useState<SeasonPlanRequest | undefined>(() => {
    try {
      return readSeasonDraft(
        window.localStorage.getItem(seasonDraftKey(projectId)),
      );
    } catch {
      return undefined;
    }
  });
  const [focused, setFocused] = useState<string | undefined>(requestedId);
  const [orderDraft, setOrderDraft] = useState<{
    id: string;
    episodeIds: string[];
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const confirms = {
    adopt: useConfirm({
      title: t("season.adopt.title"),
      cancel: t("season.cancel"),
      close: t("season.close"),
      accept: t("season.adopt.accept"),
    }),
    reorder: useConfirm({
      title: t("season.reorder.title"),
      cancel: t("season.cancel"),
      close: t("season.close"),
      accept: t("season.reorder.accept"),
    }),
    discard: useConfirm({
      title: t("season.discard.title"),
      cancel: t("season.cancel"),
      close: t("season.close"),
      accept: t("season.discard.accept"),
    }),
  };

  const original = useOwnerRead(
    workflowId && !navigationError ? `workflow:${workflowId}` : undefined,
    () => value(props.automation.creationGet(workflowId!)),
    1500,
  );
  const validWorkflow =
    workflowId && !navigationError
      ? originalSeasonWorkflow(original.data, { projectId, workflowId })
      : undefined;
  const request = workflowId ? validWorkflow?.input.seasonPlanRequest : draft;
  const catalog = useOwnerRead(
    `sources:${projectId}`,
    async () => {
      const sources = await value(production.seasonPlansSources(projectId));
      if (sources.projectId !== projectId)
        throw new Error(t("season.basis.owner"));
      return sources;
    },
    2000,
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
          production.seasonPlansList(projectId, {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
          }),
        );
        for (const item of page.items) {
          if (item.projectId !== projectId || identities.has(item.id))
            throw new Error(t("season.history.owner"));
          identities.add(item.id);
          items.push(item);
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error(t("season.history.cursor"));
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
        ? validWorkflow?.seasonPlanId
        : (focused ?? history.data?.[0]?.id)));
  const candidate = useOwnerRead(
    id && (!workflowId || validWorkflow)
      ? `plan:${id}:${validWorkflow?.id ?? ""}`
      : undefined,
    async () => {
      const plan = await value(production.seasonPlansGet(id!));
      if (workflowId && validWorkflow) {
        const reason = await seasonPlanLineageError(
          plan,
          validWorkflow,
          (parent) => value(production.seasonPlansGet(parent)),
        );
        if (reason) throw new Error(t(`season.lineage.${reason}`));
      }
      return plan;
    },
    1500,
  );
  const shown =
    candidate.data &&
    candidate.data.projectId === projectId &&
    (!id || candidate.data.id === id) &&
    (!workflowId || candidate.data.workflowId === workflowId) &&
    (!workflowId || validWorkflow)
      ? candidate.data
      : undefined;
  const exactMismatch = Boolean(
    navigationError ||
    (workflowId &&
      (original.error !== undefined || (original.data && !validWorkflow))) ||
    candidate.error !== undefined ||
    (candidate.data && !shown),
  );
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
    `/projects/${projectId}/tools/season-plan${
      String(search) ? `?${search}` : ""
    }`;
  const open = (plan: { id: string; workflowId: string }) => {
    const next = new URLSearchParams(props.search);
    next.set("seasonPlanId", plan.id);
    next.set("workflowId", plan.workflowId);
    props.navigate(path(next));
  };
  const confirmBasis = () => {
    const next = catalog.data && seasonPlanRequest(catalog.data);
    if (!next) {
      setError(t("season.basis.required"));
      return;
    }
    try {
      window.localStorage.setItem(
        seasonDraftKey(projectId),
        JSON.stringify(next),
      );
    } catch {
      // The confirmed basis still holds for this window.
    }
    setDraft(next);
    const search = new URLSearchParams(props.search);
    search.delete("workflowId");
    search.delete("seasonPlanId");
    props.navigate(path(search));
    setError(undefined);
  };
  const episodeIds = shown
    ? orderDraft?.id === shown.id
      ? orderDraft.episodeIds
      : shown.content.episodes.map((item) => item.id)
    : [];
  const changedOrder = Boolean(
    shown &&
    episodeIds.some(
      (item, index) => shown.content.episodes[index]?.id !== item,
    ),
  );
  const move = (index: number, direction: number) => {
    if (
      !shown ||
      index + direction < 0 ||
      index + direction >= episodeIds.length
    )
      return;
    const next = [...episodeIds];
    [next[index], next[index + direction]] = [
      next[index + direction]!,
      next[index]!,
    ];
    setOrderDraft({ id: shown.id, episodeIds: next });
  };
  const action = async (plan: SeasonPlan, operation: Operation) => {
    if (busy) return;
    if (!(await confirms[operation].ask(t(`season.${operation}.description`))))
      return;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify({
      id: plan.id,
      version: plan.stateVersion,
      operation,
      ...(operation === "reorder" ? { episodeIds } : {}),
    });
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const ifMatch = `"${plan.stateVersion}"`;
    try {
      const result = await value(
        operation === "reorder"
          ? production.seasonPlansReorder(
              plan.id,
              { episodeIds, confirmed: true },
              ifMatch,
              key,
            )
          : operation === "adopt"
            ? production.seasonPlansAdopt(
                plan.id,
                { confirmed: true },
                ifMatch,
                key,
              )
            : production.seasonPlansDiscard(plan.id, {}, ifMatch, key),
      );
      setFocused(result.id);
      setOrderDraft(undefined);
      open(result);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const readError =
    error ??
    [history.error, candidate.error]
      .filter((cause) => cause !== undefined)
      .map(messageOf)[0];
  const status = (item: Summary) =>
    t("season.history.item", {
      version: item.version,
      origin: t(`season.origin.${item.origin}`),
      status: t(`season.status.${item.status}`),
    });
  return (
    <section aria-label={t("season.label")} className={css.tool}>
      {accepted?.sourceState === "current" && (
        <a
          className={clsx(css.link, css.small)}
          href={`#/projects/${projectId}/tools/episode-development`}
        >
          {t("season.next")}
        </a>
      )}
      <div className={css.card}>
        <h2 className={css.heading}>{t("season.basis.title")}</h2>
        <p className={css.muted}>{t("season.basis.description")}</p>
        <p>
          {t("season.basis.diagnosis", {
            diagnosis: catalog.data?.diagnosis
              ? t("season.basis.diagnosis.version", {
                  version: catalog.data.diagnosis.version,
                  strategy: catalog.data.diagnosis.strategyId,
                })
              : t("season.basis.diagnosis.none"),
          })}
          <a
            className={css.link}
            href={`#/projects/${projectId}/tools/adaptation-diagnosis`}
          >
            {t("season.basis.check")}
          </a>
        </p>
        <p className={css.muted}>
          {catalog.data?.strategyPath === "independent"
            ? t("season.basis.independent")
            : t("season.basis.legacy")}{" "}
          <a
            className={css.link}
            href={`#/projects/${projectId}/tools/adaptation-strategy`}
          >
            {t("season.basis.strategy")}
          </a>
        </p>
        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={busy || !catalog.data?.diagnosis}
            onClick={confirmBasis}
          >
            {t("season.basis.confirm")}
          </Button>
        </div>
        {request && (
          <p>
            {t("season.basis.frozen", {
              version: request.diagnosis.version,
              strategy: request.diagnosis.strategyId,
            })}
          </p>
        )}
        {catalog.error !== undefined && (
          <p role="alert" className={css.danger}>
            {t("season.basis.failed", { message: messageOf(catalog.error) })}
          </p>
        )}
      </div>
      {(!requestedId || shown) &&
        (!workflowId || validWorkflow) &&
        !exactMismatch &&
        props.renderFactorySlot("automation.creation-workbench", {
          projectId,
          workflowId,
          operation: "season-plan",
          seasonPlanRequest: request,
          externalReview: true,
          disabled: !request || busy || exactMismatch,
          onStarted: (workflow) => {
            const next = new URLSearchParams(props.search);
            next.set("workflowId", workflow.id);
            next.delete("seasonPlanId");
            props.navigate(path(next));
          },
          resultLabel: t("season.result"),
          defaultInstruction: t("season.instruction"),
          onCandidate: (workflow) => {
            if (workflow.seasonPlanId && !requestedId)
              setFocused(workflow.seasonPlanId);
            void refresh();
          },
        })}
      {readError !== undefined && (
        <p role="alert" className={css.danger}>
          {readError}
        </p>
      )}
      {exactMismatch && <p role="alert">{t("season.navigation")}</p>}
      <div className={css.notice}>
        <h3 className={css.heading}>{t("season.current.title")}</h3>
        <p>
          {t("season.current", {
            current: accepted
              ? t(
                  accepted.sourceState === "stale"
                    ? "season.current.stale"
                    : "season.current.version",
                  { version: accepted.version },
                )
              : t("season.current.none"),
          })}
        </p>
        <div className={css.actions}>
          {history.data?.map((item) => (
            <Button
              key={item.id}
              variant={item.id === shown?.id ? "outline" : "ghost"}
              onClick={() => open(item)}
            >
              {status(item)}
            </Button>
          ))}
        </div>
      </div>
      {shown && (
        <SeasonPlanView
          {...props}
          plan={shown}
          episodeIds={episodeIds}
          changedOrder={changedOrder}
          busy={busy}
          onMove={move}
          onAction={(operation) => void action(shown, operation)}
        />
      )}
      {confirms.adopt.dialog}
      {confirms.reorder.dialog}
      {confirms.discard.dialog}
    </section>
  );
}

/** One plan: its basis, coverage, complete episode order and actions. */
function SeasonPlanView(
  props: ToolProps & {
    plan: SeasonPlan;
    episodeIds: readonly string[];
    changedOrder: boolean;
    busy: boolean;
    onMove(index: number, direction: number): void;
    onAction(operation: Operation): void;
  },
) {
  const { t, plan, busy } = props;
  const { basis, content } = plan;
  const join = (items: readonly string[]) => items.join(t("season.separator"));
  const list = (items: readonly string[]) =>
    items.join(t("season.list.separator"));
  const chapterTitle = (chapterId: string) =>
    basis.chapters.find((item) => item.id === chapterId)?.title;
  const ordered = props.episodeIds.map((episodeId) =>
    content.episodes.find((item) => item.id === episodeId)!,
  );
  const canEdit =
    plan.sourceState === "current" &&
    (plan.status === "pending" ||
      (plan.status === "adopted" && plan.isCurrent));
  return (
    <article
      aria-label={t("season.plan.label", { version: plan.version })}
      className={css.card}
    >
      <h3 className={css.heading}>
        {t("season.plan.title", {
          version: plan.version,
          theme: content.theme,
        })}
      </h3>
      <p>
        {t("season.plan.basis", {
          diagnosis: basis.diagnosis.version,
          strategy: basis.diagnosis.strategyId,
          intent: basis.authorIntent.version,
          scope: t(`season.plan.scope.${basis.scope}`),
          episodes: content.episodes.length,
          duration: basis.target.durationSeconds,
        })}
      </p>
      {basis.sourceBasis &&
        props.renderFactorySlot("automation.source-coverage", {
          basis: basis.sourceBasis,
          chapters: basis.chapters,
          label: t("season.plan.coverage"),
        })}
      <p>
        {t("season.plan.conflict", {
          conflict: content.mainConflict,
          promise: content.emotionalPromise,
        })}
      </p>
      {plan.sourceState === "stale" && (
        <p role="alert" className={css.danger}>
          {t("season.plan.stale", { reasons: join(plan.staleReasons) })}
        </p>
      )}
      <section aria-label={t("season.sources.label")} className={css.list}>
        <h4 className={css.heading}>{t("season.sources.title")}</h4>
        {plan.coverage.map((item) => (
          <p key={item.chapterId}>
            {t("season.sources.item", {
              title: chapterTitle(item.chapterId) ?? "",
              version: item.chapterVersion,
              disposition:
                item.disposition === "used"
                  ? list(
                      item.episodeIds.map(
                        (episodeId) =>
                          content.episodes.find(
                            (episode) => episode.id === episodeId,
                          )?.title ?? episodeId,
                      ),
                    )
                  : item.disposition === "omitted"
                    ? t("season.sources.omitted", {
                        reason: item.omissionReason ?? "",
                      })
                    : t("season.sources.unaccounted"),
            })}
          </p>
        ))}
        <p>
          {t("season.sources.unread", {
            count: basis.omittedChapters.length,
            chapters: list(
              basis.omittedChapters.map((item) =>
                t("season.sources.chapter", {
                  title: item.title,
                  version: item.version,
                }),
              ),
            ),
          })}
        </p>
      </section>
      <section aria-label={t("season.order.label")} className={css.list}>
        <h4 className={css.heading}>{t("season.order.title")}</h4>
        {ordered.map((episode, index) => (
          <div
            key={episode.id}
            aria-label={t("season.episode.label", { id: episode.id })}
            className={css.notice}
          >
            <div className={css.row}>
              <h5 className={css.heading}>
                {t("season.episode.title", {
                  index: index + 1,
                  title: episode.title,
                })}
              </h5>
              <div className={css.actions}>
                <Button
                  aria-label={t("season.episode.up.label", { id: episode.id })}
                  disabled={!canEdit || busy || index === 0}
                  onClick={() => props.onMove(index, -1)}
                >
                  {t("season.episode.up")}
                </Button>
                <Button
                  aria-label={t("season.episode.down.label", {
                    id: episode.id,
                  })}
                  disabled={!canEdit || busy || index === ordered.length - 1}
                  onClick={() => props.onMove(index, 1)}
                >
                  {t("season.episode.down")}
                </Button>
              </div>
            </div>
            <p>{episode.logline}</p>
            <p>
              {t("season.episode.goal", {
                goal: episode.goal,
                conflict: episode.mainConflict,
              })}
            </p>
            <p>
              {t("season.episode.turn", {
                turn: episode.turningPoint,
                hook: episode.endingHook,
              })}
            </p>
            <p>
              {t("season.episode.progress", {
                progress: join(
                  episode.characterProgress.map((item) =>
                    t("season.episode.progress.item", {
                      character: item.character,
                      before: item.before,
                      after: item.after,
                      change: item.relationshipChange,
                    }),
                  ),
                ),
              })}
            </p>
            <p>
              {t("season.episode.foreshadowing", {
                planted:
                  join(episode.plantedForeshadowing) ||
                  t("season.episode.none"),
                paid:
                  join(episode.paidOffForeshadowing) ||
                  t("season.episode.none"),
              })}
            </p>
            <p>
              {t("season.episode.production", {
                scenes: episode.estimatedScenes,
                characters: episode.estimatedCharacters,
                risk: t(`season.risk.${episode.productionRisk}`),
                notes: episode.productionNotes,
              })}
            </p>
            <p>
              {t("season.episode.sources", {
                sources: join(
                  episode.sourceChapters.map((source) =>
                    t("season.episode.source", {
                      title: chapterTitle(source.id) ?? source.id,
                      version: source.version,
                      rationale: source.rationale,
                    }),
                  ),
                ),
              })}
            </p>
          </div>
        ))}
        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={!canEdit || busy || !props.changedOrder}
            onClick={() => props.onAction("reorder")}
          >
            {t("season.reorder")}
          </Button>
        </div>
        {props.changedOrder && (
          <p className={css.muted}>{t("season.reorder.unsaved")}</p>
        )}
      </section>
      <p>
        {t("season.risks", {
          risks: join(content.risks) || t("season.risks.none"),
        })}
      </p>
      <div className={css.actions}>
        <Button
          variant="primary"
          disabled={
            busy ||
            props.changedOrder ||
            plan.status !== "pending" ||
            plan.sourceState !== "current"
          }
          onClick={() => props.onAction("adopt")}
        >
          {t("season.adopt")}
        </Button>
        <Button
          disabled={busy || !["pending", "conflicted"].includes(plan.status)}
          onClick={() => props.onAction("discard")}
        >
          {t("season.discard")}
        </Button>
      </div>
    </article>
  );
}
