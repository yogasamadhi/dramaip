import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import css from "./CreativePage.module.css";

/** Full component props of the `/create` page. */
export type CreativePageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"quality.section"> &
  PropsLocale<"quality">;

/**
 * The creative analysis page: the project the address names, else the app's
 * active one, and every registered `quality.section` entry for it in order.
 */
export function CreativePage({
  t,
  renderSlot,
  useRoute,
  useProjectScope,
}: CreativePageProps) {
  const query = new URLSearchParams(useRoute().search);
  const scope = useProjectScope();
  const projectId = query.get("projectId") ?? (scope.projectId || undefined);
  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("page.title")}</h1>
        <p className={css.description}>{t("page.description")}</p>
      </header>
      {renderSlot("quality.section", {
        projectId,
        changeSetId: query.get("changeSetId"),
      })}
    </div>
  );
}
