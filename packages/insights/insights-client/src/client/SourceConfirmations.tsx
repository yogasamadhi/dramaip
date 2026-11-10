import type { CreativeOutcomeSummary } from "@dramaip/insights-insights/types";
import { when, type Translate } from "./outcome-reads.ts";
import css from "./Outcomes.module.css";

const WORKFLOWS = {
  novel: "outcomes.source.workflow.novel",
  adaptation: "outcomes.source.workflow.adaptation",
} as const;

const KINDS = {
  chapter: "outcomes.source.kind.chapter",
  "script-record": "outcomes.source.kind.record",
  "script-document": "outcomes.source.kind.document",
} as const;

/** Read-only original owner receipts: no current-child reads or actions. */
export function SourceConfirmations({
  value,
  t,
}: {
  value: CreativeOutcomeSummary["sourceConfirmations"];
  t: Translate;
}) {
  if (value.recordedConfirmations === 0) return null;
  return (
    <section aria-label={t("outcomes.source.title")} className={css.block}>
      <h3 className={css.heading}>{t("outcomes.source.title")}</h3>
      <p className={css.text}>
        {t("outcomes.source.recorded", {
          recorded: value.recordedConfirmations,
          shown: value.items.length,
        })}
      </p>
      <p className={css.text}>
        {value.byWorkflow
          .map((row) =>
            t("outcomes.source.workflow.count", {
              path: t(
                WORKFLOWS[row.workflowPath as keyof typeof WORKFLOWS] ??
                  "outcomes.source.workflow.other",
              ),
              total: row.total,
            }),
          )
          .join(t("outcomes.separator"))}
      </p>
      {value.items.map((source) => (
        <div
          key={source.eventId}
          data-source-confirmation-id={source.sourceId}
          className={css.item}
        >
          <p className={css.text}>
            {t("outcomes.source.entry", {
              entry: t(
                source.entry === "ordinary-import"
                  ? "outcomes.source.entry.ordinary"
                  : "outcomes.source.entry.native",
              ),
              format: source.sourceFormat,
              entries: source.entryCount,
              scenes: source.sceneCount,
            })}
          </p>
          <p className={css.text}>
            {t("outcomes.source.origin", {
              sourceId: source.sourceId,
              projectId: source.projectId,
              version: source.projectVersion,
            })}
          </p>
          <p className={css.text}>
            {t("outcomes.source.committed", {
              at: when(source.occurredAt),
              owner: source.owner,
            })}
          </p>
          {source.entries.map((entry) => (
            <p
              key={entry.id}
              data-original-source-binding-id={entry.id}
              className={css.text}
            >
              {entry.kind === "script-document"
                ? t("outcomes.source.binding.document", {
                    index: entry.sourceIndex + 1,
                    kind: t(KINDS[entry.kind]),
                    id: entry.id,
                    version: entry.version,
                    preview: entry.previewEntryId,
                    scriptId: entry.scriptId,
                    scriptVersion: entry.scriptVersion,
                  })
                : t("outcomes.source.binding", {
                    index: entry.sourceIndex + 1,
                    kind: t(KINDS[entry.kind]),
                    id: entry.id,
                    version: entry.version,
                  })}
            </p>
          ))}
          <details className={css.small}>
            <summary>{t("outcomes.source.fingerprints")}</summary>
            <p className={css.text}>
              {t("outcomes.source.binding.sha", {
                fingerprint: source.bindingFingerprint,
              })}
            </p>
            <p className={css.text}>
              {t("outcomes.source.receipt.sha", {
                fingerprint: source.receiptFingerprint,
              })}
            </p>
          </details>
          {source.lossReportReviewed && (
            <p className={css.text}>{t("outcomes.source.loss")}</p>
          )}
        </div>
      ))}
      <p className={css.small}>{t("outcomes.source.note.owner")}</p>
      <p className={css.small}>{t("outcomes.source.note.path")}</p>
    </section>
  );
}
