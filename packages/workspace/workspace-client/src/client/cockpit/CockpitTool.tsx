import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ToolProps } from "../tools/PersonalTheaterTool.tsx";
import { messageOf, value } from "../tools/remote.ts";
import css from "./Cockpit.module.css";
import {
  deriveProjectCockpit,
  usesAdaptationWorkflow,
  usesNovelWorkflow,
} from "./derive.ts";
import {
  loadAdaptationCockpitEvidence,
  loadDirectScriptCockpitEvidence,
  loadNovelCockpitEvidence,
} from "./evidence.ts";
import { PipelineStepper } from "./PipelineStepper.tsx";
import { isDirectScriptProject } from "./types.ts";

/** The last answer of a read and the failure of the latest one, if any. */
type Polled<T> = { data?: T | undefined; error?: unknown };

/**
 * Read `load` while `key` is set, again every `every` ms after the previous
 * read settles. A failure keeps the last answer and is cleared by the next
 * success; a new key starts over.
 */
function usePolled<T>(
  key: string | undefined,
  load: () => Promise<T>,
  every?: number,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({});
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    setState({});
    if (key === undefined) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () =>
      loader
        .current()
        .then(
          (data) => live && setState({ data }),
          (error: unknown) =>
            live && setState((current) => ({ data: current.data, error })),
        )
        .finally(() => {
          if (live && every) timer = setTimeout(() => void run(), every);
        });
    void run();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, every]);
  return state;
}

/**
 * The project cockpit: the project's stage, its result gates, the one
 * recommended next step, real coverage and blockers, derived from the saved
 * project, its production graph, tasks and the evidence its workflow
 * verifies, which are read again every few seconds while it is open; a
 * missing piece of evidence is never shown as done.
 */
export function CockpitTool(props: ToolProps) {
  const { projectId, t } = props;
  const { workspace, writing, production, automation } = props;
  const base = usePolled(projectId, () =>
    Promise.all([
      value(workspace.projectsGet(projectId)),
      value(writing.chaptersList(projectId)),
    ]),
  );
  const graph = usePolled(projectId, () => value(production.graph(projectId)));
  const tasks = usePolled(
    projectId,
    () => value(automation.tasksList()),
    15_000,
  );
  const plans = usePolled(projectId, () =>
    value(automation.pilotPlansList(projectId)),
  );
  const [project, chapters] = base.data ?? [];
  const novelOnly = Boolean(
    project && graph.data && usesNovelWorkflow(project, graph.data),
  );
  const adaptationOnly = Boolean(
    project && graph.data && usesAdaptationWorkflow(project, graph.data),
  );
  const directOnly = Boolean(project && isDirectScriptProject(project));
  const novel = usePolled(
    novelOnly ? projectId : undefined,
    () => loadNovelCockpitEvidence(props, projectId),
    5000,
  );
  const adaptation = usePolled(
    adaptationOnly ? projectId : undefined,
    () => loadAdaptationCockpitEvidence(props, projectId),
    5000,
  );
  const direct = usePolled(
    directOnly ? projectId : undefined,
    () => loadDirectScriptCockpitEvidence(props, projectId),
    5000,
  );
  const activePilot = plans.data?.find((plan) => plan.status !== "canceled");
  const pilotEpisodes = activePilot?.episodeIds.join(",") ?? "";
  const progress = usePolled(
    project && graph.data && !novelOnly && !adaptationOnly && !directOnly
      ? `${projectId}:${pilotEpisodes}`
      : undefined,
    () =>
      value(
        production.projectsProgress(
          projectId,
          pilotEpisodes ? { episodeIds: pilotEpisodes } : undefined,
        ),
      ),
  );
  const failure = base.error ?? graph.error ?? tasks.error;
  if (failure)
    return (
      <p className={css.failed}>
        {t("cockpit.failed", { message: messageOf(failure) })}
      </p>
    );
  if (!project || !chapters || !graph.data)
    return (
      <section aria-label={t("cockpit.label")} className={css.waiting}>
        {t("cockpit.waiting")}
      </section>
    );
  const cockpit = deriveProjectCockpit({
    project,
    chapters,
    graph: graph.data,
    tasks: tasks.data ?? [],
    novel: novel.error ? undefined : novel.data,
    adaptation: adaptation.error ? undefined : adaptation.data,
    direct: direct.error ? undefined : direct.data,
  });
  const context = new URLSearchParams({ projectId }).toString();
  const zones = [
    { key: "create", to: `/projects/${projectId}` },
    { key: "adapt", to: `/adapt?${context}` },
    { key: "produce", to: `/produce?${context}` },
    { key: "review", to: `/review?${context}` },
  ] as const;
  const nav = (
    <nav aria-label={t("cockpit.zones")} className={css.zones}>
      {zones.map((zone) => (
        <a key={zone.key} className={css.zone} href={`#${zone.to}`}>
          <p className={css.strong}>{t(`cockpit.zone.${zone.key}`)}</p>
          <p className={clsx(css.muted, css.small)}>
            {t(`cockpit.zone.${zone.key}.detail`)}
          </p>
        </a>
      ))}
    </nav>
  );
  const plain = !novelOnly && !adaptationOnly && !directOnly;
  const shown = plain ? progress.data : undefined;
  const percent = shown ? Math.round(shown.completion * 100) : 0;
  const evidenceFailure = (
    enabled: boolean,
    failed: unknown,
    key: "novel" | "adaptation" | "direct",
  ) =>
    enabled &&
    failed !== undefined && (
      <p role="status" className={css.notice}>
        {t(`cockpit.evidence.${key}`, { message: messageOf(failed) })}
      </p>
    );
  return (
    <section aria-label={t("cockpit.label")} className={css.cockpit}>
      <div className={css.head}>
        <div>
          <p className={css.eyebrow}>{t("cockpit.label")}</p>
          <h2 className={css.title}>{cockpit.statusLabel}</h2>
          <p className={css.muted}>{cockpit.recentResult}</p>
        </div>
        <span className={css.badge}>
          {(adaptationOnly || directOnly) && cockpit.status === "delivered"
            ? t("cockpit.badge.delivered")
            : novelOnly && cockpit.status === "ready-for-review"
              ? t("cockpit.badge.continue")
              : t(`cockpit.status.${cockpit.status}`)}
        </span>
      </div>
      {evidenceFailure(novelOnly, novel.error, "novel")}
      {evidenceFailure(adaptationOnly, adaptation.error, "adaptation")}
      {evidenceFailure(directOnly, direct.error, "direct")}
      {cockpit.gates && (
        <PipelineStepper
          label={t(
            novelOnly
              ? "cockpit.gates.novel"
              : directOnly
                ? "cockpit.gates.direct"
                : "cockpit.gates.adaptation",
          )}
          steps={cockpit.gates}
          linkLabel={t(
            novelOnly ? "cockpit.gates.link.novel" : "cockpit.gates.link",
          )}
        />
      )}
      <div className={css.columns}>
        <article aria-label={t("cockpit.next")} className={css.card}>
          <p className={clsx(css.muted, css.small)}>{t("cockpit.next")}</p>
          <p className={css.strong}>{cockpit.primaryAction.label}</p>
          <p className={css.muted}>{cockpit.primaryAction.description}</p>
          <a className={css.primary} href={`#${cockpit.primaryAction.to}`}>
            {cockpit.primaryAction.label}
          </a>
        </article>
        <div className={css.card}>
          <div className={css.between}>
            <p className={clsx(css.muted, css.small)}>
              {t("cockpit.coverage")}
            </p>
            {shown && (
              <span className={clsx(css.muted, css.small, css.numeric)}>
                {shown.scope.kind === "episodes"
                  ? t("cockpit.scope.episodes", {
                      count: shown.scope.episodeIds.length,
                      percent,
                    })
                  : t("cockpit.scope.project", { percent })}
              </span>
            )}
          </div>
          {shown && (
            <div className={css.track}>
              <div className={css.fill} style={{ width: `${percent}%` }} />
            </div>
          )}
          <dl className={css.coverage}>
            {cockpit.coverage.map((item) => (
              <div key={item.label} className={css.cell}>
                <dt className={clsx(css.muted, css.small)}>{item.label}</dt>
                <dd className={css.strong}>
                  {item.required === undefined
                    ? item.current
                    : t("cockpit.coverage.ratio", {
                        current: item.current,
                        required: item.required,
                      })}
                </dd>
              </div>
            ))}
          </dl>
          {cockpit.blockers.length > 0 && (
            <div className={css.blockers}>
              <p className={css.strong}>{t("cockpit.blockers")}</p>
              <ul>
                {cockpit.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {novelOnly ? (
        <details className={css.details}>
          <summary>{t("cockpit.zones.optional")}</summary>
          <p className={clsx(css.muted, css.small)}>
            {t("cockpit.zones.optional.note")}
          </p>
          {nav}
        </details>
      ) : (
        nav
      )}
      {project.mode !== "creator_channel" && (
        <details className={css.details}>
          <summary>{t("cockpit.pilot")}</summary>
          <p className={css.muted}>{t("cockpit.pilot.note")}</p>
          <a
            className={css.outline}
            href={`#/projects/${projectId}/tools/pilot`}
          >
            {t("cockpit.pilot.open")}
          </a>
        </details>
      )}
    </section>
  );
}
