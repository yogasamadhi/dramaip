import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import css from "./AutomationPage.module.css";
import type { SystemRemote } from "./creation/events.ts";
import { PendingCenter } from "./confirmations/PendingCenter.tsx";
import type { ConfirmationRemotes } from "./confirmations/remote.ts";
import { TaskCenter } from "./confirmations/TaskCenter.tsx";

/** The automation pages: the task and pending confirmation centers. */
export type AutomationPageKey = "tasks" | "pending";

/** The Remote namespaces the pages read and write. */
export type AutomationPageRemotes = ConfirmationRemotes & {
  system: SystemRemote;
};

/** Full component props of an automation page. */
export type AutomationPageProps = PropsRuntime<"studio.route"> &
  PropsRenderFactories &
  PropsLocale<"automation"> &
  AutomationPageRemotes;

/**
 * The page frame of one automation page: its heading, then its center. The
 * pending confirmation center says whether it shows one project or all.
 * @param page - The page.
 */
export function automationPage(page: AutomationPageKey) {
  return function AutomationPage(props: AutomationPageProps) {
    const {
      t,
      useRoute,
      useProjectScope,
      useAssistantIntent,
      navigate,
      renderFactorySlot,
    } = props;
    const { search } = useRoute();
    const scope = useProjectScope();
    const intent = useAssistantIntent();
    const projectId = new URLSearchParams(search).get("projectId");
    const description =
      page === "tasks"
        ? t("tasks.description")
        : t(
            projectId
              ? "pending.description.project"
              : "pending.description.all",
          );
    const remotes: ConfirmationRemotes = {
      automation: props.automation,
      delivery: props.delivery,
      knowledge: props.knowledge,
      media: props.media,
      production: props.production,
      quality: props.quality,
      timeline: props.timeline,
      workspace: props.workspace,
      writing: props.writing,
    };
    return (
      <div className={css.page}>
        <header className={css.header}>
          <h1 className={css.title}>{t(`${page}.title`)}</h1>
          <p className={css.description}>{description}</p>
        </header>
        {page === "tasks" ? (
          <TaskCenter
            context={{ remotes, system: props.system, t, renderFactorySlot }}
            search={search}
            scope={scope}
            intent={intent}
          />
        ) : (
          <PendingCenter
            remotes={remotes}
            system={props.system}
            t={t}
            search={search}
            navigate={navigate}
          />
        )}
      </div>
    );
  };
}
