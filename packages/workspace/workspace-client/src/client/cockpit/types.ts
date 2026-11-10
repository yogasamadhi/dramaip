/**
 * The records the project cockpit reads, named by what they are and typed
 * by the Remote methods that answer them.
 */
import type {
  CreationListResult,
  TasksListResult,
} from "@dramaip/automation-automation/types";
import type {
  ManuscriptsListResult,
  PilotPackagesListResult,
} from "@dramaip/production-delivery/types";
import type {
  AdaptationStrategiesListResult,
  DiagnosesListResult,
  DiagnosesSourcesResult,
  EpisodeDevelopmentsListResult,
  EpisodeDevelopmentsSourcesResult,
  GraphResult,
  SeasonPlansListResult,
} from "@dramaip/production-production/types";
import type {
  AuthorIntentsCurrentResult,
  ProjectsGetResult,
} from "@dramaip/workspace-workspace/types";
import type { ChapterMemoriesListResult } from "@dramaip/writing-knowledge/types";
import type {
  ChaptersAdoptionsResult,
  ChaptersListResult,
} from "@dramaip/writing-writing/types";

export type Project = ProjectsGetResult;
export type Chapter = ChaptersListResult[number];
export type ProductionGraph = GraphResult;
export type Task = TasksListResult[number];
export type CreationWorkflow = CreationListResult["items"][number];
export type ChapterAdoption = ChaptersAdoptionsResult["items"][number];
export type DomainEntity = ChapterMemoriesListResult[number];
export type ManuscriptRecord = ManuscriptsListResult["items"][number];
export type AuthorIntentCurrent = AuthorIntentsCurrentResult;
export type DiagnosisCatalog = DiagnosesSourcesResult;
export type AdaptationDiagnosis = DiagnosesListResult["items"][number];
export type SeasonPlan = SeasonPlansListResult["items"][number];
export type AdaptationStrategy =
  AdaptationStrategiesListResult["items"][number];
export type EpisodeDevelopmentResult =
  EpisodeDevelopmentsListResult["items"][number];
export type EpisodeDevelopmentCatalog = EpisodeDevelopmentsSourcesResult;
export type DirectScriptSource = NonNullable<
  EpisodeDevelopmentResult["basis"]["request"]["direct"]
>;
export type PilotPackageRecord = PilotPackagesListResult["items"][number];

/** A single season started from a script or an idea. */
export function isDirectScriptProject(project: {
  modeConfig: Project["modeConfig"];
}): boolean {
  return (
    project.modeConfig.mode === "single_season" &&
    ["script", "inspiration"].includes(project.modeConfig.entryPath)
  );
}
