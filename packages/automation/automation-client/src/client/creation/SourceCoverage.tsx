import { Button } from "@dramaip/infra-ui-primitives";
import { clsx } from "clsx";
import css from "./Creation.module.css";
import {
  completeScriptMergeOrder,
  moveScriptMergeBlock,
  selectedScriptMergeIds,
} from "./recovery.ts";
import type { CreationIssue, CreationMerge, Translate } from "./remote.ts";

/** One frozen story interpretation a run was given. */
export interface StorySource {
  selection: { kind: string; id: string; version: number };
  record: { kind: string; id: string; version: number };
  sourceFingerprint: string;
  contentHash: string;
  sourceChapters: readonly { id: string; version: number }[];
  sourceScripts: readonly { id: string; version: number }[];
}

/** The frozen narrative a run was given: each chapter's form and its references. */
export interface NarrativeSourceBasis {
  chapters: readonly { id: string; representation: string }[];
  summaries?:
    | readonly {
        id: string;
        version: number;
        scopeTitle: string;
        scopeState: string;
        chapters: readonly { id: string; version: number }[];
      }[]
    | undefined;
  references: readonly {
    sourceKind: string;
    sourceId: string;
    sourceVersion: number | string;
    fieldPath: string;
    contentHash: string;
  }[];
  omitted: readonly { id: string; version: number; reason: string }[];
  story?: readonly StorySource[] | undefined;
}

const REPRESENTATIONS = {
  original: "coverage.form.original",
  summary: "coverage.form.summary",
  paragraphs: "coverage.form.paragraphs",
  "hierarchical-summary": "coverage.form.hierarchical",
} as const;

/**
 * The forms one chapter was given in: its own entries, and a frozen higher
 * summary when one covers it.
 * @param basis - the frozen narrative.
 * @param chapterId - the chapter.
 */
export function chapterRepresentations(
  basis: NarrativeSourceBasis,
  chapterId: string,
): string[] {
  return [
    ...basis.chapters
      .filter((item) => item.id === chapterId)
      .map((item) => item.representation),
    ...(basis.summaries?.some((item) =>
      item.chapters.some((chapter) => chapter.id === chapterId),
    )
      ? ["hierarchical-summary"]
      : []),
  ];
}

/** The frozen story interpretations a run was given. */
export function FrozenStorySources({
  sources,
  t,
}: {
  sources?: readonly StorySource[] | undefined;
  t: Translate;
}) {
  if (!sources?.length) return null;
  return (
    <section aria-label={t("coverage.story.aria")} className={css.block}>
      <h4 className={css.heading}>
        {t("coverage.story.title", { count: sources.length })}
      </h4>
      <p className={css.small}>{t("coverage.story.note")}</p>
      {sources.map((source) => (
        <details
          key={`${source.selection.kind}:${source.selection.id}`}
          className={css.breakAll}
        >
          <summary className={css.summary}>
            {t("version.kind", {
              kind: source.selection.kind,
              id: source.selection.id,
              version: source.selection.version,
            })}
          </summary>
          <p className={css.small}>
            {t("coverage.story.record", {
              kind: source.record.kind,
              id: source.record.id,
              version: source.record.version,
            })}
          </p>
          <p className={css.small}>
            {t("coverage.story.fingerprint", {
              digest: source.sourceFingerprint,
            })}
          </p>
          <p className={css.small}>
            {t("coverage.story.input", { digest: source.contentHash })}
          </p>
          {source.sourceChapters.map((chapter) => (
            <p key={chapter.id} className={css.small}>
              {t("coverage.story.chapter", {
                id: chapter.id,
                version: chapter.version,
              })}
            </p>
          ))}
          {source.sourceScripts.map((script) => (
            <p key={script.id} className={css.small}>
              {t("coverage.story.script", {
                id: script.id,
                version: script.version,
              })}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}

/** Props of {@link NarrativeSourceCoverage}. */
export interface NarrativeSourceCoverageProps {
  basis: NarrativeSourceBasis;
  chapters: readonly { id: string; version: number; title: string }[];
  label: string;
  t: Translate;
}

/** Props of the `automation.source-coverage` Factory. */
export type SourceCoverageFactoryProps = Omit<
  NarrativeSourceCoverageProps,
  "t"
>;

/** What each chapter was given as, its frozen references and what was left out. */
export function NarrativeSourceCoverage({
  basis,
  chapters,
  label,
  t,
}: NarrativeSourceCoverageProps) {
  return (
    <section aria-label={label} className={css.block}>
      <h4 className={css.heading}>{t("coverage.title", { label })}</h4>
      {chapters.map((chapter) => (
        <p key={chapter.id}>
          {t("coverage.chapter", {
            title: chapter.title,
            version: chapter.version,
            forms: chapterRepresentations(basis, chapter.id)
              .map((item) =>
                item in REPRESENTATIONS
                  ? t(REPRESENTATIONS[item as keyof typeof REPRESENTATIONS])
                  : item,
              )
              .join(" + "),
          })}
        </p>
      ))}
      {basis.summaries?.map((summary) => (
        <details key={summary.id} className={css.breakAll}>
          <summary className={css.summary}>
            {t("coverage.summary.title")}
          </summary>
          <p>
            {t(
              summary.scopeState === "current"
                ? "coverage.summary.current"
                : "coverage.summary.changed",
              {
                scope: summary.scopeTitle,
                id: summary.id,
                version: summary.version,
              },
            )}
          </p>
          {summary.chapters.map((chapter) => (
            <p key={chapter.id}>
              {t("version.of", { id: chapter.id, version: chapter.version })}
            </p>
          ))}
        </details>
      ))}
      <details className={css.breakAll} data-frozen-narrative-references>
        <summary className={css.summary}>
          {t("coverage.references", { count: basis.references.length })}
        </summary>
        <p className={css.small}>{t("coverage.references.note")}</p>
        {basis.references.map((reference, position) => (
          <div key={position} className={css.stack}>
            <p>
              {t("version.kind", {
                kind: reference.sourceKind,
                id: reference.sourceId,
                version: reference.sourceVersion,
              })}
            </p>
            <p>{reference.fieldPath}</p>
            <p>{t("version.digest", { hash: reference.contentHash })}</p>
          </div>
        ))}
      </details>
      {basis.omitted.length > 0 && (
        <details className={css.breakAll} data-frozen-narrative-omissions>
          <summary className={css.summary}>
            {t("coverage.omitted", { count: basis.omitted.length })}
          </summary>
          <p className={css.small}>{t("coverage.omitted.note")}</p>
          {basis.omitted.map((chapter) => (
            <p key={chapter.id}>
              {t(
                chapter.reason === "empty"
                  ? "coverage.omitted.empty"
                  : "coverage.omitted.unselected",
                { id: chapter.id, version: chapter.version },
              )}
            </p>
          ))}
        </details>
      )}
      <FrozenStorySources sources={basis.story} t={t} />
      <p className={css.small}>{t("coverage.note")}</p>
    </section>
  );
}

/** The frozen reference a quality review compared, when it recorded one. */
export function QualitySourceCoverage({
  basis,
  t,
}: {
  basis: {
    sourceBasis?: NarrativeSourceBasis | undefined;
    chapterCoverage?:
      | {
          included: readonly { id: string; version: number; title: string }[];
        }
      | undefined;
  };
  t: Translate;
}) {
  if (!basis.sourceBasis) return null;
  return (
    <div data-quality-frozen-source-coverage className={css.stack}>
      {!basis.chapterCoverage && (
        <p className={css.muted}>{t("coverage.quality.unknown")}</p>
      )}
      <NarrativeSourceCoverage
        basis={basis.sourceBasis}
        chapters={basis.chapterCoverage?.included ?? []}
        label={t("coverage.quality.label")}
        t={t}
      />
    </div>
  );
}

/** Where a model finding's quotations were found in the checked draft. */
export function IssueEvidence({
  issue,
  t,
}: {
  issue: CreationIssue;
  t: Translate;
}) {
  if (issue.source !== "model") return null;
  const recorded = issue.candidateEvidence;
  if (!recorded) return <p className={css.small}>{t("evidence.unrecorded")}</p>;
  return (
    <details
      aria-label={t("evidence.aria")}
      className={clsx(css.small, css.breakAll)}
    >
      <summary className={css.summary}>
        {t("evidence.title", { count: recorded.matches.length })}
      </summary>
      <p>{t("evidence.note")}</p>
      <p>{t("evidence.digest", { digest: recorded.candidateSha256 })}</p>
      <ul className={css.list}>
        {recorded.matches.map((match) => (
          <li key={`${match.valuePath}:${match.start}:${match.end}`}>
            {match.valuePath} · [{match.start}, {match.end})
          </li>
        ))}
      </ul>
    </details>
  );
}

const CHANGES = {
  unchanged: "order.change.unchanged",
  added: "order.change.added",
  deleted: "order.change.deleted",
  modified: "order.change.modified",
  moved: "order.change.moved",
  conflict: "order.change.conflict",
} as const;

/** Props of {@link ScriptMergeOrderReview}. */
export interface ScriptMergeOrderReviewProps {
  merge: CreationMerge;
  choices: Record<string, "main" | "branch">;
  draft?: string[] | undefined;
  confirmed: boolean;
  busy: boolean;
  t: Translate;
  onOrder: (order: string[]) => void;
  onConfirm: (confirmed: boolean) => void;
}

/** The full block order of a script merge, to arrange and confirm. */
export function ScriptMergeOrderReview({
  merge,
  choices,
  draft,
  confirmed,
  busy,
  t,
  onOrder,
  onConfirm,
}: ScriptMergeOrderReviewProps) {
  const blockOrder = merge.blockOrder;
  if (!blockOrder) return <p>{t("order.unrecorded")}</p>;
  const selected = selectedScriptMergeIds(merge, choices);
  const order = completeScriptMergeOrder(
    draft ?? blockOrder.proposed,
    selected,
  );
  const manual = Boolean(draft) || blockOrder.conflict;
  return (
    <section aria-label={t("order.aria")} className={css.block}>
      <h4 className={css.heading}>{t("order.title")}</h4>
      <p>{t(blockOrder.conflict ? "order.conflict" : "order.settled")}</p>
      <details>
        <summary className={css.summary}>{t("order.ids")}</summary>
        <p className={css.breakAll}>
          {t("order.base", { ids: blockOrder.base.join(" → ") })}
        </p>
        <p className={css.breakAll}>
          {t("order.current", { ids: blockOrder.current.join(" → ") })}
        </p>
        <p className={css.breakAll}>
          {t("order.candidate", { ids: blockOrder.candidate.join(" → ") })}
        </p>
      </details>
      <div className={css.actions}>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            onOrder(completeScriptMergeOrder(blockOrder.current, selected))
          }
        >
          {t("order.fromCurrent")}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            onOrder(completeScriptMergeOrder(blockOrder.candidate, selected))
          }
        >
          {t("order.fromCandidate")}
        </Button>
      </div>
      <p className={css.small}>{t("order.note")}</p>
      <ol className={css.list}>
        {order.map((id, index) => {
          const unit = merge.units.find((item) => item.id === id)!;
          const choice = choices[id] ?? unit.choice;
          return (
            <li key={id} className={css.block}>
              <p className={css.breakAll}>
                {t("order.unit", {
                  position: index + 1,
                  id,
                  change: unit.kind
                    ? t(CHANGES[unit.kind])
                    : t("order.change.unmarked"),
                  side:
                    choice === "main"
                      ? t("order.side.current")
                      : t("order.side.candidate"),
                })}
              </p>
              <p className={css.prose}>
                {choice === "main" ? unit.current : unit.candidate}
              </p>
              <div className={css.actions}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || index === 0}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, -1))}
                >
                  {t("order.up", { position: index + 1 })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || index === order.length - 1}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, 1))}
                >
                  {t("order.down", { position: index + 1 })}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {manual && (
        <label className={css.check}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          {t("order.confirm")}
        </label>
      )}
    </section>
  );
}
