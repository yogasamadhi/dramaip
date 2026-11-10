/**
 * Host face of the writing domain. It owns the `writing` Remote namespace:
 * chapters, volumes, outlines, characters, story arcs, content versions, chapter analysis, the creator workbench and the novel workspace. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * writing plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/writing-writing
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AnalysisRunChapterResult,
  ChaptersAdoptionsQuery,
  ChaptersAdoptionsResult,
  ChaptersCreateInput,
  ChaptersCreateResult,
  ChaptersGetResult,
  ChaptersListResult,
  ChaptersReorderInput,
  ChaptersReorderResult,
  ChaptersUpdateInput,
  ChaptersUpdateResult,
  CharactersCreateInput,
  CharactersCreateResult,
  CharactersGetResult,
  CharactersListQuery,
  CharactersListResult,
  CharactersUpdateInput,
  CharactersUpdateResult,
  ContentVersionsListResult,
  ContentVersionsRestoreResult,
  CreatorCalendarCreateInput,
  CreatorCalendarCreateResult,
  CreatorCalendarListResult,
  CreatorCalendarUpdateInput,
  CreatorCalendarUpdateResult,
  CreatorColumnCreateInput,
  CreatorColumnCreateResult,
  CreatorColumnListResult,
  CreatorColumnUpdateInput,
  CreatorColumnUpdateResult,
  CreatorDraftCreateInput,
  CreatorDraftCreateResult,
  CreatorDraftListResult,
  CreatorDraftUpdateInput,
  CreatorDraftUpdateResult,
  CreatorIdeaCreateInput,
  CreatorIdeaCreateResult,
  CreatorIdeaListResult,
  CreatorIdeaUpdateInput,
  CreatorIdeaUpdateResult,
  CreatorProfileCreateInput,
  CreatorProfileCreateResult,
  CreatorProfileListResult,
  CreatorProfileUpdateInput,
  CreatorProfileUpdateResult,
  CreatorVariantCreateInput,
  CreatorVariantCreateResult,
  CreatorVariantListResult,
  CreatorVariantUpdateInput,
  CreatorVariantUpdateResult,
  NovelWorkspaceContinueChapterInput,
  NovelWorkspaceContinueChapterResult,
  NovelWorkspaceGetResult,
  NovelWorkspaceListChapterVersionsResult,
  NovelWorkspaceRestoreChapterVersionInput,
  NovelWorkspaceRestoreChapterVersionResult,
  NovelWorkspaceRunChapterAgentInput,
  NovelWorkspaceRunChapterAgentResult,
  OutlinesCreateInput,
  OutlinesCreateResult,
  OutlinesGetResult,
  OutlinesListQuery,
  OutlinesListResult,
  OutlinesUpdateInput,
  OutlinesUpdateResult,
  StoryArcsCreateInput,
  StoryArcsCreateResult,
  StoryArcsGetResult,
  StoryArcsListQuery,
  StoryArcsListResult,
  StoryArcsUpdateInput,
  StoryArcsUpdateResult,
  VolumesAssignChaptersInput,
  VolumesAssignChaptersResult,
  VolumesCreateInput,
  VolumesCreateResult,
  VolumesListQuery,
  VolumesListResult,
  VolumesUpdateInput,
  VolumesUpdateResult,
} from "./types.ts";
import { writingLegacyRoutes, type WritingLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `writing` Remote namespace. */
    writingController: WritingController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  writingLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.writing` namespace. */
export class WritingController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "writingController", { namespace: "writing" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: WritingLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = writingLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `POST /api/v2/chapters/{id}/analysis`.
   * @replaces analysis.runChapter
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  analysisRunChapter(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AnalysisRunChapterResult> {
    return this.run("analysisRunChapter", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/chapter-adoptions`.
   * @replaces chapters.adoptions
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  chaptersAdoptions(
    projectId: string,
    query?: ChaptersAdoptionsQuery,
  ): Promise<ChaptersAdoptionsResult> {
    return this.run("chaptersAdoptions", projectId, query);
  }

  /**
   * Runs `POST /api/v2/chapters`.
   * @replaces chapters.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chaptersCreate(
    input: ChaptersCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChaptersCreateResult> {
    return this.run("chaptersCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/chapters/{id}`.
   * @replaces chapters.get
   * @param id - the `id` path parameter.
   */
  @Remote
  chaptersGet(id: string): Promise<ChaptersGetResult> {
    return this.run("chaptersGet", id);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/chapters`.
   * @replaces chapters.list
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  chaptersList(projectId: string): Promise<ChaptersListResult> {
    return this.run("chaptersList", projectId);
  }

  /**
   * Runs `DELETE /api/v2/chapters/{id}`.
   * @replaces chapters.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chaptersRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("chaptersRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/chapters/reorder`.
   * @replaces chapters.reorder
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chaptersReorder(
    projectId: string,
    input: ChaptersReorderInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChaptersReorderResult> {
    return this.run(
      "chaptersReorder",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `PATCH /api/v2/chapters/{id}`.
   * @replaces chapters.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  chaptersUpdate(
    id: string,
    input: ChaptersUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChaptersUpdateResult> {
    return this.run("chaptersUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/characters`.
   * @replaces characters.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  charactersCreate(
    input: CharactersCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CharactersCreateResult> {
    return this.run("charactersCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/characters/{id}`.
   * @replaces characters.get
   * @param id - the `id` path parameter.
   */
  @Remote
  charactersGet(id: string): Promise<CharactersGetResult> {
    return this.run("charactersGet", id);
  }

  /**
   * Runs `GET /api/v2/characters`.
   * @replaces characters.list
   * @param query - the query parameters.
   */
  @Remote
  charactersList(query?: CharactersListQuery): Promise<CharactersListResult> {
    return this.run("charactersList", query);
  }

  /**
   * Runs `DELETE /api/v2/characters/{id}`.
   * @replaces characters.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  charactersRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("charactersRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/characters/{id}`.
   * @replaces characters.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  charactersUpdate(
    id: string,
    input: CharactersUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CharactersUpdateResult> {
    return this.run("charactersUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/content-versions`.
   * @replaces content-versions.list
   * @param id - the `id` path parameter.
   */
  @Remote
  contentVersionsList(id: string): Promise<ContentVersionsListResult> {
    return this.run("contentVersionsList", id);
  }

  /**
   * Runs `POST /api/v2/content-versions/{id}/restore`.
   * @replaces content-versions.restore
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  contentVersionsRestore(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ContentVersionsRestoreResult> {
    return this.run("contentVersionsRestore", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creator/calendar`.
   * @replaces creator.calendar.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorCalendarCreate(
    input: CreatorCalendarCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorCalendarCreateResult> {
    return this.run("creatorCalendarCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/calendar`.
   * @replaces creator.calendar.list
   */
  @Remote
  creatorCalendarList(): Promise<CreatorCalendarListResult> {
    return this.run("creatorCalendarList");
  }

  /**
   * Runs `PATCH /api/v2/creator/calendar/{id}`.
   * @replaces creator.calendar.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorCalendarUpdate(
    id: string,
    input: CreatorCalendarUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorCalendarUpdateResult> {
    return this.run(
      "creatorCalendarUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/creator/column`.
   * @replaces creator.column.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorColumnCreate(
    input: CreatorColumnCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorColumnCreateResult> {
    return this.run("creatorColumnCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/column`.
   * @replaces creator.column.list
   */
  @Remote
  creatorColumnList(): Promise<CreatorColumnListResult> {
    return this.run("creatorColumnList");
  }

  /**
   * Runs `PATCH /api/v2/creator/column/{id}`.
   * @replaces creator.column.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorColumnUpdate(
    id: string,
    input: CreatorColumnUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorColumnUpdateResult> {
    return this.run("creatorColumnUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creator/draft`.
   * @replaces creator.draft.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorDraftCreate(
    input: CreatorDraftCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorDraftCreateResult> {
    return this.run("creatorDraftCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/draft`.
   * @replaces creator.draft.list
   */
  @Remote
  creatorDraftList(): Promise<CreatorDraftListResult> {
    return this.run("creatorDraftList");
  }

  /**
   * Runs `PATCH /api/v2/creator/draft/{id}`.
   * @replaces creator.draft.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorDraftUpdate(
    id: string,
    input: CreatorDraftUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorDraftUpdateResult> {
    return this.run("creatorDraftUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creator/idea`.
   * @replaces creator.idea.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorIdeaCreate(
    input: CreatorIdeaCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorIdeaCreateResult> {
    return this.run("creatorIdeaCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/idea`.
   * @replaces creator.idea.list
   */
  @Remote
  creatorIdeaList(): Promise<CreatorIdeaListResult> {
    return this.run("creatorIdeaList");
  }

  /**
   * Runs `PATCH /api/v2/creator/idea/{id}`.
   * @replaces creator.idea.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorIdeaUpdate(
    id: string,
    input: CreatorIdeaUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorIdeaUpdateResult> {
    return this.run("creatorIdeaUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creator/profile`.
   * @replaces creator.profile.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorProfileCreate(
    input: CreatorProfileCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorProfileCreateResult> {
    return this.run("creatorProfileCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/profile`.
   * @replaces creator.profile.list
   */
  @Remote
  creatorProfileList(): Promise<CreatorProfileListResult> {
    return this.run("creatorProfileList");
  }

  /**
   * Runs `PATCH /api/v2/creator/profile/{id}`.
   * @replaces creator.profile.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorProfileUpdate(
    id: string,
    input: CreatorProfileUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorProfileUpdateResult> {
    return this.run("creatorProfileUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/creator/variant`.
   * @replaces creator.variant.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorVariantCreate(
    input: CreatorVariantCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorVariantCreateResult> {
    return this.run("creatorVariantCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/creator/variant`.
   * @replaces creator.variant.list
   */
  @Remote
  creatorVariantList(): Promise<CreatorVariantListResult> {
    return this.run("creatorVariantList");
  }

  /**
   * Runs `PATCH /api/v2/creator/variant/{id}`.
   * @replaces creator.variant.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creatorVariantUpdate(
    id: string,
    input: CreatorVariantUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreatorVariantUpdateResult> {
    return this.run("creatorVariantUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/chapters/continue`.
   * @replaces novel-workspace.continueChapter
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  novelWorkspaceContinueChapter(
    id: string,
    input: NovelWorkspaceContinueChapterInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NovelWorkspaceContinueChapterResult> {
    return this.run(
      "novelWorkspaceContinueChapter",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{id}/novel-workspace`.
   * @replaces novel-workspace.get
   * @param id - the `id` path parameter.
   */
  @Remote
  novelWorkspaceGet(id: string): Promise<NovelWorkspaceGetResult> {
    return this.run("novelWorkspaceGet", id);
  }

  /**
   * Runs `GET /api/v2/chapters/{id}/versions`.
   * @replaces novel-workspace.listChapterVersions
   * @param id - the `id` path parameter.
   */
  @Remote
  novelWorkspaceListChapterVersions(
    id: string,
  ): Promise<NovelWorkspaceListChapterVersionsResult> {
    return this.run("novelWorkspaceListChapterVersions", id);
  }

  /**
   * Runs `POST /api/v2/chapters/{id}/versions/{versionId}/restore`.
   * @replaces novel-workspace.restoreChapterVersion
   * @param id - the `id` path parameter.
   * @param versionId - the `versionId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  novelWorkspaceRestoreChapterVersion(
    id: string,
    versionId: string,
    input: NovelWorkspaceRestoreChapterVersionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NovelWorkspaceRestoreChapterVersionResult> {
    return this.run(
      "novelWorkspaceRestoreChapterVersion",
      id,
      versionId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/chapters/{id}/agent-runs`.
   * @replaces novel-workspace.runChapterAgent
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  novelWorkspaceRunChapterAgent(
    id: string,
    input: NovelWorkspaceRunChapterAgentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<NovelWorkspaceRunChapterAgentResult> {
    return this.run(
      "novelWorkspaceRunChapterAgent",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/outlines`.
   * @replaces outlines.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  outlinesCreate(
    input: OutlinesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<OutlinesCreateResult> {
    return this.run("outlinesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/outlines/{id}`.
   * @replaces outlines.get
   * @param id - the `id` path parameter.
   */
  @Remote
  outlinesGet(id: string): Promise<OutlinesGetResult> {
    return this.run("outlinesGet", id);
  }

  /**
   * Runs `GET /api/v2/outlines`.
   * @replaces outlines.list
   * @param query - the query parameters.
   */
  @Remote
  outlinesList(query?: OutlinesListQuery): Promise<OutlinesListResult> {
    return this.run("outlinesList", query);
  }

  /**
   * Runs `DELETE /api/v2/outlines/{id}`.
   * @replaces outlines.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  outlinesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("outlinesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/outlines/{id}`.
   * @replaces outlines.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  outlinesUpdate(
    id: string,
    input: OutlinesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<OutlinesUpdateResult> {
    return this.run("outlinesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/story-arcs`.
   * @replaces story-arcs.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyArcsCreate(
    input: StoryArcsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryArcsCreateResult> {
    return this.run("storyArcsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/story-arcs/{id}`.
   * @replaces story-arcs.get
   * @param id - the `id` path parameter.
   */
  @Remote
  storyArcsGet(id: string): Promise<StoryArcsGetResult> {
    return this.run("storyArcsGet", id);
  }

  /**
   * Runs `GET /api/v2/story-arcs`.
   * @replaces story-arcs.list
   * @param query - the query parameters.
   */
  @Remote
  storyArcsList(query?: StoryArcsListQuery): Promise<StoryArcsListResult> {
    return this.run("storyArcsList", query);
  }

  /**
   * Runs `DELETE /api/v2/story-arcs/{id}`.
   * @replaces story-arcs.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyArcsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("storyArcsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/story-arcs/{id}`.
   * @replaces story-arcs.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  storyArcsUpdate(
    id: string,
    input: StoryArcsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<StoryArcsUpdateResult> {
    return this.run("storyArcsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/volume-memberships`.
   * @replaces volumes.assignChapters
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  volumesAssignChapters(
    projectId: string,
    input: VolumesAssignChaptersInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VolumesAssignChaptersResult> {
    return this.run(
      "volumesAssignChapters",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/volumes`.
   * @replaces volumes.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  volumesCreate(
    projectId: string,
    input: VolumesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VolumesCreateResult> {
    return this.run("volumesCreate", projectId, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/volumes`.
   * @replaces volumes.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  volumesList(
    projectId: string,
    query?: VolumesListQuery,
  ): Promise<VolumesListResult> {
    return this.run("volumesList", projectId, query);
  }

  /**
   * Runs `PATCH /api/v2/volumes/{id}`.
   * @replaces volumes.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  volumesUpdate(
    id: string,
    input: VolumesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VolumesUpdateResult> {
    return this.run("volumesUpdate", id, input, ifMatch, idempotencyKey);
  }
}

export default WritingController;
