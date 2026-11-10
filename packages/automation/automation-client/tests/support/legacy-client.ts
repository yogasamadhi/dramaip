import {
  deriveConfirmations,
  type ConfirmationSources,
} from "../../src/client/confirmations/derive.ts";
import { loadConfirmations } from "../../src/client/confirmations/load.ts";
import type { ConfirmationRemotes } from "../../src/client/confirmations/remote.ts";
import { failed, ok, shown, t } from "./confirmations.ts";

type Answer = Promise<unknown>;
type Paged = (projectId: string, cursor?: string, limit?: number) => Answer;
type Listed = (
  projectId: string,
  query?: { cursor?: string | undefined; limit?: number | undefined },
) => Answer;

/**
 * The confirmation sources in the shape of the old studio client: one
 * namespace per record, positional cursors, and a missing namespace for a
 * capability the Host lacks. The fixtures keep this shape; `remotesFrom`
 * answers through the Remote namespaces the center actually reads.
 */
export interface LegacyClient {
  projects: { list: () => Answer };
  tasks: { list: () => Answer };
  creation: {
    list: (projectId: string, status?: string, cursor?: string) => Answer;
  };
  storyBible: { list: (projectId: string) => Answer };
  importExtractions: { list: (projectId: string) => Answer };
  manuscripts: { list: Paged };
  revisions: { list: Paged };
  authorIntents: { list: Paged };
  providerActionPreviews?: { summaries: Paged } | undefined;
  pilotPackages?: { list: Paged } | undefined;
  episodeDevelopments?:
    | {
        summaries?: Paged | undefined;
        scriptRevisionSummaries?: Paged | undefined;
        topologyRevisionSummaries?: Paged | undefined;
        sourceRevisionSummaries?: Paged | undefined;
      }
    | undefined;
  narrativeQuality?:
    | { summaries?: Paged | undefined; localSummaries?: Paged | undefined }
    | undefined;
  narrativeSummaries?: { summaries: Paged } | undefined;
  diagnoses?: { summaries: Paged } | undefined;
  seasonPlans?: { summaries: Paged } | undefined;
  adaptationStrategies?: { summaries: Paged } | undefined;
  mediaSources?: { summaries: Paged } | undefined;
  audioRevisions?: { summaries: Paged } | undefined;
  audioResolutions?: { summaries: Paged } | undefined;
  storyDeclarations?: { list: Listed } | undefined;
  storyAssertions?: { list: Listed } | undefined;
}

type Query = { cursor?: string; limit?: number | string } | undefined;

/**
 * The answer of one call: missing capability and rejection both fail.
 * @param call - the old client's call, absent when the capability is.
 */
function answer(call: (() => Answer) | undefined) {
  if (!call) return failed("capability unavailable");
  return call().then(ok, (cause: unknown) =>
    failed(cause instanceof Error ? cause.message : String(cause)),
  );
}

const limitOf = (query: Query) =>
  query?.limit === undefined ? undefined : Number(query.limit);

/**
 * The Remote namespaces the center reads, answered by an old-shape client.
 * @param client - the fixture client.
 */
export function remotesFrom(client: LegacyClient): ConfirmationRemotes {
  const paged =
    (read: Paged | undefined, limited = true) =>
    (id: string, query?: Query) =>
      answer(
        read &&
          (() =>
            limited
              ? read(id, query?.cursor, limitOf(query))
              : read(id, query?.cursor)),
      );
  const episodes = client.episodeDevelopments;
  return {
    workspace: {
      projectsList: () => answer(() => client.projects.list()),
      importExtractionsList: (id: string) =>
        answer(() => client.importExtractions.list(id)),
      authorIntentsList: paged(client.authorIntents.list, false),
    },
    automation: {
      tasksList: () => answer(() => client.tasks.list()),
      creationList: (query: { projectId: string; cursor?: string }) =>
        answer(() =>
          client.creation.list(query.projectId, undefined, query.cursor),
        ),
      revisionsList: paged(client.revisions.list, false),
      providerActionPreviewsSummaries: paged(
        client.providerActionPreviews?.summaries,
      ),
    },
    delivery: {
      manuscriptsList: paged(client.manuscripts.list, false),
      pilotPackagesList: paged(client.pilotPackages?.list),
    },
    knowledge: {
      storyBibleList: (id: string) => answer(() => client.storyBible.list(id)),
      storyDeclarationsList: (id: string, query?: Query) =>
        answer(
          client.storyDeclarations &&
            (() =>
              client.storyDeclarations!.list(id, {
                cursor: query?.cursor,
                limit: limitOf(query),
              })),
        ),
      storyAssertionsList: (id: string, query?: Query) =>
        answer(
          client.storyAssertions &&
            (() =>
              client.storyAssertions!.list(id, {
                cursor: query?.cursor,
                limit: limitOf(query),
              })),
        ),
      narrativeSummariesSummaries: paged(client.narrativeSummaries?.summaries),
    },
    production: {
      episodeDevelopmentsSummaries: paged(episodes?.summaries),
      episodeDevelopmentsSourceRevisionSummaries: paged(
        episodes?.sourceRevisionSummaries,
        false,
      ),
      episodeDevelopmentsTopologyRevisionSummaries: paged(
        episodes?.topologyRevisionSummaries,
        false,
      ),
      episodeDevelopmentsScriptRevisionSummaries: paged(
        episodes?.scriptRevisionSummaries,
        false,
      ),
      diagnosesSummaries: paged(client.diagnoses?.summaries, false),
      seasonPlansSummaries: paged(client.seasonPlans?.summaries, false),
      adaptationStrategiesSummaries: paged(
        client.adaptationStrategies?.summaries,
        false,
      ),
    },
    media: {
      sourcesSummaries: paged(client.mediaSources?.summaries),
      audioRevisionsSummaries: paged(client.audioRevisions?.summaries),
    },
    timeline: {
      audioResolutionsSummaries: paged(client.audioResolutions?.summaries),
    },
    quality: {
      narrativeQualitySummaries: paged(client.narrativeQuality?.summaries),
      narrativeLocalQualitySummaries: paged(
        client.narrativeQuality?.localSummaries,
      ),
    },
  } as unknown as ConfirmationRemotes;
}

/**
 * Load the center's evidence through an old-shape client; a failure of the
 * whole read rejects with the text it is shown with.
 * @param client - the fixture client.
 * @param projectId - the one project, or all of them.
 */
export const load = (client: LegacyClient, projectId?: string) =>
  shown(loadConfirmations(remotesFrom(client), projectId, t));

const NONE: Omit<ConfirmationSources, "projects" | "tasks"> = {
  workflows: [],
  storyBible: [],
  imports: [],
  manuscripts: [],
  providerActions: [],
  pilotPackages: [],
  revisions: [],
  authorIntents: [],
  diagnoses: [],
  seasonPlans: [],
  adaptationStrategies: [],
  narrativeReports: [],
  localReviews: [],
  scriptRevisions: [],
  topologyRevisions: [],
  sourceRevisions: [],
  narrativeSummaries: [],
  episodeResults: [],
  mediaSourceReviews: [],
  audioRevisions: [],
  audioResolutions: [],
  storyDeclarations: [],
  storyAssertions: [],
};

/**
 * Derive the items from the sources given; the others are empty.
 * @param input - the projects, tasks and any other sources.
 */
export const derive = (
  input: Pick<ConfirmationSources, "projects" | "tasks"> &
    Partial<ConfirmationSources>,
) => deriveConfirmations({ ...NONE, ...input }, t);
