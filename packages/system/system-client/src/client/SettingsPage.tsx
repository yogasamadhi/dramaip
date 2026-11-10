import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/infra-ui-settings/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type { SettingsSectionRow } from "./sections.ts";
import css from "./SettingsPage.module.css";

/** Injected face: the registered sections, in display order. */
export interface SettingsPageInjected {
  useSections: () => readonly SettingsSectionRow[];
}

/** Full component props of the `/settings` page. */
export type SettingsPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"settings.section"> &
  PropsLocale<"system"> &
  SettingsPageInjected;

/**
 * The settings page: a navigation bar over the labelled sections, then every
 * registered `settings.section` entry under its own anchor. The page owns no
 * section content; each feature registers its own.
 */
export function SettingsPage({
  navigate,
  renderSlot,
  t,
  useSections,
}: SettingsPageProps) {
  const sections = useSections();
  const close = () => navigate("/");
  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("page.title")}</h1>
        <p className={css.description}>{t("page.description")}</p>
      </header>
      <nav className={css.nav} aria-label={t("page.nav")}>
        {sections.flatMap(({ id, label }) =>
          label === undefined
            ? []
            : [
                <Button
                  key={id}
                  onClick={() =>
                    document
                      .getElementById(id)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  {label}
                </Button>,
              ],
        )}
      </nav>
      {sections.map(({ id }) => (
        <div key={id} id={id} className={css.section}>
          {renderSlot("settings.section", { close }, { only: id })}
        </div>
      ))}
    </div>
  );
}
