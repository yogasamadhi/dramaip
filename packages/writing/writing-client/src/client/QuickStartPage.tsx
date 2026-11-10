import { Button, Input } from "@dramaip/infra-ui-primitives";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import { RouteLink } from "./WritingHomePage.tsx";
import css from "./Writing.module.css";

/** Full component props of the `/write/new` page. */
export type QuickStartPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"writing.preset"> &
  PropsLocale<"writing">;

const MODES = ["inspiration", "source"] as const;

/**
 * The novel quick start: a title, an optional idea, a story preset or a
 * genre, and the project is created and opened. The draft stays in the
 * app's creation session until the project exists.
 */
export function QuickStartPage(props: QuickStartPageProps) {
  const { t, navigate, renderSlot } = props;
  const start = props.useNovelQuickStart();
  return (
    <div className={css.narrow}>
      <span>
        <Button variant="ghost" size="sm" onClick={() => navigate("/write")}>
          {t("start.back")}
        </Button>
      </span>
      <section className={css.card}>
        <p className={css.eyebrow}>{t("start.eyebrow")}</p>
        <h1 className={css.pageTitle}>{t("start.title")}</h1>
        <p className={css.muted}>{t("start.description")}</p>
        {start.conflict ? (
          <div role="status" className={css.warning}>
            <p className={css.noticeText}>{t("start.conflict")}</p>
            <span className={css.actions}>
              <RouteLink navigate={navigate} to="/" className={css.secondary}>
                {t("start.conflict.continue")}
              </RouteLink>
              <Button
                variant="ghost"
                size="sm"
                onClick={start.replaceOtherDraft}
              >
                {t("start.conflict.replace")}
              </Button>
            </span>
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label={t("start.mode")}
              className={css.modes}
            >
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={start.mode === mode}
                  className={start.mode === mode ? css.modeOn : css.mode}
                  onClick={() => start.setMode(mode)}
                >
                  {t(`start.mode.${mode}`)}
                </button>
              ))}
            </div>
            <div className={css.fields}>
              <label className={css.field}>
                {t("start.name")}
                <Input
                  autoFocus
                  aria-label={t("start.name")}
                  value={start.title}
                  placeholder={t("start.name.placeholder")}
                  onChange={(event) => start.setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey)
                      start.create();
                  }}
                />
              </label>
              <label className={css.field}>
                {t("start.idea")}
                <textarea
                  className={css.textarea}
                  aria-label={t("start.idea.label")}
                  value={start.idea}
                  placeholder={t("start.idea.placeholder")}
                  onChange={(event) => start.setIdea(event.target.value)}
                />
              </label>
              {start.mode === "inspiration" &&
                renderSlot(
                  "writing.preset",
                  { record: start.record },
                  { entryKey: "picker" },
                )}
              <fieldset className={css.fieldset}>
                <legend className={css.legend}>{t("start.genre")}</legend>
                <div className={css.chips}>
                  {start.genres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      aria-pressed={start.genre === genre}
                      className={start.genre === genre ? css.chipOn : css.chip}
                      onClick={() => start.setGenre(genre)}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            {start.mode === "source" && (
              <p className={css.note}>{t("start.source.note")}</p>
            )}
            {start.error !== undefined && (
              <p role="alert" className={css.danger}>
                {start.error}
              </p>
            )}
            <div className={css.submit}>
              <Button
                variant="primary"
                disabled={start.saving || !start.title.trim()}
                onClick={start.create}
              >
                {start.saving
                  ? t("start.saving")
                  : t(
                      start.mode === "source"
                        ? "start.submit.source"
                        : "start.submit.inspiration",
                    )}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
