import { Button, Modal } from "@dramaip/infra-ui-primitives";
import { clsx } from "clsx";
import css from "./Creation.module.css";
import type { ChapterMerge, CreationMerge, Translate } from "./remote.ts";
import { ScriptMergeOrderReview } from "./SourceCoverage.tsx";

/** How one conflicting chapter segment is settled. */
export type ChapterChoice = "current" | "candidate" | "both";
/** How one conflicting script block is settled. */
export type ScriptChoice = "main" | "branch";

/**
 * The merged chapter text: each segment as compared, each conflict as chosen.
 * @param merge - the three-way comparison.
 * @param choices - a choice for every conflicting segment.
 */
export function mergedChapter(
  merge: ChapterMerge,
  choices: Record<string, ChapterChoice>,
): string {
  return merge.segments
    .map((item) =>
      !item.conflict
        ? item.content
        : choices[item.id] === "current"
          ? item.current
          : choices[item.id] === "candidate"
            ? item.candidate
            : `${item.current}\n${item.candidate}`,
    )
    .join("");
}

/** Props of {@link ScriptMergeDialog}. */
export interface ScriptMergeDialogProps {
  merge: CreationMerge | undefined;
  choices: Record<string, ScriptChoice>;
  order: string[] | undefined;
  orderConfirmed: boolean;
  /** An action runs, or a kept merge waits to be checked. */
  blocked: boolean;
  t: Translate;
  onChoose: (unitId: string, choice: ScriptChoice) => void;
  onOrder: (order: string[]) => void;
  onConfirmOrder: (confirmed: boolean) => void;
  onMerge: () => void;
  onClose: () => void;
}

/** The changed script's conflicting blocks and full order, to merge into a rechecked draft. */
export function ScriptMergeDialog({
  merge,
  choices,
  order,
  orderConfirmed,
  blocked,
  t,
  onChoose,
  onOrder,
  onConfirmOrder,
  onMerge,
  onClose,
}: ScriptMergeDialogProps) {
  const unsettled =
    !merge ||
    merge.units.some((unit) => unit.conflict && !choices[unit.id]) ||
    ((merge.blockOrder?.conflict || order !== undefined) && !orderConfirmed);
  return (
    <Modal
      open={Boolean(merge)}
      onClose={onClose}
      title={t("scriptMerge.title")}
      description={t("scriptMerge.description")}
      closeLabel={t("dialog.close")}
      contentClassName={clsx(css.dialogBody)}
      footer={
        <Button
          variant="primary"
          disabled={blocked || unsettled}
          onClick={onMerge}
        >
          {t("scriptMerge.submit")}
        </Button>
      }
    >
      {merge?.units
        .filter((unit) => unit.conflict)
        .map((unit) => (
          <section key={unit.id} className={css.block}>
            <div className={css.pair}>
              <p className={css.prose}>
                {t("scriptMerge.current", { text: unit.current })}
              </p>
              <p className={css.prose}>
                {t("scriptMerge.candidate", { text: unit.candidate })}
              </p>
            </div>
            <select
              aria-label={t("scriptMerge.choice")}
              className={css.select}
              value={choices[unit.id] ?? ""}
              onChange={(event) =>
                onChoose(unit.id, event.target.value as ScriptChoice)
              }
            >
              <option value="" disabled>
                {t("dialog.choose")}
              </option>
              <option value="main">{t("scriptMerge.keepCurrent")}</option>
              <option value="branch">{t("scriptMerge.takeCandidate")}</option>
            </select>
          </section>
        ))}
      {merge && (
        <ScriptMergeOrderReview
          merge={merge}
          choices={choices}
          draft={order}
          confirmed={orderConfirmed}
          busy={blocked}
          t={t}
          onOrder={onOrder}
          onConfirm={onConfirmOrder}
        />
      )}
    </Modal>
  );
}

/** Props of {@link ChapterMergeDialog}. */
export interface ChapterMergeDialogProps {
  merge: ChapterMerge | undefined;
  choices: Record<string, ChapterChoice>;
  blocked: boolean;
  t: Translate;
  onChoose: (segmentId: string, choice: ChapterChoice) => void;
  onMerge: () => void;
  onClose: () => void;
}

/** The changed chapter's conflicting segments, to settle before adopting. */
export function ChapterMergeDialog({
  merge,
  choices,
  blocked,
  t,
  onChoose,
  onMerge,
  onClose,
}: ChapterMergeDialogProps) {
  const unsettled =
    !merge || merge.segments.some((item) => item.conflict && !choices[item.id]);
  return (
    <Modal
      open={Boolean(merge)}
      onClose={onClose}
      title={t("chapterMerge.title")}
      description={t("chapterMerge.description")}
      closeLabel={t("dialog.close")}
      contentClassName={clsx(css.dialogBody)}
      footer={
        <Button
          variant="primary"
          disabled={blocked || unsettled}
          onClick={onMerge}
        >
          {t("chapterMerge.submit")}
        </Button>
      }
    >
      {merge?.segments
        .filter((item) => item.conflict)
        .map((item) => (
          <section key={item.id} className={css.block}>
            <div className={css.columns}>
              <div>
                <h3 className={css.heading}>{t("chapterMerge.base")}</h3>
                <pre className={css.code}>{item.base}</pre>
              </div>
              <div>
                <h3 className={css.heading}>{t("chapterMerge.current")}</h3>
                <pre className={css.code}>{item.current}</pre>
              </div>
              <div>
                <h3 className={css.heading}>{t("chapterMerge.candidate")}</h3>
                <pre className={css.code}>{item.candidate}</pre>
              </div>
            </div>
            <label className={css.inline}>
              {t("chapterMerge.take")}
              <select
                aria-label={t("chapterMerge.choice")}
                className={css.select}
                value={choices[item.id] ?? ""}
                onChange={(event) =>
                  onChoose(item.id, event.target.value as ChapterChoice)
                }
              >
                <option value="" disabled>
                  {t("dialog.choose")}
                </option>
                <option value="current">{t("chapterMerge.keepCurrent")}</option>
                <option value="candidate">
                  {t("chapterMerge.takeCandidate")}
                </option>
                <option value="both">{t("chapterMerge.both")}</option>
              </select>
            </label>
          </section>
        ))}
    </Modal>
  );
}
