import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {
  LegacyProjectMode,
  LegacyProjectRecord,
} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/workspace-workspace/remote";
import css from "./ProjectToolsPage.module.css";

/** The project tools, in the order the overview lists them. */
export const PROJECT_TOOLS = [
  "quality-review",
  "episode-development",
  "season-plan",
  "adaptation-diagnosis",
  "adaptation-strategy",
  "author-intent",
  "import",
  "review",
  "cockpit",
  "pilot",
  "series",
  "personal-theater",
  "creator-channel",
] as const;

export type ProjectTool = (typeof PROJECT_TOOLS)[number];

/** The tools each project mode offers. */
const MODE_TOOLS: Record<LegacyProjectMode, readonly ProjectTool[]> = {
  series_longform: [
    "quality-review",
    "episode-development",
    "season-plan",
    "adaptation-diagnosis",
    "adaptation-strategy",
    "author-intent",
    "import",
    "review",
    "cockpit",
    "pilot",
    "series",
  ],
  single_season: [
    "quality-review",
    "episode-development",
    "season-plan",
    "adaptation-diagnosis",
    "adaptation-strategy",
    "author-intent",
    "import",
    "review",
    "cockpit",
    "pilot",
  ],
  personal_theater: ["personal-theater", "cockpit", "pilot", "review"],
  creator_channel: ["creator-channel", "cockpit", "review"],
};

/**
 * The tools a mode offers, in the overview's order.
 * @param mode - the project's mode.
 */
export function modeTools(mode: LegacyProjectMode): ProjectTool[] {
  return PROJECT_TOOLS.filter((tool) => MODE_TOOLS[mode].includes(tool));
}

/** Full component props of the `/projects/:projectId/tools` page. */
export type ProjectToolsPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"workspace.tool"> &
  PropsLocale<"workspace"> & {
    workspace: Context["remote"]["workspace"];
  };

/** A link into the app's router. */
function RouteLink(props: {
  navigate: (path: string) => void;
  to: string;
  className?: string | undefined;
  current?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <a
      className={props.className}
      href={props.to}
      aria-current={props.current ? "page" : undefined}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        props.navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

/**
 * The project tools page: reads the project the address names, offers the
 * tools of its mode, and lays out the chosen tool's `workspace.tool` entry,
 * or an overview with each tool's state and the one recommended next step.
 */
export function ProjectToolsPage(props: ProjectToolsPageProps) {
  const { t } = props;
  const { params, search } = props.useRoute();
  const projectId = params.projectId ?? "";
  const record = props.useProjectRecord(projectId);
  if (record.status !== "ready" || record.project === undefined)
    return record.status === "failed" ? (
      <div role="alert" className={css.failed}>
        {t("tools.failed", { message: record.error ?? "" })}
      </div>
    ) : (
      <div role="status" className={css.loading}>
        {t("tools.loading")}
      </div>
    );
  return (
    <ProjectTools
      {...props}
      record={record}
      project={record.project}
      search={search}
      tool={params.toolKey}
    />
  );
}

function ProjectTools(
  props: ProjectToolsPageProps & {
    record: LegacyProjectRecord;
    project: NonNullable<LegacyProjectRecord["project"]>;
    search: string;
    tool: string | undefined;
  },
) {
  const { t, navigate, renderSlot, workspace, project, record } = props;
  const tools = modeTools(project.mode);
  const active = tools.find((tool) => tool === props.tool);
  const scriptOnly = project.directScript && record.chapterCount === 0;
  const written = record.chapterCount > 0 || scriptOnly;
  const pendingReviews = usePendingReviews(
    workspace,
    active === undefined ? project.id : undefined,
  );
  const next: ProjectTool = pendingReviews
    ? "review"
    : project.mode === "personal_theater"
      ? "personal-theater"
      : project.mode === "creator_channel"
        ? "creator-channel"
        : written
          ? "cockpit"
          : "import";
  const state = (tool: ProjectTool) => {
    if (tool === "author-intent" || tool === "quality-review")
      return { label: t("tools.state.adopted"), count: 0 };
    if (tool === "review")
      return {
        label: t(
          pendingReviews
            ? "tools.state.review.pending"
            : "tools.state.review.none",
        ),
        count: pendingReviews,
      };
    if (tool === "import")
      return { label: t("tools.state.anytime"), count: written ? 0 : 1 };
    if (tool === "pilot")
      return {
        label: t(
          scriptOnly
            ? "tools.state.pilot.script"
            : record.chapterCount
              ? "tools.state.pilot.ready"
              : "tools.state.waiting",
        ),
        count: written ? 0 : 1,
      };
    return {
      label: t(
        scriptOnly
          ? "tools.state.script"
          : record.chapterCount
            ? "tools.state.ready"
            : "tools.state.waiting",
      ),
      count: 0,
    };
  };
  const base = `/projects/${project.id}/tools`;
  return (
    <div className={css.page}>
      <header className={css.header}>
        <button
          type="button"
          className={css.back}
          onClick={() => navigate(`/projects/${project.id}`)}
        >
          {t(scriptOnly ? "tools.back.script" : "tools.back.writing")}
        </button>
        <div className={css.heading}>
          <p className={css.project}>{project.title}</p>
          <h1 className={css.title}>
            {active ? t(`tool.${active}`) : t("tools.title")}
          </h1>
        </div>
        <nav aria-label={t("tools.nav")} className={css.nav}>
          <RouteLink
            navigate={navigate}
            to={base}
            className={css.navLink}
            current={active === undefined}
          >
            {t("tools.overview")}
          </RouteLink>
          {tools.map((tool) => (
            <RouteLink
              key={tool}
              navigate={navigate}
              to={`${base}/${tool}`}
              className={css.navLink}
              current={active === tool}
            >
              {t(`tool.${tool}`)}
            </RouteLink>
          ))}
        </nav>
      </header>
      <div className={css.body}>
        <div className={css.content}>
          {record.error !== undefined && (
            <p role="alert" className={css.notice}>
              {record.error}
            </p>
          )}
          {active === undefined ? (
            <section>
              <p className={css.eyebrow}>{t("tools.eyebrow")}</p>
              <h2 className={css.overviewTitle}>{t("tools.title")}</h2>
              <p className={css.muted}>{t("tools.intro")}</p>
              <RouteLink
                navigate={navigate}
                to={`${base}/${next}`}
                className={css.next}
              >
                <span className={css.nextText}>
                  <span className={css.nextLabel}>{t("tools.next")}</span>
                  <span className={css.nextTitle}>{t(`tool.${next}`)}</span>
                </span>
                <span className={css.nextGo}>{t("tools.next.go")}</span>
              </RouteLink>
              <div className={css.list}>
                {tools.map((tool) => (
                  <RouteLink
                    key={tool}
                    navigate={navigate}
                    to={`${base}/${tool}`}
                    className={css.row}
                  >
                    <span className={css.rowTitle}>{t(`tool.${tool}`)}</span>
                    <span className={css.rowState}>{state(tool).label}</span>
                    <span className={css.rowCount}>
                      {t("tools.pending", { count: state(tool).count })}
                    </span>
                    <span className={css.rowOpen}>{t("tools.open")}</span>
                  </RouteLink>
                ))}
              </div>
            </section>
          ) : (
            renderSlot(
              "workspace.tool",
              {
                projectId: project.id,
                record: record.record,
                search: props.search,
                reload: record.reload,
                navigate,
              },
              { entryKey: active },
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The number of draft candidates the project's import extractions hold; 0
 * while they are read, when the read fails, or with no project given.
 */
function usePendingReviews(
  workspace: Context["remote"]["workspace"],
  projectId: string | undefined,
): number {
  const [pending, setPending] = useState<{
    projectId: string;
    count: number;
  }>();
  useEffect(() => {
    if (projectId === undefined) return;
    let live = true;
    void workspace.importExtractionsList(projectId).then((result) => {
      if (!live || !result.ok) return;
      setPending({
        projectId,
        count: result.value.reduce(
          (total, item) =>
            total +
            item.candidates.filter((candidate) => candidate.status === "draft")
              .length,
          0,
        ),
      });
    });
    return () => {
      live = false;
    };
  }, [workspace, projectId]);
  return pending !== undefined && pending.projectId === projectId
    ? pending.count
    : 0;
}
