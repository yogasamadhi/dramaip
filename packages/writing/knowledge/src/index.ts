/**
 * Host face of the knowledge domain. It owns the `knowledge` Remote namespace:
 * the story bible and its settings, chapter memories, character states, story events and graph, foreshadowing, narrative indexes and summaries, research, provenance, collections, visual profiles and settings. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * knowledge plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/writing-knowledge
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AudienceCreateInput,
  AudienceCreateResult,
  ChapterMemoriesCreateInput,
  ChapterMemoriesCreateResult,
  ChapterMemoriesGetResult,
  ChapterMemoriesListQuery,
  ChapterMemoriesListResult,
  ChapterMemoriesUpdateInput,
  ChapterMemoriesUpdateResult,
  CharacterStatesCreateInput,
  CharacterStatesCreateResult,
  CharacterStatesGetResult,
  CharacterStatesListQuery,
  CharacterStatesListResult,
  CharacterStatesUpdateInput,
  CharacterStatesUpdateResult,
  CreativeCollectionsCreateInput,
  CreativeCollectionsCreateResult,
  CreativeCollectionsListResult,
  CreativeCorpusCreateInput,
  CreativeCorpusCreateResult,
  CreativeCorpusImportSnapshotInput,
  CreativeCorpusImportSnapshotResult,
  CreativeCorpusListQuery,
  CreativeCorpusListResult,
  CreativeCorpusUpdateInput,
  CreativeCorpusUpdateResult,
  ForeshadowingsCreateInput,
  ForeshadowingsCreateResult,
  ForeshadowingsGetResult,
  ForeshadowingsListQuery,
  ForeshadowingsListResult,
  ForeshadowingsUpdateInput,
  ForeshadowingsUpdateResult,
  IpTwinBuildResult,
  IpTwinGetResult,
  MemoryCreateInput,
  MemoryCreateResult,
  MemoryGetResult,
  MemoryListQuery,
  MemoryListResult,
  MemoryUpdateInput,
  MemoryUpdateResult,
  NarrativeIndexCatalogResult,
  NarrativeIndexChapterResult,
  NarrativeStoryIndexCatalogResult,
  NarrativeSummariesGetResult,
  NarrativeSummariesListQuery,
  NarrativeSummariesListResult,
  NarrativeSummariesScopesResult,
  NarrativeSummariesSummariesQuery,
  NarrativeSummariesSummariesResult,
  ProvenanceCreateInput,
  ProvenanceCreateResult,
  ProvenanceListQuery,
  ProvenanceListResult,
  ResearchFindingsCreateInput,
  ResearchFindingsCreateResult,
  ResearchFindingsListResult,
  ResearchSearchInput,
  ResearchSearchResult,
  ResearchSourcesCreateInput,
  ResearchSourcesCreateResult,
  ResearchSourcesListQuery,
  ResearchSourcesListResult,
  ResearchTopicsCreateInput,
  ResearchTopicsCreateResult,
  ResearchTopicsListQuery,
  ResearchTopicsListResult,
  StoryBibleSidecarPreferencesCreateInput,
  StoryBibleSidecarPreferencesCreateResult,
  StoryBibleSidecarPreferencesGetResult,
  StoryBibleSidecarPreferencesListQuery,
  StoryBibleSidecarPreferencesListResult,
  StoryBibleSidecarPreferencesUpdateInput,
  StoryBibleSidecarPreferencesUpdateResult,
  StoryBibleApplyInput,
  StoryBibleApplyResult,
  StoryBibleListResult,
  StoryBibleQueueInput,
  StoryBibleQueueResult,
  StoryBibleRecordsCreateInput,
  StoryBibleRecordsCreateResult,
  StoryBibleRecordsGetResult,
  StoryBibleRecordsListQuery,
  StoryBibleRecordsListResult,
  StoryBibleRecordsUpdateInput,
  StoryBibleRecordsUpdateResult,
  StoryBibleSetStatusInput,
  StoryBibleSetStatusResult,
  StoryBibleSettingsResult,
  StoryBibleStaleResult,
  StoryBibleUndoResult,
  StoryBibleUpdateSettingsInput,
  StoryBibleUpdateSettingsResult,
  StoryEventsCreateInput,
  StoryEventsCreateResult,
  StoryEventsGetResult,
  StoryEventsListQuery,
  StoryEventsListResult,
  StoryEventsUpdateInput,
  StoryEventsUpdateResult,
  StoryGraphCreateEdgeInput,
  StoryGraphCreateEdgeResult,
  StoryGraphCreateNodeInput,
  StoryGraphCreateNodeResult,
  StoryGraphGetResult,
  StorySimulationsCreateInput,
  StorySimulationsCreateResult,
  StorySimulationsGetResult,
  StoryCreateInput,
  StoryCreateResult,
  StoryGetResult,
  StoryListQuery,
  StoryListResult,
  StoryUpdateInput,
  StoryUpdateResult,
  StoryAssertionsAdoptInput,
  StoryAssertionsAdoptResult,
  StoryAssertionsCreateInput,
  StoryAssertionsCreateResult,
  StoryAssertionsDiscardInput,
  StoryAssertionsDiscardResult,
  StoryAssertionsGetResult,
  StoryAssertionsListQuery,
  StoryAssertionsListResult,
  StoryAssertionsReplaceInput,
  StoryAssertionsReplaceResult,
  StoryAssertionsWithdrawInput,
  StoryAssertionsWithdrawResult,
  StoryDeclarationsAdoptInput,
  StoryDeclarationsAdoptResult,
  StoryDeclarationsCreateInput,
  StoryDeclarationsCreateResult,
  StoryDeclarationsDiscardInput,
  StoryDeclarationsDiscardResult,
  StoryDeclarationsGetResult,
  StoryDeclarationsListQuery,
  StoryDeclarationsListResult,
  StoryDeclarationsReplaceInput,
  StoryDeclarationsReplaceResult,
  StoryDeclarationsWithdrawInput,
  StoryDeclarationsWithdrawResult,
  VisualProfilesCreateInput,
  VisualProfilesCreateResult,
  VisualProfilesGetResult,
  VisualProfilesListQuery,
  VisualProfilesListResult,
  VisualProfilesUpdateInput,
  VisualProfilesUpdateResult,
  VisualSettingsCreateInput,
  VisualSettingsCreateResult,
  VisualSettingsGetResult,
  VisualSettingsListQuery,
  VisualSettingsListResult,
  VisualSettingsUpdateInput,
  VisualSettingsUpdateResult,
} from "./types.ts";
import { knowledgeLegacyRoutes, type KnowledgeLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `knowledge` Remote namespace. */
    knowledgeController: KnowledgeController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  knowledgeLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.knowledge` namespace. */
export class KnowledgeController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "knowledgeController", { namespace: "knowledge" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: KnowledgeLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = knowledgeLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `POST /api/v2/projects/{id}/audience-knowledge`.
   * @replaces audience-knowledge.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audienceCreate(
    id: string,
    input: AudienceCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudienceCreateResult> {
    return this.run("audienceCreate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/chapter-memories`.
   * @replaces chapter-memories.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chapterMemoriesCreate(
    input: ChapterMemoriesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChapterMemoriesCreateResult> {
    return this.run("chapterMemoriesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/chapter-memories/{id}`.
   * @replaces chapter-memories.get
   * @param id - the `id` path parameter.
   */
  @Remote
  chapterMemoriesGet(id: string): Promise<ChapterMemoriesGetResult> {
    return this.run("chapterMemoriesGet", id);
  }

  /**
   * Runs `GET /api/v2/chapter-memories`.
   * @replaces chapter-memories.list
   * @param query - the query parameters.
   */
  @Remote
  chapterMemoriesList(
    query?: ChapterMemoriesListQuery,
  ): Promise<ChapterMemoriesListResult> {
    return this.run("chapterMemoriesList", query);
  }

  /**
   * Runs `DELETE /api/v2/chapter-memories/{id}`.
   * @replaces chapter-memories.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chapterMemoriesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("chapterMemoriesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/chapter-memories/{id}`.
   * @replaces chapter-memories.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chapterMemoriesUpdate(
    id: string,
    input: ChapterMemoriesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChapterMemoriesUpdateResult> {
    return this.run(
      "chapterMemoriesUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/character-states`.
   * @replaces character-states.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  characterStatesCreate(
    input: CharacterStatesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CharacterStatesCreateResult> {
    return this.run("characterStatesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/character-states/{id}`.
   * @replaces character-states.get
   * @param id - the `id` path parameter.
   */
  @Remote
  characterStatesGet(id: string): Promise<CharacterStatesGetResult> {
    return this.run("characterStatesGet", id);
  }

  /**
   * Runs `GET /api/v2/character-states`.
   * @replaces character-states.list
   * @param query - the query parameters.
   */
  @Remote
  characterStatesList(
    query?: CharacterStatesListQuery,
  ): Promise<CharacterStatesListResult> {
    return this.run("characterStatesList", query);
  }

  /**
   * Runs `DELETE /api/v2/character-states/{id}`.
   * @replaces character-states.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  characterStatesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("characterStatesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/character-states/{id}`.
   * @replaces character-states.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  characterStatesUpdate(
    id: string,
    input: CharacterStatesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CharacterStatesUpdateResult> {
    return this.run(
      "characterStatesUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/creative-corpus/collections`.
   * @replaces creative-collections.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeCollectionsCreate(
    input: CreativeCollectionsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeCollectionsCreateResult> {
    return this.run(
      "creativeCollectionsCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/creative-corpus/collections`.
   * @replaces creative-collections.list
   */
  @Remote
  creativeCollectionsList(): Promise<CreativeCollectionsListResult> {
    return this.run("creativeCollectionsList");
  }

  /**
   * Runs `POST /api/v2/creative-corpus/items`.
   * @replaces creative-corpus.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeCorpusCreate(
    input: CreativeCorpusCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeCorpusCreateResult> {
    return this.run("creativeCorpusCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creative-corpus/snapshots/import`.
   * @replaces creative-corpus.importSnapshot
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeCorpusImportSnapshot(
    input: CreativeCorpusImportSnapshotInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeCorpusImportSnapshotResult> {
    return this.run(
      "creativeCorpusImportSnapshot",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/creative-corpus/items`.
   * @replaces creative-corpus.list
   * @param query - the query parameters.
   */
  @Remote
  creativeCorpusList(
    query?: CreativeCorpusListQuery,
  ): Promise<CreativeCorpusListResult> {
    return this.run("creativeCorpusList", query);
  }

  /**
   * Runs `PATCH /api/v2/creative-corpus/items/{id}`.
   * @replaces creative-corpus.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creativeCorpusUpdate(
    id: string,
    input: CreativeCorpusUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreativeCorpusUpdateResult> {
    return this.run("creativeCorpusUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/foreshadowings`.
   * @replaces foreshadowings.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  foreshadowingsCreate(
    input: ForeshadowingsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ForeshadowingsCreateResult> {
    return this.run("foreshadowingsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/foreshadowings/{id}`.
   * @replaces foreshadowings.get
   * @param id - the `id` path parameter.
   */
  @Remote
  foreshadowingsGet(id: string): Promise<ForeshadowingsGetResult> {
    return this.run("foreshadowingsGet", id);
  }

  /**
   * Runs `GET /api/v2/foreshadowings`.
   * @replaces foreshadowings.list
   * @param query - the query parameters.
   */
  @Remote
  foreshadowingsList(
    query?: ForeshadowingsListQuery,
  ): Promise<ForeshadowingsListResult> {
    return this.run("foreshadowingsList", query);
  }

  /**
   * Runs `DELETE /api/v2/foreshadowings/{id}`.
   * @replaces foreshadowings.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  foreshadowingsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("foreshadowingsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/foreshadowings/{id}`.
   * @replaces foreshadowings.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  foreshadowingsUpdate(
    id: string,
    input: ForeshadowingsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ForeshadowingsUpdateResult> {
    return this.run("foreshadowingsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/ip-twin`.
   * @replaces ip-twin.build
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  ipTwinBuild(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<IpTwinBuildResult> {
    return this.run("ipTwinBuild", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/ip-twins/{snapshotId}`.
   * @replaces ip-twin.get
   * @param id - the `id` path parameter.
   * @param snapshotId - the `snapshotId` path parameter.
   */
  @Remote
  ipTwinGet(id: string, snapshotId: string): Promise<IpTwinGetResult> {
    return this.run("ipTwinGet", id, snapshotId);
  }

  /**
   * Runs `POST /api/v2/memory`.
   * @replaces memory.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  memoryCreate(
    input: MemoryCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MemoryCreateResult> {
    return this.run("memoryCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/memory/{id}`.
   * @replaces memory.get
   * @param id - the `id` path parameter.
   */
  @Remote
  memoryGet(id: string): Promise<MemoryGetResult> {
    return this.run("memoryGet", id);
  }

  /**
   * Runs `GET /api/v2/memory`.
   * @replaces memory.list
   * @param query - the query parameters.
   */
  @Remote
  memoryList(query?: MemoryListQuery): Promise<MemoryListResult> {
    return this.run("memoryList", query);
  }

  /**
   * Runs `DELETE /api/v2/memory/{id}`.
   * @replaces memory.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  memoryRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("memoryRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/memory/{id}`.
   * @replaces memory.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  memoryUpdate(
    id: string,
    input: MemoryUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MemoryUpdateResult> {
    return this.run("memoryUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Local source index, not semantic validation or model context. Runs `GET /api/v2/projects/{projectId}/narrative-context-index`.
   * @replaces narrativeIndex.catalog
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  narrativeIndexCatalog(
    projectId: string,
  ): Promise<NarrativeIndexCatalogResult> {
    return this.run("narrativeIndexCatalog", projectId);
  }

  /**
   * Local source index, not semantic validation or model context. Runs `GET /api/v2/projects/{projectId}/narrative-context-index/chapters/{chapterId}`.
   * @replaces narrativeIndex.chapter
   * @param projectId - the `projectId` path parameter.
   * @param chapterId - the `chapterId` path parameter.
   */
  @Remote
  narrativeIndexChapter(
    projectId: string,
    chapterId: string,
  ): Promise<NarrativeIndexChapterResult> {
    return this.run("narrativeIndexChapter", projectId, chapterId);
  }

  /**
   * Source-anchored human interpretations; no source text or semantic certification. Runs `GET /api/v2/projects/{projectId}/narrative-story-index`.
   * @replaces narrativeStoryIndex.catalog
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  narrativeStoryIndexCatalog(
    projectId: string,
  ): Promise<NarrativeStoryIndexCatalogResult> {
    return this.run("narrativeStoryIndexCatalog", projectId);
  }

  /**
   * 实际分层摘要与来源投影. Runs `GET /api/v2/projects/{projectId}/narrative-summaries/{summaryId}`.
   * @replaces narrativeSummaries.get
   * @param projectId - the `projectId` path parameter.
   * @param summaryId - the `summaryId` path parameter.
   */
  @Remote
  narrativeSummariesGet(
    projectId: string,
    summaryId: string,
  ): Promise<NarrativeSummariesGetResult> {
    return this.run("narrativeSummariesGet", projectId, summaryId);
  }

  /**
   * 实际分层摘要与来源投影. Runs `GET /api/v2/projects/{projectId}/narrative-summaries`.
   * @replaces narrativeSummaries.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  narrativeSummariesList(
    projectId: string,
    query?: NarrativeSummariesListQuery,
  ): Promise<NarrativeSummariesListResult> {
    return this.run("narrativeSummariesList", projectId, query);
  }

  /**
   * 实际分层摘要与来源投影. Runs `GET /api/v2/projects/{projectId}/narrative-summaries/scopes`.
   * @replaces narrativeSummaries.scopes
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  narrativeSummariesScopes(
    projectId: string,
  ): Promise<NarrativeSummariesScopesResult> {
    return this.run("narrativeSummariesScopes", projectId);
  }

  /**
   * 实际分层摘要与来源投影. Runs `GET /api/v2/projects/{projectId}/narrative-summaries/summaries`.
   * @replaces narrativeSummaries.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  narrativeSummariesSummaries(
    projectId: string,
    query?: NarrativeSummariesSummariesQuery,
  ): Promise<NarrativeSummariesSummariesResult> {
    return this.run("narrativeSummariesSummaries", projectId, query);
  }

  /**
   * Runs `POST /api/v2/provenance`.
   * @replaces provenance.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  provenanceCreate(
    input: ProvenanceCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProvenanceCreateResult> {
    return this.run("provenanceCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/provenance`.
   * @replaces provenance.list
   * @param query - the query parameters.
   */
  @Remote
  provenanceList(query?: ProvenanceListQuery): Promise<ProvenanceListResult> {
    return this.run("provenanceList", query);
  }

  /**
   * Runs `POST /api/v2/research-topics/{id}/findings`.
   * @replaces research.findings.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  researchFindingsCreate(
    id: string,
    input: ResearchFindingsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ResearchFindingsCreateResult> {
    return this.run(
      "researchFindingsCreate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/research-topics/{id}/findings`.
   * @replaces research.findings.list
   * @param id - the `id` path parameter.
   */
  @Remote
  researchFindingsList(id: string): Promise<ResearchFindingsListResult> {
    return this.run("researchFindingsList", id);
  }

  /**
   * Runs `POST /api/v2/research-topics/{id}/search`.
   * @replaces research.search
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  researchSearch(
    id: string,
    input: ResearchSearchInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ResearchSearchResult> {
    return this.run("researchSearch", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/research-topics/{id}/sources`.
   * @replaces research.sources.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  researchSourcesCreate(
    id: string,
    input: ResearchSourcesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ResearchSourcesCreateResult> {
    return this.run(
      "researchSourcesCreate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/research-topics/{id}/sources`.
   * @replaces research.sources.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  researchSourcesList(
    id: string,
    query?: ResearchSourcesListQuery,
  ): Promise<ResearchSourcesListResult> {
    return this.run("researchSourcesList", id, query);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/research-topics`.
   * @replaces research.topics.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  researchTopicsCreate(
    projectId: string,
    input: ResearchTopicsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ResearchTopicsCreateResult> {
    return this.run(
      "researchTopicsCreate",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/research-topics`.
   * @replaces research.topics.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  researchTopicsList(
    projectId: string,
    query?: ResearchTopicsListQuery,
  ): Promise<ResearchTopicsListResult> {
    return this.run("researchTopicsList", projectId, query);
  }

  /**
   * Runs `POST /api/v2/story-bible-sidecar-preferences`.
   * @replaces story-bible-sidecar-preferences.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleSidecarPreferencesCreate(
    input: StoryBibleSidecarPreferencesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleSidecarPreferencesCreateResult> {
    return this.run(
      "storyBibleSidecarPreferencesCreate",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/story-bible-sidecar-preferences/{id}`.
   * @replaces story-bible-sidecar-preferences.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyBibleSidecarPreferencesGet(
    id: string,
  ): Promise<StoryBibleSidecarPreferencesGetResult> {
    return this.run("storyBibleSidecarPreferencesGet", id);
  }

  /**
   * Runs `GET /api/v2/story-bible-sidecar-preferences`.
   * @replaces story-bible-sidecar-preferences.list
   * @param query - the query parameters.
   */
  @Remote
  storyBibleSidecarPreferencesList(
    query?: StoryBibleSidecarPreferencesListQuery,
  ): Promise<StoryBibleSidecarPreferencesListResult> {
    return this.run("storyBibleSidecarPreferencesList", query);
  }

  /**
   * Runs `DELETE /api/v2/story-bible-sidecar-preferences/{id}`.
   * @replaces story-bible-sidecar-preferences.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleSidecarPreferencesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run(
      "storyBibleSidecarPreferencesRemove",
      id,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/story-bible-sidecar-preferences/{id}`.
   * @replaces story-bible-sidecar-preferences.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleSidecarPreferencesUpdate(
    id: string,
    input: StoryBibleSidecarPreferencesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleSidecarPreferencesUpdateResult> {
    return this.run(
      "storyBibleSidecarPreferencesUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/story-bible/change-sets/{id}/apply`.
   * @replaces story-bible.apply
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleApply(
    id: string,
    input: StoryBibleApplyInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleApplyResult> {
    return this.run("storyBibleApply", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/story-bible/change-sets`.
   * @replaces story-bible.list
   * @param id - the `id` path parameter.
   */
  @Remote
  storyBibleList(id: string): Promise<StoryBibleListResult> {
    return this.run("storyBibleList", id);
  }

  /**
   * Runs `POST /api/v2/story-bible/change-sets`.
   * @replaces story-bible.queue
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleQueue(
    input: StoryBibleQueueInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleQueueResult> {
    return this.run("storyBibleQueue", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/story-bible`.
   * @replaces story-bible.records.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleRecordsCreate(
    input: StoryBibleRecordsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleRecordsCreateResult> {
    return this.run("storyBibleRecordsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/story-bible/{id}`.
   * @replaces story-bible.records.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyBibleRecordsGet(id: string): Promise<StoryBibleRecordsGetResult> {
    return this.run("storyBibleRecordsGet", id);
  }

  /**
   * Runs `GET /api/v2/story-bible`.
   * @replaces story-bible.records.list
   * @param query - the query parameters.
   */
  @Remote
  storyBibleRecordsList(
    query?: StoryBibleRecordsListQuery,
  ): Promise<StoryBibleRecordsListResult> {
    return this.run("storyBibleRecordsList", query);
  }

  /**
   * Runs `DELETE /api/v2/story-bible/{id}`.
   * @replaces story-bible.records.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleRecordsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("storyBibleRecordsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/story-bible/{id}`.
   * @replaces story-bible.records.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleRecordsUpdate(
    id: string,
    input: StoryBibleRecordsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleRecordsUpdateResult> {
    return this.run(
      "storyBibleRecordsUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/story-bible/change-sets/{id}/status`.
   * @replaces story-bible.setStatus
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleSetStatus(
    id: string,
    input: StoryBibleSetStatusInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleSetStatusResult> {
    return this.run("storyBibleSetStatus", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/story-bible/settings`.
   * @replaces story-bible.settings
   * @param id - the `id` path parameter.
   */
  @Remote
  storyBibleSettings(id: string): Promise<StoryBibleSettingsResult> {
    return this.run("storyBibleSettings", id);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/story-bible/stale`.
   * @replaces story-bible.stale
   * @param id - the `id` path parameter.
   */
  @Remote
  storyBibleStale(id: string): Promise<StoryBibleStaleResult> {
    return this.run("storyBibleStale", id);
  }

  /**
   * Runs `POST /api/v2/story-bible/change-sets/{id}/undo`.
   * @replaces story-bible.undo
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleUndo(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleUndoResult> {
    return this.run("storyBibleUndo", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PUT /api/v2/projects/{id}/story-bible/settings`.
   * @replaces story-bible.updateSettings
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyBibleUpdateSettings(
    id: string,
    input: StoryBibleUpdateSettingsInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryBibleUpdateSettingsResult> {
    return this.run(
      "storyBibleUpdateSettings",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/story-events`.
   * @replaces story-events.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyEventsCreate(
    input: StoryEventsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryEventsCreateResult> {
    return this.run("storyEventsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/story-events/{id}`.
   * @replaces story-events.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyEventsGet(id: string): Promise<StoryEventsGetResult> {
    return this.run("storyEventsGet", id);
  }

  /**
   * Runs `GET /api/v2/story-events`.
   * @replaces story-events.list
   * @param query - the query parameters.
   */
  @Remote
  storyEventsList(
    query?: StoryEventsListQuery,
  ): Promise<StoryEventsListResult> {
    return this.run("storyEventsList", query);
  }

  /**
   * Runs `DELETE /api/v2/story-events/{id}`.
   * @replaces story-events.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyEventsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("storyEventsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/story-events/{id}`.
   * @replaces story-events.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyEventsUpdate(
    id: string,
    input: StoryEventsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryEventsUpdateResult> {
    return this.run("storyEventsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/story-graph/edges`.
   * @replaces story-graph.createEdge
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyGraphCreateEdge(
    id: string,
    input: StoryGraphCreateEdgeInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryGraphCreateEdgeResult> {
    return this.run("storyGraphCreateEdge", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/story-graph/nodes`.
   * @replaces story-graph.createNode
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyGraphCreateNode(
    id: string,
    input: StoryGraphCreateNodeInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryGraphCreateNodeResult> {
    return this.run("storyGraphCreateNode", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/story-graph`.
   * @replaces story-graph.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyGraphGet(id: string): Promise<StoryGraphGetResult> {
    return this.run("storyGraphGet", id);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/story-simulations`.
   * @replaces story-simulations.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storySimulationsCreate(
    id: string,
    input: StorySimulationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StorySimulationsCreateResult> {
    return this.run(
      "storySimulationsCreate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{id}/story-simulations/{simulationId}`.
   * @replaces story-simulations.get
   * @param id - the `id` path parameter.
   * @param simulationId - the `simulationId` path parameter.
   */
  @Remote
  storySimulationsGet(
    id: string,
    simulationId: string,
  ): Promise<StorySimulationsGetResult> {
    return this.run("storySimulationsGet", id, simulationId);
  }

  /**
   * Runs `POST /api/v2/story`.
   * @replaces story.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyCreate(
    input: StoryCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryCreateResult> {
    return this.run("storyCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/story/{id}`.
   * @replaces story.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyGet(id: string): Promise<StoryGetResult> {
    return this.run("storyGet", id);
  }

  /**
   * Runs `GET /api/v2/story`.
   * @replaces story.list
   * @param query - the query parameters.
   */
  @Remote
  storyList(query?: StoryListQuery): Promise<StoryListResult> {
    return this.run("storyList", query);
  }

  /**
   * Runs `DELETE /api/v2/story/{id}`.
   * @replaces story.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("storyRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/story/{id}`.
   * @replaces story.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyUpdate(
    id: string,
    input: StoryUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryUpdateResult> {
    return this.run("storyUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-assertions/{assertionId}/adopt`.
   * @replaces storyAssertions.adopt
   * @param projectId - the `projectId` path parameter.
   * @param assertionId - the `assertionId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyAssertionsAdopt(
    projectId: string,
    assertionId: string,
    input: StoryAssertionsAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryAssertionsAdoptResult> {
    return this.run(
      "storyAssertionsAdopt",
      projectId,
      assertionId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-assertions`.
   * @replaces storyAssertions.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyAssertionsCreate(
    projectId: string,
    input: StoryAssertionsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryAssertionsCreateResult> {
    return this.run(
      "storyAssertionsCreate",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-assertions/{assertionId}/discard`.
   * @replaces storyAssertions.discard
   * @param projectId - the `projectId` path parameter.
   * @param assertionId - the `assertionId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyAssertionsDiscard(
    projectId: string,
    assertionId: string,
    input: StoryAssertionsDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryAssertionsDiscardResult> {
    return this.run(
      "storyAssertionsDiscard",
      projectId,
      assertionId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `GET /api/v2/projects/{projectId}/story-assertions/{assertionId}`.
   * @replaces storyAssertions.get
   * @param projectId - the `projectId` path parameter.
   * @param assertionId - the `assertionId` path parameter.
   */
  @Remote
  storyAssertionsGet(
    projectId: string,
    assertionId: string,
  ): Promise<StoryAssertionsGetResult> {
    return this.run("storyAssertionsGet", projectId, assertionId);
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `GET /api/v2/projects/{projectId}/story-assertions`.
   * @replaces storyAssertions.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  storyAssertionsList(
    projectId: string,
    query?: StoryAssertionsListQuery,
  ): Promise<StoryAssertionsListResult> {
    return this.run("storyAssertionsList", projectId, query);
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-assertions/{assertionId}/replace`.
   * @replaces storyAssertions.replace
   * @param projectId - the `projectId` path parameter.
   * @param assertionId - the `assertionId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyAssertionsReplace(
    projectId: string,
    assertionId: string,
    input: StoryAssertionsReplaceInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryAssertionsReplaceResult> {
    return this.run(
      "storyAssertionsReplace",
      projectId,
      assertionId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen human-reviewed assertion, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-assertions/{assertionId}/withdraw`.
   * @replaces storyAssertions.withdraw
   * @param projectId - the `projectId` path parameter.
   * @param assertionId - the `assertionId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyAssertionsWithdraw(
    projectId: string,
    assertionId: string,
    input: StoryAssertionsWithdrawInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryAssertionsWithdrawResult> {
    return this.run(
      "storyAssertionsWithdraw",
      projectId,
      assertionId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-declarations/{declarationId}/adopt`.
   * @replaces storyDeclarations.adopt
   * @param projectId - the `projectId` path parameter.
   * @param declarationId - the `declarationId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyDeclarationsAdopt(
    projectId: string,
    declarationId: string,
    input: StoryDeclarationsAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryDeclarationsAdoptResult> {
    return this.run(
      "storyDeclarationsAdopt",
      projectId,
      declarationId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-declarations`.
   * @replaces storyDeclarations.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyDeclarationsCreate(
    projectId: string,
    input: StoryDeclarationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryDeclarationsCreateResult> {
    return this.run(
      "storyDeclarationsCreate",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-declarations/{declarationId}/discard`.
   * @replaces storyDeclarations.discard
   * @param projectId - the `projectId` path parameter.
   * @param declarationId - the `declarationId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyDeclarationsDiscard(
    projectId: string,
    declarationId: string,
    input: StoryDeclarationsDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryDeclarationsDiscardResult> {
    return this.run(
      "storyDeclarationsDiscard",
      projectId,
      declarationId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `GET /api/v2/projects/{projectId}/story-declarations/{declarationId}`.
   * @replaces storyDeclarations.get
   * @param projectId - the `projectId` path parameter.
   * @param declarationId - the `declarationId` path parameter.
   */
  @Remote
  storyDeclarationsGet(
    projectId: string,
    declarationId: string,
  ): Promise<StoryDeclarationsGetResult> {
    return this.run("storyDeclarationsGet", projectId, declarationId);
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `GET /api/v2/projects/{projectId}/story-declarations`.
   * @replaces storyDeclarations.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  storyDeclarationsList(
    projectId: string,
    query?: StoryDeclarationsListQuery,
  ): Promise<StoryDeclarationsListResult> {
    return this.run("storyDeclarationsList", projectId, query);
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-declarations/{declarationId}/replace`.
   * @replaces storyDeclarations.replace
   * @param projectId - the `projectId` path parameter.
   * @param declarationId - the `declarationId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyDeclarationsReplace(
    projectId: string,
    declarationId: string,
    input: StoryDeclarationsReplaceInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryDeclarationsReplaceResult> {
    return this.run(
      "storyDeclarationsReplace",
      projectId,
      declarationId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Source-anchored human declaration, not semantic proof. Runs `POST /api/v2/projects/{projectId}/story-declarations/{declarationId}/withdraw`.
   * @replaces storyDeclarations.withdraw
   * @param projectId - the `projectId` path parameter.
   * @param declarationId - the `declarationId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyDeclarationsWithdraw(
    projectId: string,
    declarationId: string,
    input: StoryDeclarationsWithdrawInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryDeclarationsWithdrawResult> {
    return this.run(
      "storyDeclarationsWithdraw",
      projectId,
      declarationId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/visual-profiles`.
   * @replaces visual-profiles.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualProfilesCreate(
    input: VisualProfilesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualProfilesCreateResult> {
    return this.run("visualProfilesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/visual-profiles/{id}`.
   * @replaces visual-profiles.get
   * @param id - the `id` path parameter.
   */
  @Remote
  visualProfilesGet(id: string): Promise<VisualProfilesGetResult> {
    return this.run("visualProfilesGet", id);
  }

  /**
   * Runs `GET /api/v2/visual-profiles`.
   * @replaces visual-profiles.list
   * @param query - the query parameters.
   */
  @Remote
  visualProfilesList(
    query?: VisualProfilesListQuery,
  ): Promise<VisualProfilesListResult> {
    return this.run("visualProfilesList", query);
  }

  /**
   * Runs `DELETE /api/v2/visual-profiles/{id}`.
   * @replaces visual-profiles.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualProfilesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("visualProfilesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/visual-profiles/{id}`.
   * @replaces visual-profiles.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualProfilesUpdate(
    id: string,
    input: VisualProfilesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualProfilesUpdateResult> {
    return this.run("visualProfilesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/visual-settings`.
   * @replaces visual-settings.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualSettingsCreate(
    input: VisualSettingsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualSettingsCreateResult> {
    return this.run("visualSettingsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/visual-settings/{id}`.
   * @replaces visual-settings.get
   * @param id - the `id` path parameter.
   */
  @Remote
  visualSettingsGet(id: string): Promise<VisualSettingsGetResult> {
    return this.run("visualSettingsGet", id);
  }

  /**
   * Runs `GET /api/v2/visual-settings`.
   * @replaces visual-settings.list
   * @param query - the query parameters.
   */
  @Remote
  visualSettingsList(
    query?: VisualSettingsListQuery,
  ): Promise<VisualSettingsListResult> {
    return this.run("visualSettingsList", query);
  }

  /**
   * Runs `DELETE /api/v2/visual-settings/{id}`.
   * @replaces visual-settings.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualSettingsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("visualSettingsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/visual-settings/{id}`.
   * @replaces visual-settings.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualSettingsUpdate(
    id: string,
    input: VisualSettingsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualSettingsUpdateResult> {
    return this.run("visualSettingsUpdate", id, input, ifMatch, idempotencyKey);
  }
}

export default KnowledgeController;
