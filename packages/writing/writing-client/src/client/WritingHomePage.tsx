import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type { ProjectsListResult } from "@dramaip/workspace-workspace/types";
import type {} from "@dramaip/workspace-workspace/remote";
import css from "./Writing.module.css";

/** Full component props of the `/write` page. */
export type WritingHomePageProps = PropsRuntime<"studio.route"> &
  PropsLocale<"writing"> & {
    workspace: Context["remote"]["workspace"];
  };

/** A link into the app's router. */
export function RouteLink(props: {
  navigate: (path: string) => void;
  to: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <a
      className={props.className}
      href={props.to}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        props.navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

/** The novel library: every project, to continue writing or start a novel. */
export function WritingHomePage({
  t,
  navigate,
  workspace,
}: WritingHomePageProps) {
  const [projects, setProjects] = useState<ProjectsListResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void workspace.projectsList().then((result) => {
      if (!live) return;
      if (result.ok) setProjects(result.value);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [workspace]);
  return (
    <div className={css.stack}>
      <header className={css.intro}>
        <h1 className={css.introTitle}>{t("home.title")}</h1>
        <p className={css.muted}>{t("home.description")}</p>
      </header>
      <section className={css.card}>
        <div className={css.cardHead}>
          <div>
            <h2 className={css.cardTitle}>{t("home.continue")}</h2>
            <p className={css.muted}>{t("home.continue.description")}</p>
          </div>
          <div className={css.actions}>
            <RouteLink
              navigate={navigate}
              to="/create"
              className={css.secondary}
            >
              {t("home.create")}
            </RouteLink>
            <RouteLink
              navigate={navigate}
              to="/write/new?mode=source"
              className={css.secondary}
            >
              {t("home.import")}
            </RouteLink>
            <RouteLink
              navigate={navigate}
              to="/write/new"
              className={css.primary}
            >
              {t("home.new")}
            </RouteLink>
          </div>
        </div>
        {error !== undefined && (
          <p role="alert" className={css.danger}>
            {t("home.failed", { message: error })}
          </p>
        )}
        {projects === undefined ? (
          error === undefined && (
            <p role="status" className={css.muted}>
              {t("home.loading")}
            </p>
          )
        ) : projects.length > 0 ? (
          <div className={projects.length === 1 ? css.single : css.grid}>
            {projects.map((project) => (
              <RouteLink
                key={project.id}
                navigate={navigate}
                to={`/projects/${project.id}`}
                className={css.project}
              >
                <span className={css.projectHead}>
                  <span className={css.genre}>{project.shortDramaType}</span>
                  <span className={css.small}>
                    {t("home.version", { version: project.version + 1 })}
                  </span>
                </span>
                <h3 className={css.projectTitle}>{project.title}</h3>
                <span className={css.synopsis}>
                  {project.synopsis || t("home.synopsis.empty")}
                </span>
                <span className={css.projectFoot}>
                  <span className={css.small}>
                    {project.targetWordCount
                      ? t("home.target", { count: project.targetWordCount })
                      : t("home.target.empty")}
                  </span>
                  <span className={css.open}>{t("home.open")}</span>
                </span>
              </RouteLink>
            ))}
          </div>
        ) : (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t("home.empty.title")}</p>
            <p className={css.muted}>{t("home.empty.description")}</p>
            <RouteLink
              navigate={navigate}
              to="/write/new"
              className={css.primary}
            >
              {t("home.empty.action")}
            </RouteLink>
          </div>
        )}
      </section>
    </div>
  );
}
