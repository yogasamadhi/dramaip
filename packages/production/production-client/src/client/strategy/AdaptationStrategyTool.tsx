import { clsx } from "clsx";
import { useRef, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type { AdaptationStrategiesListResult } from "@dramaip/production-production/types";
import { useConfirm } from "../tools/confirm.tsx";
import { usePublishedEvents } from "../tools/events.ts";
import { useOwnerRead } from "../tools/owner-read.ts";
import {
  ambiguousNavigation,
  messageOf,
  value,
  type ToolRemotes,
} from "../tools/remote.ts";
import css from "../tools/Tools.module.css";
import {
  STRATEGY_ACTIONS,
  confirmationKey,
  confirmationRecord,
  originalStrategyCandidate,
  originalStrategyWorkflow,
  parseStrategyConfirmation,
  strategyConfirmationMatchesSource,
  strategyRequest,
  type Strategy,
  type StrategyRequest,
} from "./strategy.ts";

/** Full component props of a production tool body. */
export type ToolProps = PropsRuntime<"workspace.tool"> &
  PropsLocale<"production"> &
  PropsRenderFactories &
  ToolRemotes;

type Summary = AdaptationStrategiesListResult["items"][number];

const EVENTS = /^(production\.|writing\.|workspace\.|automation\.creation-)/u;

/** The strategy tool, started over for each project. */
export function AdaptationStrategyEntry(props: ToolProps) {
  return <AdaptationStrategyTool key={props.projectId} {...props} />;
}

/**
 * The independent adaptation strategy: confirm the adopted diagnosis it
 * starts from, run the strategy proposal in the creation workbench, then
 * compare the proposed options and adopt one explicitly. A link names a
 * run and a strategy exactly; neither the latest run nor a cached read
 * stands in for one that does not match or could not be read.
 */
export function AdaptationStrategyTool(props: ToolProps) {
  const { t, projectId, production } = props;
  const params = new URLSearchParams(props.search);
  const navigationError = ambiguousNavigation(params, [
    "workflowId",
    "strategyId",
  ]);
  const workflowId = params.get("workflowId")?.trim() || undefined;
  const requestedId = params.get("strategyId")?.trim() || undefined;
  const [confirmed, setConfirmed] = useState<StrategyRequest | undefined>(
    () => {
      if (workflowId || requestedId || navigationError) return undefined;
      try {
        return parseStrategyConfirmation(
          window.localStorage.getItem(confirmationKey(projectId)),
          projectId,
        );
      } catch {
        return undefined;
      }
    },
  );
  const [focused, setFocused] = useState<string>();
  const [choice, setChoice] = useState<{ id: string; optionId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const adoptConfirm = useConfirm({
    title: t("strategy.adopt.title"),
    cancel: t("strategy.cancel"),
    close: t("strategy.close"),
    accept: t("strategy.adopt.accept"),
  });
  const discardConfirm = useConfirm({
    title: t("strategy.discard.title"),
    cancel: t("strategy.cancel"),
    close: t("strategy.close"),
    accept: t("strategy.discard.accept"),
  });

  const catalog = useOwnerRead(
    navigationError ? undefined : `sources:${projectId}`,
    async () => {
      const source = await value(
        production.adaptationStrategiesSources(projectId),
      );
      if (source.projectId !== projectId)
        throw new Error(t("strategy.basis.owner"));
      return source;
    },
    2000,
  );
  const original = useOwnerRead(
    !navigationError && workflowId ? `workflow:${workflowId}` : undefined,
    () => value(props.automation.creationGet(workflowId!)),
    1500,
  );
  const validWorkflow =
    workflowId && !navigationError
      ? originalStrategyWorkflow(original.data, {
          projectId,
          workflowId,
          ...(requestedId ? { strategyId: requestedId } : {}),
        })
      : undefined;
  const request = workflowId
    ? validWorkflow?.input.adaptationStrategyRequest
    : confirmed;
  const history = useOwnerRead(
    navigationError ? undefined : `history:${projectId}`,
    async () => {
      const items: Summary[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await value(
          production.adaptationStrategiesList(projectId, {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
          }),
        );
        if (page.items.some((item) => item.projectId !== projectId))
          throw new Error(t("strategy.history.owner"));
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor !== undefined && seen.has(cursor))
          throw new Error(t("strategy.history.cursor"));
        if (cursor !== undefined) seen.add(cursor);
      } while (cursor !== undefined);
      return items;
    },
    1500,
  );
  const id =
    requestedId ??
    (workflowId
      ? validWorkflow?.adaptationStrategyId
      : (focused ?? history.data?.[0]?.id));
  const candidate = useOwnerRead(
    !navigationError && id ? `strategy:${id}:${workflowId ?? ""}` : undefined,
    () => value(production.adaptationStrategiesGet(id!)),
    1500,
  );
  const shown =
    id && !navigationError
      ? originalStrategyCandidate(
          candidate.data,
          {
            projectId,
            strategyId: id,
            ...(workflowId ? { workflowId } : {}),
          },
          validWorkflow,
        )
      : undefined;
  const accepted = history.data?.find(
    (item) => item.isCurrent && item.status === "adopted",
  );
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
    `/projects/${projectId}/tools/adaptation-strategy${
      String(search) ? `?${search}` : ""
    }`;
  const exactPath = (item: { workflowId: string; id: string }) =>
    path(
      new URLSearchParams({ workflowId: item.workflowId, strategyId: item.id }),
    );
  const confirmBasis = async () => {
    try {
      const fresh = await catalog.refetch();
      const next = fresh && strategyRequest(fresh);
      if (!next) throw new Error(t("strategy.basis.required"));
      window.localStorage.setItem(
        confirmationKey(projectId),
        confirmationRecord(projectId, next),
      );
      setConfirmed(next);
      props.navigate(path(new URLSearchParams()));
      setFocused(undefined);
      setChoice(undefined);
      setError(undefined);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const readBusy =
    candidate.fetching || Boolean(workflowId && original.fetching);
  const action = async (strategy: Strategy, kind: "adopt" | "discard") => {
    if (busy || readBusy) return;
    const optionId = choice?.id === strategy.id ? choice.optionId : undefined;
    if (kind === "adopt" && !optionId) {
      setError(t("strategy.adopt.choose"));
      return;
    }
    const accepted = await (
      kind === "adopt" ? adoptConfirm : discardConfirm
    ).ask(t(`strategy.${kind}.description`));
    if (!accepted) return;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify([
      strategy.id,
      strategy.stateVersion,
      kind,
      optionId,
    ]);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const ifMatch = `"${strategy.stateVersion}"`;
    try {
      const result = await value(
        kind === "adopt"
          ? production.adaptationStrategiesAdopt(
              strategy.id,
              { confirmed: true, optionId: optionId! },
              ifMatch,
              key,
            )
          : production.adaptationStrategiesDiscard(
              strategy.id,
              {},
              ifMatch,
              key,
            ),
      );
      setFocused(result.id);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (navigationError)
    return (
      <section aria-label={t("strategy.label")} className={css.tool}>
        <p role="alert" className={css.danger}>
          {t("strategy.navigation")}
        </p>
      </section>
    );
  const source = catalog.data;
  const workflowMissing =
    workflowId &&
    (original.error !== undefined ||
      (!original.loading &&
        !original.fetching &&
        original.data &&
        !validWorkflow));
  const errors = [
    error,
    catalog.error !== undefined && messageOf(catalog.error),
    history.error !== undefined && messageOf(history.error),
    candidate.error !== undefined && messageOf(candidate.error),
    !candidate.loading &&
      !candidate.fetching &&
      candidate.data &&
      !shown &&
      t("strategy.mismatch"),
  ].filter((text): text is string => Boolean(text));
  return (
    <section aria-label={t("strategy.label")} className={css.tool}>
      <div className={css.card}>
        <h2 className={css.heading}>{t("strategy.basis.title")}</h2>
        <p className={css.muted}>{t("strategy.basis.description")}</p>
        <p>
          {t("strategy.basis.diagnosis", {
            diagnosis: source?.diagnosis
              ? t(
                  catalog.fetching
                    ? "strategy.basis.diagnosis.rechecking"
                    : "strategy.basis.diagnosis.version",
                  { version: source.diagnosis.version },
                )
              : t("strategy.basis.diagnosis.none"),
          })}
          <a
            className={css.link}
            href={`#/projects/${projectId}/tools/adaptation-diagnosis`}
          >
            {t("strategy.basis.check")}
          </a>
        </p>
        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={busy || catalog.fetching || !source?.diagnosis}
            onClick={() => void confirmBasis()}
          >
            {t("strategy.basis.confirm")}
          </Button>
        </div>
        {request && (
          <p>
            {t("strategy.frozen", {
              version: request.diagnosis.version,
              next: workflowId
                ? t("strategy.frozen.workflow")
                : t("strategy.frozen.start"),
            })}
          </p>
        )}
        {accepted && (
          <p>
            {t("strategy.accepted", {
              version: accepted.version,
              option: accepted.selectedOptionId ?? "",
              state:
                accepted.sourceState === "current"
                  ? t("strategy.accepted.current")
                  : t("strategy.accepted.stale"),
            })}
            <a
              className={css.link}
              href={`#/projects/${projectId}/tools/season-plan`}
            >
              {t("strategy.accepted.next")}
            </a>
          </p>
        )}
      </div>
      {workflowId &&
        !validWorkflow &&
        original.error === undefined &&
        (original.loading || original.fetching) && (
          <p role="status">{t("strategy.workflow.loading")}</p>
        )}
      {workflowMissing && (
        <p role="alert" className={css.danger}>
          {t("strategy.workflow.missing", {
            message:
              original.error === undefined ? "" : messageOf(original.error),
          })}
        </p>
      )}
      {(!workflowId || validWorkflow) &&
        (!requestedId || (workflowId && shown)) &&
        props.renderFactorySlot("automation.creation-workbench", {
          projectId,
          workflowId,
          operation: "adaptation-strategy",
          adaptationStrategyRequest: request,
          externalReview: true,
          disabled:
            !request ||
            busy ||
            readBusy ||
            (!workflowId &&
              (catalog.error !== undefined || history.error !== undefined)),
          startDisabled:
            !workflowId &&
            !strategyConfirmationMatchesSource(confirmed, source),
          resultLabel: t("strategy.result"),
          defaultInstruction: t("strategy.instruction"),
          onStarted: (workflow) =>
            props.navigate(
              path(new URLSearchParams({ workflowId: workflow.id })),
            ),
          onCandidate: (workflow) => {
            if (
              !requestedId &&
              (!workflowId || workflowId === workflow.id) &&
              workflow.adaptationStrategyId
            )
              props.navigate(
                exactPath({
                  workflowId: workflow.id,
                  id: workflow.adaptationStrategyId,
                }),
              );
            void refresh();
          },
        })}
      {history.data?.length ? (
        <div className={css.actions} aria-label={t("strategy.history")}>
          {history.data.map((item) => (
            <a key={item.id} className={css.chip} href={`#${exactPath(item)}`}>
              {t("strategy.history.item", {
                version: item.version,
                status: item.status,
                current: item.isCurrent ? t("strategy.current") : "",
              })}
            </a>
          ))}
        </div>
      ) : null}
      {shown && (
        <StrategyCandidate
          {...props}
          strategy={shown}
          linkOriginal={!workflowId && Boolean(requestedId)}
          originalPath={exactPath(shown)}
          readBusy={readBusy}
          busy={busy}
          choice={choice?.id === shown.id ? choice.optionId : undefined}
          onChoose={(optionId) => setChoice({ id: shown.id, optionId })}
          onAction={(kind) => void action(shown, kind)}
        />
      )}
      {errors.map((text, index) => (
        <p role="alert" key={index} className={css.danger}>
          {text}
        </p>
      ))}
      {adoptConfirm.dialog}
      {discardConfirm.dialog}
    </section>
  );
}

/** One strategy: its basis, coverage, options to choose and its actions. */
function StrategyCandidate(
  props: ToolProps & {
    strategy: Strategy;
    linkOriginal: boolean;
    originalPath: string;
    readBusy: boolean;
    busy: boolean;
    choice: string | undefined;
    onChoose(optionId: string): void;
    onAction(kind: "adopt" | "discard"): void;
  },
) {
  const { t, strategy } = props;
  const list = (
    items: readonly string[],
    separator:
      | "strategy.action.separator"
      | "strategy.stale.separator"
      | "strategy.findings.separator",
  ) => items.join(t(separator));
  return (
    <article data-adaptation-strategy-id={strategy.id} className={css.card}>
      {props.linkOriginal && (
        <a
          className={clsx(css.link, css.small)}
          href={`#${props.originalPath}`}
        >
          {t("strategy.open")}
        </a>
      )}
      {props.readBusy && <p role="status">{t("strategy.rechecking")}</p>}
      <h3 className={css.heading}>
        {t("strategy.title", {
          version: strategy.version,
          status: strategy.status,
          current: strategy.isCurrent ? t("strategy.current") : "",
        })}
      </h3>
      <p className={css.small}>
        {t("strategy.basis", {
          version: strategy.basis.diagnosis.version,
          chapters: strategy.basis.chapters.length,
          omitted: strategy.basis.omittedChapters.length,
          engine: strategy.engineKind,
        })}
      </p>
      {strategy.basis.sourceBasis &&
        props.renderFactorySlot("automation.source-coverage", {
          basis: strategy.basis.sourceBasis,
          chapters: strategy.basis.chapters,
          label: t("strategy.coverage"),
        })}
      <p>{strategy.content.summary}</p>
      {strategy.sourceState === "stale" && (
        <p role="alert" className={clsx(css.small, css.danger)}>
          {t("strategy.stale", {
            reasons: list(strategy.staleReasons, "strategy.stale.separator"),
          })}
        </p>
      )}
      <fieldset
        disabled={
          props.busy ||
          strategy.status !== "pending" ||
          strategy.sourceState !== "current"
        }
        className={css.fieldset}
      >
        <legend className={css.heading}>{t("strategy.choose")}</legend>
        {strategy.content.options.map((option) => (
          <label key={option.id} className={css.option}>
            <span className={css.optionTitle}>
              <input
                type="radio"
                name={`adaptation-strategy-${strategy.id}`}
                aria-label={t("strategy.option.choose", {
                  title: option.title,
                })}
                checked={props.choice === option.id}
                onChange={() => props.onChoose(option.id)}
              />
              <strong>{option.title}</strong>
              {strategy.selectedOptionId === option.id
                ? t("strategy.option.adopted")
                : ""}
            </span>
            <p className={css.small}>{option.rationale}</p>
            {STRATEGY_ACTIONS.map((name) => (
              <p key={name} className={css.small}>
                {t(`strategy.action.${name}`, {
                  items:
                    list(option[name], "strategy.action.separator") ||
                    t("strategy.action.none"),
                })}
              </p>
            ))}
            <p className={css.small}>
              {t("strategy.rhythm", {
                rhythm: option.rhythm,
                findings: list(
                  option.findingIds,
                  "strategy.findings.separator",
                ),
              })}
            </p>
            <p className={css.small}>
              {t("strategy.risks", {
                risks: list(option.risks, "strategy.action.separator"),
                level: option.productionRisk,
                notes: option.productionNotes,
              })}
            </p>
          </label>
        ))}
      </fieldset>
      <div className={css.actions}>
        {strategy.status === "pending" && (
          <Button
            variant="primary"
            disabled={
              props.busy ||
              props.readBusy ||
              strategy.sourceState !== "current" ||
              props.choice === undefined
            }
            onClick={() => props.onAction("adopt")}
          >
            {t("strategy.adopt")}
          </Button>
        )}
        {(strategy.status === "pending" ||
          strategy.status === "conflicted") && (
          <Button
            variant="ghost"
            disabled={props.busy || props.readBusy}
            onClick={() => props.onAction("discard")}
          >
            {t("strategy.discard")}
          </Button>
        )}
      </div>
    </article>
  );
}
