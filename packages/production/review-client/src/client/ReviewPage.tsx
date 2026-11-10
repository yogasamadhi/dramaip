import { useEffect, useId, useState, type MouseEvent } from "react";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {
  LegacyProductionScope,
  LegacyScopeRecord,
} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "./contract.ts";
import css from "./ReviewPage.module.css";

/** The stages of the page, in the order the work goes. */
export const REVIEW_STAGES = [
  "quality",
  "compliance",
  "review",
  "localization",
  "delivery",
] as const;

export type ReviewStage = (typeof REVIEW_STAGES)[number];

const isStage = (value: string | null): value is ReviewStage =>
  REVIEW_STAGES.includes(value as ReviewStage);

/** Full component props of the `/review` page. */
export type ReviewPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"review.stage" | "review.section"> &
  PropsLocale<"review">;

/**
 * The review and delivery page: checks the objects the address names, then
 * lays out the episode choice, the stage navigation, every registered
 * `review.section` and the chosen stage's `review.stage` entry.
 */
export function ReviewPage(props: ReviewPageProps) {
  const { t } = props;
  const scope = props.useProductionScope();
  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("page.title")}</h1>
        <p className={css.description}>{t("page.description")}</p>
      </header>
      {scope.status === "ready" ? (
        <ReviewScope key={scope.key} {...props} scope={scope} />
      ) : (
        <section className={css.card} aria-label={t("scope.check.label")}>
          <p role={scope.status === "failed" ? "alert" : "status"}>
            {t(scope.status === "failed" ? "scope.failed" : "scope.checking")}
          </p>
          {scope.status === "failed" && (
            <RouteLink navigate={props.navigate} to="/">
              {t("scope.failed.back")}
            </RouteLink>
          )}
        </section>
      )}
    </div>
  );
}

/** A link into the app's router. */
function RouteLink(props: {
  navigate: (path: string) => void;
  to: string;
  children: string;
}) {
  return (
    <a
      className={css.link}
      href={props.to}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        props.navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

function ScopeSelect(props: {
  label: string;
  none: string;
  value: string;
  disabled?: boolean;
  records: readonly LegacyScopeRecord[];
  onChange(value: string): void;
}) {
  return (
    <label className={css.field}>
      {props.label}
      <select
        className={css.select}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{props.none}</option>
        {props.records.map((record) => (
          <option key={record.id} value={record.id}>
            {record.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The page inside one checked scope; remounted when the address names others. */
function ReviewScope(
  props: ReviewPageProps & { scope: LegacyProductionScope },
) {
  const { t, renderSlot, navigate } = props;
  const scope = props.useEpisodeScope("/review", props.scope);
  const { projectId, adaptationId, episodeId } = scope;
  const [stage, setStage] = useState<ReviewStage>(() =>
    isStage(scope.requestedStage) ? scope.requestedStage : "quality",
  );
  useEffect(() => {
    if (isStage(scope.requestedStage)) setStage(scope.requestedStage);
  }, [scope.requestedStage]);
  const stateId = useId();
  const projectTitle = scope.projects.find(
    (project) => project.id === projectId,
  )?.title;
  const episodeTitle =
    scope.episodes.find((episode) => episode.id === episodeId)?.title ?? "";
  const ready = Boolean(projectId && adaptationId && episodeId);
  const recommended = isStage(scope.requestedStage)
    ? scope.requestedStage
    : "quality";
  const blocked = !projectId
    ? {
        reason: t("stage.blocked.project"),
        label: t("stage.recover.project"),
        to: "/",
      }
    : {
        reason: t(
          adaptationId ? "stage.blocked.episode" : "stage.blocked.adaptation",
        ),
        label: t("stage.recover.adaptation"),
        to: `/adapt?${new URLSearchParams({
          projectId,
          stage: adaptationId ? "episodes" : "adaptations",
        })}`,
      };
  const selectors = (
    <section className={css.selectors}>
      <ScopeSelect
        label={t("scope.project")}
        none={t("scope.project.none")}
        value={projectId}
        records={scope.projects}
        onChange={scope.selectProject}
      />
      <ScopeSelect
        label={t("scope.adaptation")}
        none={t("scope.adaptation.none")}
        value={adaptationId}
        disabled={!projectId}
        records={scope.adaptations}
        onChange={scope.selectAdaptation}
      />
      <ScopeSelect
        label={t("scope.episode")}
        none={t("scope.episode.none")}
        value={episodeId}
        disabled={!adaptationId}
        records={scope.episodes}
        onChange={scope.selectEpisode}
      />
    </section>
  );
  const owner = { projectId, adaptationId, episodeId, episodeTitle };
  return (
    <div className={css.workbench}>
      {projectTitle ? (
        <section aria-label={t("scope.label")} className={css.scope}>
          <details className={css.details}>
            <summary className={css.summary}>
              <span className={css.muted}>{t("scope.current")}</span>
              <span className={css.strong}>{projectTitle}</span>
              <span className={css.objects}>
                {episodeTitle ? `· ${episodeTitle}` : t("scope.noEpisode")}
              </span>
              <span className={css.toggleOpen}>{t("scope.open")}</span>
              <span className={css.toggleClose}>{t("scope.close")}</span>
            </summary>
            <div className={css.card}>{selectors}</div>
          </details>
        </section>
      ) : (
        selectors
      )}
      <section className={css.stages}>
        <nav aria-label={t("stages.label")} className={css.stageNav}>
          {REVIEW_STAGES.map((id, index) => {
            const label = t(`stage.${id}`);
            return (
              <button
                key={id}
                type="button"
                className={css.stage}
                aria-current={stage === id ? "step" : undefined}
                aria-label={label}
                aria-describedby={`${stateId}-${id}`}
                onClick={() => {
                  setStage(id);
                  scope.sync({ stage: id });
                }}
              >
                <span className={css.stageLabel}>
                  <span className={css.stageNumber}>{index + 1}</span>
                  {label}
                </span>
                <span
                  id={`${stateId}-${id}`}
                  className={
                    ready && recommended === id
                      ? css.stateRecommended
                      : css.state
                  }
                >
                  {t(
                    !ready
                      ? "stage.state.blocked"
                      : recommended === id
                        ? "stage.state.recommended"
                        : "stage.state.later",
                  )}
                </span>
              </button>
            );
          })}
        </nav>
        {!ready && (
          <div className={css.blocked}>
            <p>{blocked.reason}</p>
            <RouteLink navigate={navigate} to={blocked.to}>
              {blocked.label}
            </RouteLink>
          </div>
        )}
      </section>
      {projectId && episodeId && renderSlot("review.section", owner)}
      {projectId ? (
        renderSlot("review.stage", owner, { entryKey: stage })
      ) : (
        <p className={css.empty}>{t("page.noProject")}</p>
      )}
    </div>
  );
}
