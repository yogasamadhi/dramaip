import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import css from "./ProducePage.module.css";

/** Full component props of the production page. */
export type ProducePageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"media.produce" | "media.review"> &
  PropsLocale<"media">;

/** The query names that return to one media object awaiting confirmation. */
const REVIEW_RETURNS = [
  "mediaSourceReviewId",
  "audioRevisionId",
  "audioResolutionId",
] as const;

/**
 * The production page frame. A link back to one media object awaiting
 * confirmation shows that object, whose body heads itself inside its own
 * section with the copy it is given; otherwise the page heads the production
 * workbench and lays out the body its `media.produce` slot holds.
 */
export function ProducePage({ t, renderSlot, useRoute }: ProducePageProps) {
  const query = new URLSearchParams(useRoute().search);
  if (REVIEW_RETURNS.some((name) => query.has(name)))
    return (
      <>
        {renderSlot(
          "media.review",
          {
            title: t("review.title"),
            description: t("review.description"),
          },
          { entryKey: "body" },
        )}
      </>
    );
  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("produce.title")}</h1>
        <p className={css.description}>{t("produce.description")}</p>
      </header>
      {renderSlot("media.produce", {}, { entryKey: "body" })}
    </div>
  );
}
