/**
 * The shapes the project progress operation declares.
 *
 * @module @dramaip/production-production/wire/project-progress
 */

/** Query of `production/projectsProgress` (`projects.progress`). */
export type ProjectsProgressQuery = {
  episodeIds?: string;
};

/** Answer of `production/projectsProgress` (`projects.progress`). */
export type ProjectsProgressResult = {
  projectId: string;
  scope: {
    kind: "project" | "episodes";
    episodeIds: string[];
  };
  sourceVersion: number;
  completion: number;
  steps: {
    id: "source" | "script" | "scenes" | "shots" | "assets" | "review";
    label: string;
    current: number;
    required: number;
    complete: boolean;
    target: string;
  }[];
  blockers: {
    code: string;
    message: string;
    target: string;
  }[];
  nextAction: {
    label: string;
    target: string;
  };
};
