import { useQuery } from "../../query";
import { useEffect, useState } from "react";
import { useStudio } from "../../studio-shared";
import { useStudioSession } from "../../studio-session";

/** The project an insights page reads, kept in step with the app's session. */
export interface ProjectScope {
  /** The projects to choose from, in the app's order. */
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  /** The chosen project; empty when none is chosen. */
  readonly projectId: string;
  /** Choose a project (empty clears the choice) and make it the active one. */
  select(projectId: string): void;
}

/**
 * The project scope of a page the insights client took over: the app's
 * project list and its active project, which follows the session.
 */
export function useProjectScope(): ProjectScope {
  const client = useStudio();
  const session = useStudioSession();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(
    () => session.activeProjectId ?? "",
  );
  useEffect(() => {
    if (session.activeProjectId && projectId !== session.activeProjectId)
      setProjectId(session.activeProjectId);
  }, [projectId, session.activeProjectId]);
  return {
    projects,
    projectId,
    select: (next) => {
      setProjectId(next);
      if (next) session.selectProject(next);
    },
  };
}
