import type { Context } from "@deepseek-ai/cordis";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/automation-automation/remote";
import type {
  ChangePreviewsGetResult,
  CreationGetResult,
  ProviderActionPreviewsGetResult,
  ProviderActionPreviewsSummariesResult,
  RevisionsGetResult,
  RevisionsListResult,
  TasksListResult,
  TasksWorklistResult,
} from "@dramaip/automation-automation/types";
import type {} from "@dramaip/production-delivery/remote";
import type {
  ManuscriptsListResult,
  PilotPackagesListResult,
} from "@dramaip/production-delivery/types";
import type {} from "@dramaip/production-media/remote";
import type {
  AudioRevisionsSummariesResult,
  SourcesSummariesResult,
} from "@dramaip/production-media/types";
import type {} from "@dramaip/production-production/remote";
import type {
  AdaptationStrategiesSummariesResult,
  DiagnosesSummariesResult,
  EpisodeDevelopmentsScriptRevisionSummariesResult,
  EpisodeDevelopmentsSourceRevisionSummariesResult,
  EpisodeDevelopmentsSummariesResult,
  EpisodeDevelopmentsTopologyRevisionSummariesResult,
  SeasonPlansSummariesResult,
} from "@dramaip/production-production/types";
import type {} from "@dramaip/production-timeline/remote";
import type { AudioResolutionsSummariesResult } from "@dramaip/production-timeline/types";
import type {} from "@dramaip/workspace-workspace/remote";
import type {
  AuthorIntentsListResult,
  ImportExtractionsListResult,
  ProjectsGetResult,
  ProjectsListResult,
} from "@dramaip/workspace-workspace/types";
import type {} from "@dramaip/writing-knowledge/remote";
import type {
  NarrativeSummariesSummariesResult,
  StoryAssertionsListResult,
  StoryBibleListResult,
  StoryDeclarationsListResult,
} from "@dramaip/writing-knowledge/types";
import type {} from "@dramaip/writing-quality/remote";
import type {
  NarrativeLocalQualitySummariesResult,
  NarrativeQualitySummariesResult,
} from "@dramaip/writing-quality/types";
import type {} from "@dramaip/writing-writing/remote";

type Remotes = Context["remote"];

/** Copy of the task and pending confirmation centers. */
export type Translate = TranslateNS<"automation">;

/**
 * The Remote namespaces the pending confirmation center reads: every domain
 * that owns a record waiting for the author.
 */
export interface ConfirmationRemotes {
  automation: Remotes["automation"];
  delivery: Remotes["delivery"];
  knowledge: Remotes["knowledge"];
  media: Remotes["media"];
  production: Remotes["production"];
  quality: Remotes["quality"];
  timeline: Remotes["timeline"];
  workspace: Remotes["workspace"];
  writing: Remotes["writing"];
}

/** The Remote namespaces the task center reads and writes. */
export type TaskRemotes = Pick<
  ConfirmationRemotes,
  "automation" | "workspace" | "writing"
>;

export type Project = ProjectsListResult[number];
export type ProjectRecord = ProjectsGetResult;
export type Task = TasksListResult[number];
export type WorklistPage = TasksWorklistResult;
export type CreationWorkflow = CreationGetResult;
export type RevisionPreview = RevisionsGetResult;
export type RevisionSummary = RevisionsListResult["items"][number] & {
  projectId: string;
};
export type ChangePreview = ChangePreviewsGetResult;
export type ProviderActionPreview = ProviderActionPreviewsGetResult;
export type ProviderActionSummary =
  ProviderActionPreviewsSummariesResult["items"][number];
export type StoryBibleChange = StoryBibleListResult[number];
export type ImportExtraction = ImportExtractionsListResult[number];
export type Manuscript = ManuscriptsListResult["items"][number];
export type PilotPackage = PilotPackagesListResult["items"][number];
export type AuthorIntent = AuthorIntentsListResult["items"][number];
export type Diagnosis = DiagnosesSummariesResult["items"][number];
export type SeasonPlan = SeasonPlansSummariesResult["items"][number];
export type AdaptationStrategy =
  AdaptationStrategiesSummariesResult["items"][number];
export type NarrativeReport = NarrativeQualitySummariesResult["items"][number];
export type LocalReview = NarrativeLocalQualitySummariesResult["items"][number];
export type ScriptRevision =
  EpisodeDevelopmentsScriptRevisionSummariesResult["items"][number];
export type TopologyRevision =
  EpisodeDevelopmentsTopologyRevisionSummariesResult["items"][number];
export type SourceRevision =
  EpisodeDevelopmentsSourceRevisionSummariesResult["items"][number];
export type NarrativeSummary =
  NarrativeSummariesSummariesResult["items"][number];
export type EpisodeResult = EpisodeDevelopmentsSummariesResult["items"][number];
export type MediaSourceReview = SourcesSummariesResult["items"][number];
export type AudioRevision = AudioRevisionsSummariesResult["items"][number];
export type AudioResolution = AudioResolutionsSummariesResult["items"][number];
export type StoryDeclaration = StoryDeclarationsListResult["items"][number];
export type StoryAssertion = StoryAssertionsListResult["items"][number];

/**
 * A check of what a Remote answered that failed: the record it named is not
 * the one asked for, or its owner or binding does not match. It carries the
 * copy key of its explanation.
 */
export class MismatchError extends Error {
  constructor(readonly copy: MismatchCopy) {
    super(copy);
  }
}

/** The copy keys a {@link MismatchError} explains itself with. */
export type MismatchCopy = Extract<
  Parameters<Translate>[0],
  `mismatch.${string}`
>;

/**
 * The text a failure is shown with: a mismatch's copy, or the message.
 * @param t - the confirmation copy.
 * @param cause - what was thrown.
 */
export function failureText(t: Translate, cause: unknown): string {
  if (cause instanceof MismatchError) return t(cause.copy);
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * An object's fields, or none when it is not an object.
 * @param value - anything.
 */
export function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A read whose failure carries its shown text, for a poll that keeps only a
 * failure's message.
 * @param t - the confirmation copy.
 * @param read - the read.
 */
export function explained<T>(
  t: Translate,
  read: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    try {
      return await read();
    } catch (cause) {
      throw new Error(failureText(t, cause));
    }
  };
}
