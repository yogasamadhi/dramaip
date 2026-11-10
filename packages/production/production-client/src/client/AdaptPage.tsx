import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";

/** Full component props of the adaptation page. */
export type AdaptPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"production.adapt"> &
  PropsLocale<"production">;

/**
 * The adaptation page frame. The workbench its `production.adapt` slot holds
 * heads itself, inside its own section, with the copy given here for the
 * kind of project it opens.
 */
export function AdaptPage({ t, renderSlot }: AdaptPageProps) {
  return (
    <>
      {renderSlot(
        "production.adapt",
        {
          intro: {
            story: {
              title: t("intro.story.title"),
              description: t("intro.story.description"),
            },
            script: {
              title: t("intro.script.title"),
              description: t("intro.script.description"),
            },
          },
        },
        { entryKey: "body" },
      )}
    </>
  );
}
