/**
 * Host face of the review domain. It owns the `review` Remote namespace:
 * review packages and their comments and decisions, the editor timeline, media review, production reviews, compliance records and the cloud review binding. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * review plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/production-review
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  CloudBindingResult,
  CloudConnectionResult,
  CloudDeleteResult,
  CloudPreviewInput,
  CloudPreviewResult,
  CloudPublishInput,
  CloudPublishResult,
  CloudSaveConnectionInput,
  CloudSaveConnectionResult,
  CloudSyncResult,
  ComplianceActivateProfileResult,
  ComplianceListProfilesResult,
  CompliancePreflightInput,
  CompliancePreflightResult,
  ComplianceRecordsCreateInput,
  ComplianceRecordsCreateResult,
  ComplianceRecordsGetResult,
  ComplianceRecordsListQuery,
  ComplianceRecordsListResult,
  ComplianceRecordsUpdateInput,
  ComplianceRecordsUpdateResult,
  ProductionReviewsAppendPromptVersionInput,
  ProductionReviewsAppendPromptVersionResult,
  ProductionReviewsGetScriptResult,
  ProductionReviewsGetShotResult,
  ProductionReviewsListPromptVersionsResult,
  ProductionReviewsRunScriptResult,
  ProductionReviewsRunShotResult,
  EditorCreateCommentInput,
  EditorCreateCommentResult,
  EditorCreateDecisionInput,
  EditorCreateDecisionResult,
  EditorCreatePackageResult,
  EditorCreateRevisionPreviewInput,
  EditorCreateRevisionPreviewResult,
  EditorPreflightResult,
  EditorExportPackageResult,
  EditorImportOfflineInput,
  EditorImportOfflineResult,
  EditorListCommentsResult,
  EditorListDecisionsResult,
  EditorListPackagesResult,
  EditorResolveCommentInput,
  EditorResolveCommentResult,
  EditorTimelineResult,
  MediaCreatePackageInput,
  MediaCreatePackageResult,
  MediaEvidenceQuery,
  MediaEvidenceResult,
  MediaExportOriginalQuery,
  MediaExportOriginalResult,
  MediaPreviewQuery,
  MediaPreviewResult,
  MediaRecoverRequestQuery,
  MediaRecoverRequestResult,
  RecordsCreateInput,
  RecordsCreateResult,
  RecordsGetResult,
  RecordsListQuery,
  RecordsListResult,
  RecordsUpdateInput,
  RecordsUpdateResult,
} from "./types.ts";
import { reviewLegacyRoutes, type ReviewLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `review` Remote namespace. */
    reviewController: ReviewController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  reviewLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.review` namespace. */
export class ReviewController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "reviewController", { namespace: "review" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: ReviewLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = reviewLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `GET /api/v2/review-packages/{id}/cloud-review`.
   * @replaces cloud-review.binding
   * @param id - the `id` path parameter.
   */
  @Remote
  cloudBinding(id: string): Promise<CloudBindingResult> {
    return this.run("cloudBinding", id);
  }

  /**
   * Runs `GET /api/v2/cloud-review/connection`.
   * @replaces cloud-review.connection
   */
  @Remote
  cloudConnection(): Promise<CloudConnectionResult> {
    return this.run("cloudConnection");
  }

  /**
   * Runs `DELETE /api/v2/review-packages/{id}/cloud-review`.
   * @replaces cloud-review.delete
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cloudDelete(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CloudDeleteResult> {
    return this.run("cloudDelete", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/review-packages/{id}/cloud-preview`.
   * @replaces cloud-review.preview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cloudPreview(
    id: string,
    input: CloudPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CloudPreviewResult> {
    return this.run("cloudPreview", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/review-packages/{id}/cloud-publish`.
   * @replaces cloud-review.publish
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cloudPublish(
    id: string,
    input: CloudPublishInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CloudPublishResult> {
    return this.run("cloudPublish", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PUT /api/v2/cloud-review/connection`.
   * @replaces cloud-review.saveConnection
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cloudSaveConnection(
    input: CloudSaveConnectionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CloudSaveConnectionResult> {
    return this.run("cloudSaveConnection", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/review-packages/{id}/cloud-sync`.
   * @replaces cloud-review.sync
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cloudSync(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CloudSyncResult> {
    return this.run("cloudSync", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/compliance/profiles/{id}/activate`.
   * @replaces compliance.activateProfile
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  complianceActivateProfile(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ComplianceActivateProfileResult> {
    return this.run("complianceActivateProfile", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/compliance/profiles`.
   * @replaces compliance.listProfiles
   */
  @Remote
  complianceListProfiles(): Promise<ComplianceListProfilesResult> {
    return this.run("complianceListProfiles");
  }

  /**
   * Runs `POST /api/v2/episodes/{id}/compliance-preflight`.
   * @replaces compliance.preflight
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  compliancePreflight(
    id: string,
    input: CompliancePreflightInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CompliancePreflightResult> {
    return this.run("compliancePreflight", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/compliance`.
   * @replaces compliance.records.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  complianceRecordsCreate(
    input: ComplianceRecordsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ComplianceRecordsCreateResult> {
    return this.run("complianceRecordsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/compliance/{id}`.
   * @replaces compliance.records.get
   * @param id - the `id` path parameter.
   */
  @Remote
  complianceRecordsGet(id: string): Promise<ComplianceRecordsGetResult> {
    return this.run("complianceRecordsGet", id);
  }

  /**
   * Runs `GET /api/v2/compliance`.
   * @replaces compliance.records.list
   * @param query - the query parameters.
   */
  @Remote
  complianceRecordsList(
    query?: ComplianceRecordsListQuery,
  ): Promise<ComplianceRecordsListResult> {
    return this.run("complianceRecordsList", query);
  }

  /**
   * Runs `DELETE /api/v2/compliance/{id}`.
   * @replaces compliance.records.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  complianceRecordsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("complianceRecordsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/compliance/{id}`.
   * @replaces compliance.records.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  complianceRecordsUpdate(
    id: string,
    input: ComplianceRecordsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ComplianceRecordsUpdateResult> {
    return this.run(
      "complianceRecordsUpdate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/shots/{id}/prompt-versions`.
   * @replaces production-reviews.appendPromptVersion
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  productionReviewsAppendPromptVersion(
    id: string,
    input: ProductionReviewsAppendPromptVersionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProductionReviewsAppendPromptVersionResult> {
    return this.run(
      "productionReviewsAppendPromptVersion",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/scripts/{id}/review`.
   * @replaces production-reviews.getScript
   * @param id - the `id` path parameter.
   */
  @Remote
  productionReviewsGetScript(
    id: string,
  ): Promise<ProductionReviewsGetScriptResult> {
    return this.run("productionReviewsGetScript", id);
  }

  /**
   * Runs `GET /api/v2/shots/{id}/review`.
   * @replaces production-reviews.getShot
   * @param id - the `id` path parameter.
   */
  @Remote
  productionReviewsGetShot(
    id: string,
  ): Promise<ProductionReviewsGetShotResult> {
    return this.run("productionReviewsGetShot", id);
  }

  /**
   * Runs `GET /api/v2/shots/{id}/prompt-versions`.
   * @replaces production-reviews.listPromptVersions
   * @param id - the `id` path parameter.
   */
  @Remote
  productionReviewsListPromptVersions(
    id: string,
  ): Promise<ProductionReviewsListPromptVersionsResult> {
    return this.run("productionReviewsListPromptVersions", id);
  }

  /**
   * Runs `DELETE /api/v2/scripts/{id}/review`.
   * @replaces production-reviews.removeScript
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  productionReviewsRemoveScript(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run(
      "productionReviewsRemoveScript",
      id,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `DELETE /api/v2/shots/{id}/review`.
   * @replaces production-reviews.removeShot
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  productionReviewsRemoveShot(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("productionReviewsRemoveShot", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/scripts/{id}/review`.
   * @replaces production-reviews.runScript
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  productionReviewsRunScript(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProductionReviewsRunScriptResult> {
    return this.run("productionReviewsRunScript", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/shots/{id}/review`.
   * @replaces production-reviews.runShot
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  productionReviewsRunShot(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProductionReviewsRunShotResult> {
    return this.run("productionReviewsRunShot", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/review-packages/{packageId}/comments`.
   * @replaces review-editor.createComment
   * @param packageId - the `packageId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorCreateComment(
    packageId: string,
    input: EditorCreateCommentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorCreateCommentResult> {
    return this.run(
      "editorCreateComment",
      packageId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/review-packages/{packageId}/decisions`.
   * @replaces review-editor.createDecision
   * @param packageId - the `packageId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorCreateDecision(
    packageId: string,
    input: EditorCreateDecisionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorCreateDecisionResult> {
    return this.run(
      "editorCreateDecision",
      packageId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/episodes/{episodeId}/review-packages`.
   * @replaces review-editor.createPackage
   * @param episodeId - the `episodeId` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorCreatePackage(
    episodeId: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorCreatePackageResult> {
    return this.run("editorCreatePackage", episodeId, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/review-packages/{packageId}/revision-preview`.
   * @replaces review-editor.createRevisionPreview
   * @param packageId - the `packageId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorCreateRevisionPreview(
    packageId: string,
    input: EditorCreateRevisionPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorCreateRevisionPreviewResult> {
    return this.run(
      "editorCreateRevisionPreview",
      packageId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/editor-timeline/preflight`.
   * @replaces review-editor.editorPreflight
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  editorPreflight(episodeId: string): Promise<EditorPreflightResult> {
    return this.run("editorPreflight", episodeId);
  }

  /**
   * Runs `GET /api/v2/review-packages/{id}/export`.
   * @replaces review-editor.exportPackage
   * @param id - the `id` path parameter.
   */
  @Remote
  editorExportPackage(id: string): Promise<EditorExportPackageResult> {
    return this.run("editorExportPackage", id);
  }

  /**
   * Runs `POST /api/v2/review-packages/{id}/import-offline`.
   * @replaces review-editor.importOffline
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorImportOffline(
    id: string,
    input: EditorImportOfflineInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorImportOfflineResult> {
    return this.run("editorImportOffline", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/review-packages/{packageId}/comments`.
   * @replaces review-editor.listComments
   * @param packageId - the `packageId` path parameter.
   */
  @Remote
  editorListComments(packageId: string): Promise<EditorListCommentsResult> {
    return this.run("editorListComments", packageId);
  }

  /**
   * Runs `GET /api/v2/review-packages/{packageId}/decisions`.
   * @replaces review-editor.listDecisions
   * @param packageId - the `packageId` path parameter.
   */
  @Remote
  editorListDecisions(packageId: string): Promise<EditorListDecisionsResult> {
    return this.run("editorListDecisions", packageId);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/review-packages`.
   * @replaces review-editor.listPackages
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  editorListPackages(episodeId: string): Promise<EditorListPackagesResult> {
    return this.run("editorListPackages", episodeId);
  }

  /**
   * Runs `PATCH /api/v2/review-comments/{id}`.
   * @replaces review-editor.resolveComment
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  editorResolveComment(
    id: string,
    input: EditorResolveCommentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EditorResolveCommentResult> {
    return this.run("editorResolveComment", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/editor-timeline`.
   * @replaces review-editor.timeline
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  editorTimeline(episodeId: string): Promise<EditorTimelineResult> {
    return this.run("editorTimeline", episodeId);
  }

  /**
   * Original NLE metadata review, not release approval. Runs `POST /api/v2/episodes/{id}/media-review-packages`.
   * @replaces review-media.createPackage
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCreatePackage(
    id: string,
    input: MediaCreatePackageInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCreatePackageResult> {
    return this.run("mediaCreatePackage", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Original NLE metadata review, not release approval. Runs `GET /api/v2/review-packages/{id}/delivery-evidence`.
   * @replaces review-media.evidence
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaEvidence(
    id: string,
    query: MediaEvidenceQuery,
  ): Promise<MediaEvidenceResult> {
    return this.run("mediaEvidence", id, query);
  }

  /**
   * Original NLE metadata review, not release approval. Runs `GET /api/v2/review-packages/{id}/media-review-export`.
   * @replaces review-media.exportOriginal
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaExportOriginal(
    id: string,
    query: MediaExportOriginalQuery,
  ): Promise<MediaExportOriginalResult> {
    return this.run("mediaExportOriginal", id, query);
  }

  /**
   * Original NLE metadata review, not release approval. Runs `GET /api/v2/episodes/{id}/media-review-preview`.
   * @replaces review-media.preview
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaPreview(
    id: string,
    query: MediaPreviewQuery,
  ): Promise<MediaPreviewResult> {
    return this.run("mediaPreview", id, query);
  }

  /**
   * Original NLE metadata review, not release approval. Runs `GET /api/v2/media-review-requests/{id}`.
   * @replaces review-media.recoverRequest
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaRecoverRequest(
    id: string,
    query: MediaRecoverRequestQuery,
  ): Promise<MediaRecoverRequestResult> {
    return this.run("mediaRecoverRequest", id, query);
  }

  /**
   * Runs `POST /api/v2/review`.
   * @replaces review.records.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsCreate(
    input: RecordsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RecordsCreateResult> {
    return this.run("recordsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/review/{id}`.
   * @replaces review.records.get
   * @param id - the `id` path parameter.
   */
  @Remote
  recordsGet(id: string): Promise<RecordsGetResult> {
    return this.run("recordsGet", id);
  }

  /**
   * Runs `GET /api/v2/review`.
   * @replaces review.records.list
   * @param query - the query parameters.
   */
  @Remote
  recordsList(query?: RecordsListQuery): Promise<RecordsListResult> {
    return this.run("recordsList", query);
  }

  /**
   * Runs `DELETE /api/v2/review/{id}`.
   * @replaces review.records.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("recordsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/review/{id}`.
   * @replaces review.records.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  recordsUpdate(
    id: string,
    input: RecordsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RecordsUpdateResult> {
    return this.run("recordsUpdate", id, input, ifMatch, idempotencyKey);
  }
}

export default ReviewController;
