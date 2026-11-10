import { clsx } from "clsx";
import css from "./Creation.module.css";
import type { CreationWorkflow, Translate } from "./remote.ts";
import {
  FrozenStorySources,
  NarrativeSourceCoverage,
  QualitySourceCoverage,
  type NarrativeSourceBasis,
} from "./SourceCoverage.tsx";

/**
 * How a frozen chapter scope was chosen.
 * @param mode - the scope's mode.
 * @param none - the copy for a scope that uses no chapters.
 */
const scopeText = (
  t: Translate,
  mode: string,
  none: "sources.scope.noneAll" | "sources.scope.none",
) =>
  t(
    mode === "none"
      ? none
      : mode === "full"
        ? "sources.scope.full"
        : "sources.scope.partial",
  );

const count = (
  chapters: readonly { representation: string }[],
  representation: string,
) => chapters.filter((item) => item.representation === representation).length;

/** The estimate of a run's first prompt, when its basis recorded one. */
function Budget({
  budget,
  t,
  keyName = "sources.budget",
}: {
  budget: { estimatedTokens: number; tokenBudget: number } | undefined;
  t: Translate;
  keyName?: "sources.budget" | "sources.budget.frozen";
}) {
  return budget ? (
    <p className={css.small}>
      {t(keyName, {
        estimated: budget.estimatedTokens,
        budget: budget.tokenBudget,
      })}
    </p>
  ) : null;
}

/** Props of {@link CreationSources}. */
export interface CreationSourcesProps {
  workflow: CreationWorkflow;
  t: Translate;
}

/**
 * The sources a run froze when it started: how each basis chose its scope,
 * what each chapter was given as, and every context entry it was offered.
 * Nothing when the run recorded no sources.
 */
export function CreationSources({ workflow: value, t }: CreationSourcesProps) {
  if (!value.sources.length) return null;
  const context = value.narrativeContextBasis;
  const summary = value.narrativeSummaryBasis;
  const quality = value.narrativeQualityBasis?.sourceBasis;
  const adaptation = value.diagnosisBasis?.sourceBasis
    ? value.diagnosisBasis
    : value.seasonPlanBasis?.sourceBasis
      ? value.seasonPlanBasis
      : undefined;
  return (
    <details>
      <summary className={css.summary}>
        {t("sources.title", { count: value.sources.length })}
      </summary>
      <div className={css.stack}>
        <p className={css.muted}>{t("sources.frozen")}</p>
        {value.authorIntent && (
          <p
            className={css.text}
            data-creation-author-intent={value.authorIntent.state}
          >
            {value.authorIntent.state === "adopted"
              ? t("sources.intent.adopted", {
                  version: value.authorIntent.version ?? "",
                })
              : t("sources.intent.none")}
          </p>
        )}
        {value.authorIntentBasis?.sourceBasis && (
          <div data-author-intent-source-coverage className={css.stack}>
            <p className={css.text}>{t("sources.intent.scope")}</p>
            <NarrativeSourceCoverage
              basis={
                value.authorIntentBasis.sourceBasis as NarrativeSourceBasis
              }
              chapters={value.authorIntentBasis.chapters ?? []}
              label={t("sources.intent.label")}
              t={t}
            />
          </div>
        )}
        {value.productionNarrativeBasis && (
          <div data-production-source-coverage className={css.stack}>
            <p className={css.text}>
              {t("sources.production.scope", {
                scope: scopeText(
                  t,
                  value.productionNarrativeBasis.request.chapterScope.mode,
                  "sources.scope.noneAll",
                ),
                coverage:
                  value.productionNarrativeBasis.coverage.directoryState ===
                  "not-read"
                    ? t("sources.production.unread")
                    : t("sources.production.read", {
                        included:
                          value.productionNarrativeBasis.coverage.included
                            .length,
                        excluded:
                          value.productionNarrativeBasis.coverage.excluded
                            .length,
                        total:
                          value.productionNarrativeBasis.coverage
                            .totalChapterCount ?? 0,
                      }),
              })}
            </p>
            <NarrativeSourceCoverage
              basis={
                value.productionNarrativeBasis
                  .sourceBasis as NarrativeSourceBasis
              }
              chapters={value.productionNarrativeBasis.coverage.included}
              label={t("sources.production.label")}
              t={t}
            />
            <Budget
              budget={value.productionNarrativeBasis.contextBudget}
              t={t}
            />
          </div>
        )}
        {value.narrativePlanningBasis && (
          <div data-planning-source-coverage className={css.stack}>
            <p className={css.text}>
              {t("sources.planning.scope", {
                scope: scopeText(
                  t,
                  value.narrativePlanningBasis.request.chapterScope.mode,
                  "sources.scope.none",
                ),
                included: value.narrativePlanningBasis.coverage.included.length,
                excluded: value.narrativePlanningBasis.coverage.excluded.length,
              })}
            </p>
            <NarrativeSourceCoverage
              basis={
                value.narrativePlanningBasis.sourceBasis as NarrativeSourceBasis
              }
              chapters={value.narrativePlanningBasis.coverage.included}
              label={t("sources.planning.label")}
              t={t}
            />
            <Budget budget={value.narrativePlanningBasis.contextBudget} t={t} />
          </div>
        )}
        {context && (
          <div className={css.stack} data-novel-context-coverage>
            <p className={css.text}>
              {t("sources.context.coverage", {
                included: new Set([
                  ...context.chapters.map((chapter) => chapter.id),
                  ...(context.summaries ?? []).flatMap((item) =>
                    item.chapters.map((chapter) => chapter.id),
                  ),
                ]).size,
                omitted: context.omitted.length,
                original: count(context.chapters, "original"),
                summary: count(context.chapters, "summary"),
                paragraphs: count(context.chapters, "paragraphs"),
              })}
            </p>
            <Budget
              budget={context.contextBudget}
              t={t}
              keyName="sources.budget.frozen"
            />
          </div>
        )}
        <FrozenStorySources sources={context?.story} t={t} />
        {context?.summaries?.map((item) => (
          <details key={item.id} className={clsx(css.small, css.breakAll)}>
            <summary className={css.summary}>
              {t("sources.context.summary")}
            </summary>
            <p className={css.small}>
              {t("sources.context.summaryDetail", {
                title: item.scopeTitle,
                id: item.id,
                version: item.version,
                count: item.chapters.length,
              })}
              {item.scopeState === "stale"
                ? t("sources.context.summaryStale")
                : ""}
              {t("sources.context.summaryFrozen")}
            </p>
            {item.chapters.map((chapter) => (
              <p key={chapter.id} className={css.small}>
                {t("version.of", { id: chapter.id, version: chapter.version })}
              </p>
            ))}
          </details>
        ))}
        {summary && (
          <p className={css.small}>
            {t("sources.summary", {
              title: summary.scopeTitle,
              references: summary.references.length,
              empty: summary.directory.filter((item) => !item.hasContent)
                .length,
              original: count(summary.references, "original"),
              summary: count(summary.references, "summary"),
            })}
          </p>
        )}
        {quality && (
          <div className={css.stack} data-quality-expression-context>
            <p className={css.text}>
              {t("sources.quality", {
                original: count(quality.chapters, "original"),
                summary: count(quality.chapters, "summary"),
                paragraphs: count(quality.chapters, "paragraphs"),
                summaries: quality.summaries?.length ?? 0,
              })}
            </p>
            {quality.summaries?.map((item) => (
              <details key={item.id} className={css.breakAll}>
                <summary className={css.summary}>
                  {t("sources.quality.summary")}
                </summary>
                <p className={css.small}>
                  {t("version.titled", {
                    id: item.id,
                    version: item.version,
                    title: item.scopeTitle,
                  })}
                </p>
                {item.chapters.map((chapter) => (
                  <p key={chapter.id} className={css.small}>
                    {t("version.of", {
                      id: chapter.id,
                      version: chapter.version,
                    })}
                  </p>
                ))}
              </details>
            ))}
            <QualitySourceCoverage
              basis={
                value.narrativeQualityBasis as Parameters<
                  typeof QualitySourceCoverage
                >[0]["basis"]
              }
              t={t}
            />
          </div>
        )}
        {adaptation && (
          <NarrativeSourceCoverage
            basis={adaptation.sourceBasis as NarrativeSourceBasis}
            chapters={adaptation.chapters}
            label={t("sources.adaptation.label")}
            t={t}
          />
        )}
        <ul className={css.list}>
          {(value.contextEntries ?? []).map((entry, index) => (
            <li key={index}>
              <span className={clsx(entry.included && css.included)}>
                {t(
                  entry.included
                    ? "sources.entry.included"
                    : "sources.entry.excluded",
                  { title: entry.title },
                )}
              </span>
              <p className={css.small}>
                {entry.reason}
                {entry.estimatedTokens !== undefined
                  ? t("sources.entry.tokens", {
                      tokens: entry.estimatedTokens,
                    })
                  : ""}
              </p>
              {entry.sourceId && (
                <p className={clsx(css.small, css.breakAll)}>
                  {t("sources.entry.source", {
                    id: entry.sourceId,
                    version: entry.sourceVersion ?? "",
                    field: entry.fieldPath ?? "",
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
