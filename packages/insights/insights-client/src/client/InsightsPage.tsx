import { useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/insights-insights/remote";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/system-system/remote";
import { FeedbackSection } from "./FeedbackSection.tsx";
import css from "./InsightsPage.module.css";
import type {} from "./contract.ts";

/** Injected face: the `insights` Remote namespace and the file picker's. */
export interface InsightsPageInjected {
  insights: Context["remote"]["insights"];
  system: Context["remote"]["system"];
}

/** Full component props of the `/insights` page. */
export type InsightsPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"insights.section"> &
  PropsLocale<"insights"> &
  InsightsPageInjected;

/**
 * The insights page: the project choice, every registered `insights.section`
 * entry for that project, then the project's feedback imports and clusters.
 * Choosing a cluster to revise hands it to the sections.
 */
export function InsightsPage({
  useProjectScope,
  renderSlot,
  t,
  insights,
  system,
}: InsightsPageProps) {
  const scope = useProjectScope();
  const [revisionClusterId, setRevisionClusterId] = useState<string>();
  const { projectId } = scope;
  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("page.title")}</h1>
        <p className={css.description}>{t("page.description")}</p>
      </header>
      <section className={css.card}>
        <label className={css.field}>
          {t("page.project")}
          <select
            className={css.select}
            value={projectId}
            onChange={(event) => {
              setRevisionClusterId(undefined);
              scope.select(event.target.value);
            }}
          >
            <option value="">{t("page.project.none")}</option>
            {scope.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </section>
      {projectId && (
        <FeedbackSection
          key={projectId}
          projectId={projectId}
          insights={insights}
          system={system}
          t={t}
          onRevise={setRevisionClusterId}
        />
      )}
      {renderSlot("insights.section", { projectId, revisionClusterId })}
    </div>
  );
}
