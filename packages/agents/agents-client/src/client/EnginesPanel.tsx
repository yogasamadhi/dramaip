import { useEffect, useState } from "react";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import {
  messageOf,
  value,
  type AgentsRemote,
  type EngineRow,
  type EngineSettings,
  type WorkspaceRemote,
} from "./ai-settings.ts";
import { usePolled } from "./polled.ts";
import css from "./AiSection.module.css";

type Translate = TranslateNS<"agents">;

/** Props of the agent engines panel. */
export interface EnginesPanelProps {
  t: Translate;
  agents: AgentsRemote;
  workspace: WorkspaceRemote;
  /** Changes whenever an activation may have changed the engines. */
  revision: number;
}

/** The agent engines, their status and global and project defaults. */
export function EnginesPanel(props: EnginesPanelProps) {
  const { t, agents, workspace } = props;
  const engines = usePolled(
    () => value<EngineRow[]>(agents.enginesList()),
    5_000,
    props.revision,
  );
  const [global, setGlobal] = useState<EngineSettings>();
  const [projects, setProjects] = useState<
    readonly { id: string; title: string }[]
  >([]);
  const [projectId, setProjectId] = useState("");
  const [globalModel, setGlobalModel] = useState("");
  const [projectModel, setProjectModel] = useState("");
  const [pending, setPending] = useState<"global" | "project">();
  const [notice, setNotice] = useState<string>();
  const rows = engines.value ?? [];

  useEffect(() => {
    let live = true;
    void value<EngineSettings>(agents.enginesGetGlobalSettings()).then(
      (settings) => {
        if (!live) return;
        setGlobal(settings);
        setGlobalModel(settings.defaultModel?.modelId ?? "");
      },
      () => undefined,
    );
    void workspace.projectsList().then((result) => {
      if (live && result.ok)
        setProjects(
          result.value.map(({ id, title }) => ({ id, title: String(title) })),
        );
    });
    return () => {
      live = false;
    };
  }, [agents, workspace]);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void value<EngineSettings>(
      agents.enginesGetProjectSettings(projectId),
    ).then(
      (settings) => {
        if (!live) return;
        setProjectModel(settings.defaultModel?.modelId ?? "");
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agents, projectId]);

  const nameOf = (kind: EngineSettings["defaultEngineKind"] | undefined) =>
    rows.find((engine) => engine.kind === kind)?.name ?? kind ?? "";
  const settingsOf = (model: string) => ({
    defaultEngineKind: "pi" as const,
    ...(model.trim() ? { defaultModel: { modelId: model.trim() } } : {}),
  });

  const run = async (
    step: NonNullable<typeof pending>,
    work: () => Promise<string>,
  ) => {
    setPending(step);
    try {
      setNotice(await work());
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setPending(undefined);
    }
  };

  const saveGlobal = () =>
    run("global", async () => {
      setGlobal(
        await value<EngineSettings>(
          agents.enginesUpdateGlobalSettings(
            settingsOf(globalModel),
            undefined,
            crypto.randomUUID(),
          ),
        ),
      );
      engines.refresh();
      return t("engines.savedGlobal");
    });

  const saveProject = () =>
    run("project", async () => {
      await value(
        agents.enginesUpdateProjectSettings(
          projectId,
          settingsOf(projectModel),
          undefined,
          crypto.randomUUID(),
        ),
      );
      return t("engines.savedProject");
    });

  return (
    <section className={css.card}>
      <div className={css.head}>
        <div>
          <p className={css.eyebrow}>{t("engines.step")}</p>
          <h2 className={css.title}>{t("engines.title")}</h2>
          <p className={css.small}>{t("engines.description")}</p>
        </div>
        <span className={css.badge}>
          {t("engines.globalBadge", {
            name: nameOf(global?.defaultEngineKind ?? "pi"),
          })}
        </span>
      </div>
      <div aria-label={t("engines.status")} className={css.engineStatus}>
        {rows.map((engine) => (
          <article key={engine.kind} className={css.engine}>
            <div className={css.head}>
              <p className={css.strong}>{engine.name}</p>
            </div>
            <p className={css.small}>
              {t("engines.version", { version: engine.version })}
            </p>
            <p
              className={engine.status === "available" ? css.success : css.warn}
            >
              {t(
                engine.status === "available"
                  ? "engines.available"
                  : engine.status === "degraded"
                    ? "engines.degraded"
                    : "engines.unavailable",
              )}
            </p>
            <p className={css.small}>{engine.statusMessage}</p>
          </article>
        ))}
      </div>
      <div className={css.gridGlobal}>
        <label className={css.field}>
          {t("engines.globalModel")}
          <input
            className={css.control}
            placeholder={t("engines.globalModel.placeholder")}
            value={globalModel}
            onChange={(event) => setGlobalModel(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          className={css.end}
          disabled={pending === "global"}
          onClick={() => void saveGlobal()}
        >
          {t(pending === "global" ? "ai.saving" : "engines.saveGlobal")}
        </Button>
      </div>
      <div className={css.gridProject}>
        <label className={css.field}>
          {t("engines.project")}
          <select
            className={css.control}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">{t("engines.project.none")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          {t("engines.projectModel")}
          <input
            className={css.control}
            placeholder={t("engines.projectModel.placeholder")}
            value={projectModel}
            onChange={(event) => setProjectModel(event.target.value)}
          />
        </label>
        <Button
          variant="primary"
          className={css.end}
          disabled={!projectId || pending === "project"}
          onClick={() => void saveProject()}
        >
          {t(pending === "project" ? "ai.saving" : "engines.saveProject")}
        </Button>
      </div>
      {notice && <p className={css.notice}>{notice}</p>}
    </section>
  );
}
