import type { Chapter, Project } from "@dramaip/contracts/product";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "./router";
import { episodeDevelopmentReferenceKey } from "./episode-development-navigation";
import { exactObjectReferenceKey } from "./exact-object-navigation";
import { NarrativeQualityPanel } from "./features/creative/NarrativeQualityPanel";
import { EpisodeDevelopmentPanel } from "./features/production/EpisodeDevelopmentPanel";
import { isDirectScriptProject } from "./project-intake";
import { message, useStudio } from "./studio-shared";

/** The project and chapters a project tool body works on. */
export interface ProjectToolRecord {
  readonly project: Project;
  readonly chapters: Chapter[];
  /** Read the project and its chapters again. */
  reload(): Promise<void>;
  /** Take a project a tool changed, while it is still the page's project. */
  replaceProject(project: Project): void;
}

/** The route the page renders under, as the owner share offers it. */
export function useRoute() {
  const params = useParams();
  const location = useLocation();
  return { params, search: location.search };
}

/**
 * Read one project and its chapters, read them again when the project
 * changes, and never show another project's read for it.
 * @param projectId - the project the route names.
 */
export function useProjectRecord(projectId: string) {
  const client = useStudio();
  const [loaded, setLoaded] = useState<{
    project: Project;
    chapters: Chapter[];
  }>();
  const [readError, setReadError] = useState<{
    projectId: string;
    detail: string;
  }>();
  const requestedProject = useRef(projectId);
  requestedProject.current = projectId;
  const readRevision = useRef(0);
  const project =
    loaded && loaded.project.id === projectId ? loaded.project : undefined;
  const chapters = project ? loaded!.chapters : [];
  const error =
    readError && readError.projectId === projectId
      ? readError.detail
      : undefined;
  const load = async (): Promise<void> => {
    if (!projectId) return;
    const revision = ++readRevision.current;
    setReadError(undefined);
    try {
      const [nextProject, nextChapters] = await Promise.all([
        client.projects.get(projectId),
        client.chapters.list(projectId),
      ]);
      if (
        requestedProject.current !== projectId ||
        readRevision.current !== revision
      )
        return;
      if (
        nextProject.id !== projectId ||
        nextChapters.some((chapter) => chapter.projectId !== projectId)
      )
        throw new Error("项目工具读取归属不一致，未替换为其他项目。");
      setLoaded({ project: nextProject, chapters: nextChapters });
    } catch (cause) {
      if (
        requestedProject.current === projectId &&
        readRevision.current === revision
      )
        setReadError({ projectId, detail: message(cause) });
    }
  };
  useEffect(() => void load(), [client, projectId]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("workspace.project-") &&
          event.payload &&
          typeof event.payload === "object" &&
          (event.payload as { id?: string }).id === projectId
        )
          void load();
      }),
    [client, projectId],
  );
  const record: ProjectToolRecord | undefined = project && {
    project,
    chapters,
    reload: load,
    replaceProject: (nextProject) =>
      setLoaded((current) =>
        current &&
        current.project.id === nextProject.id &&
        requestedProject.current === nextProject.id
          ? { ...current, project: nextProject }
          : current,
      ),
  };
  return {
    status: project ? "ready" : error ? "failed" : "loading",
    ...(error === undefined ? {} : { error }),
    ...(project
      ? {
          project: {
            id: project.id,
            title: project.title,
            mode: project.mode,
            directScript: isDirectScriptProject(project),
          },
        }
      : {}),
    chapterCount: chapters.length,
    reload: load,
    record: record ?? {},
  } as const;
}

/** The project tools whose bodies the app still renders. */
export const PROJECT_TOOL_KEYS = [
  "episode-development",
  "quality-review",
] as const;

export type ProjectToolBodyKey = (typeof PROJECT_TOOL_KEYS)[number];

/**
 * The body of one project tool.
 * @param props.tool - the tool.
 * @param props.record - the page's project record.
 */
export function ProjectToolBody(props: {
  tool: ProjectToolBodyKey;
  record: ProjectToolRecord;
}) {
  const location = useLocation();
  const { project } = props.record;
  const exactKey = `${project.id}:${exactObjectReferenceKey(location.search)}`;
  switch (props.tool) {
    case "quality-review":
      return <NarrativeQualityPanel key={exactKey} projectId={project.id} />;
    case "episode-development":
      return (
        <EpisodeDevelopmentPanel
          key={`${project.id}:${episodeDevelopmentReferenceKey(location.search)}`}
          projectId={project.id}
        />
      );
  }
}
