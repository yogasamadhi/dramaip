import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/infra-ui-settings/client";
import css from "./AppearanceSection.module.css";

/** Full component props of the appearance settings section. */
export type AppearanceSectionProps = PropsRuntime<"settings.section"> &
  PropsRenderSlots<"settings.general.item"> &
  PropsLocale<"system">;

/**
 * The appearance section: it stacks the `settings.general.item` rows the
 * owning features register (the theme, the fonts, the interface language)
 * and draws none of their content.
 */
export function AppearanceSection({ renderSlot, t }: AppearanceSectionProps) {
  return (
    <section className={css.card}>
      <div>
        <h2 className={css.title}>{t("appearance.title")}</h2>
        <p className={css.muted}>{t("appearance.description")}</p>
      </div>
      <div className={css.rows}>{renderSlot("settings.general.item", {})}</div>
    </section>
  );
}
