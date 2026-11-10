/**
 * Host face of the media domain. It owns the `media` Remote namespace:
 * the asset center, visual and audio assets, image, video and speech generation, shot stills, renders, episode media, media sources and their reviews, byte verifications, playback, audio revisions, likeness subjects, rights and delivery evidence. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * media plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 *
 * Operations whose answer is not JSON keep their URL: the route plugins the
 * controller loads (`PlaybackContentRoute`) serve them.
 * @module @dramaip/production-media
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AssetCenterActionInput,
  AssetCenterActionResult,
  AssetCenterGetResult,
  AssetCenterPreviewResult,
  AssetsCreateInput,
  AssetsCreateResult,
  AssetsGetResult,
  AssetsListQuery,
  AssetsListResult,
  AssetsUpdateInput,
  AssetsUpdateResult,
  AudioRevisionsConfirmInput,
  AudioRevisionsConfirmResult,
  AudioRevisionsDiscardInput,
  AudioRevisionsDiscardResult,
  AudioRevisionsGetResult,
  AudioRevisionsListQuery,
  AudioRevisionsListResult,
  AudioRevisionsPreviewInput,
  AudioRevisionsPreviewResult,
  AudioRevisionsSummariesQuery,
  AudioRevisionsSummariesResult,
  AudioCreateInput,
  AudioCreateResult,
  AudioGetResult,
  AudioListQuery,
  AudioListResult,
  AudioUpdateInput,
  AudioUpdateResult,
  EpisodeAdoptAudioTrackResult,
  EpisodeAdoptVoiceProfileResult,
  EpisodeCreateAnimaticInput,
  EpisodeCreateAnimaticResult,
  EpisodeCreateAudioTrackInput,
  EpisodeCreateAudioTrackResult,
  EpisodeCreateVoiceProfileInput,
  EpisodeCreateVoiceProfileResult,
  EpisodeInitializeAnimaticResult,
  EpisodeListAnimaticsResult,
  EpisodeListAudioTracksResult,
  EpisodeListVoiceProfilesResult,
  EpisodeRenderPreflightResult,
  EpisodeReviewAnimaticInput,
  EpisodeReviewAnimaticResult,
  ImageGenerationRunInput,
  ImageGenerationRunResult,
  ImageCreateInput,
  ImageCreateResult,
  ImageGetResult,
  ImageListQuery,
  ImageListResult,
  ImageUpdateInput,
  ImageUpdateResult,
  LikenessSubjectsAttachPhotoInput,
  LikenessSubjectsAttachPhotoResult,
  LikenessSubjectsConsentInput,
  LikenessSubjectsConsentResult,
  LikenessSubjectsCreateInput,
  LikenessSubjectsCreateResult,
  LikenessSubjectsListResult,
  LikenessSubjectsReferencePreflightInput,
  LikenessSubjectsReferencePreflightResult,
  LikenessSubjectsRevokeResult,
  ByteVerificationsCreateInput,
  ByteVerificationsCreateResult,
  ByteVerificationsGetQuery,
  ByteVerificationsGetResult,
  ByteVerificationsListQuery,
  ByteVerificationsListResult,
  ByteVerificationsRecoverQuery,
  ByteVerificationsRecoverResult,
  PlaybackDescribeQuery,
  PlaybackDescribeResult,
  SourcesAdoptInput,
  SourcesAdoptResult,
  SourcesDiscardInput,
  SourcesDiscardResult,
  SourcesGetResult,
  SourcesListQuery,
  SourcesListResult,
  SourcesPreviewInput,
  SourcesPreviewResult,
  SourcesRecordResult,
  SourcesStatusResult,
  SourcesSummariesQuery,
  SourcesSummariesResult,
  DeliveryEvidenceQuery,
  DeliveryEvidenceResult,
  RendersCreateInput,
  RendersCreateResult,
  RendersGetResult,
  RendersListQuery,
  RendersListResult,
  RendersUpdateInput,
  RendersUpdateResult,
  RightsCreateInput,
  RightsCreateResult,
  RightsGetResult,
  RightsListQuery,
  RightsListResult,
  RightsUpdateInput,
  RightsUpdateResult,
  ShotStillsCreateInput,
  ShotStillsCreateResult,
  ShotStillsGetResult,
  ShotStillsListQuery,
  ShotStillsListResult,
  ShotStillsUpdateInput,
  ShotStillsUpdateResult,
  TtsGenerationRunInput,
  TtsGenerationRunResult,
  VideoGenerationBatchPreflightInput,
  VideoGenerationBatchPreflightResult,
  VideoGenerationCancelResult,
  VideoGenerationCreateInput,
  VideoGenerationCreateResult,
  VideoGenerationGetResult,
  VideoGenerationListByShotResult,
  VideoGenerationPreflightInput,
  VideoGenerationPreflightResult,
  VideoGenerationRefreshResult,
  VideoGenerationRetryInput,
  VideoGenerationRetryResult,
  VideoCreateInput,
  VideoCreateResult,
  VideoGetResult,
  VideoListQuery,
  VideoListResult,
  VideoUpdateInput,
  VideoUpdateResult,
  VisualAssetsCreateInput,
  VisualAssetsCreateResult,
  VisualAssetsGetResult,
  VisualAssetsListQuery,
  VisualAssetsListResult,
  VisualAssetsUpdateInput,
  VisualAssetsUpdateResult,
  VisualsAdoptStillResult,
  VisualsAdoptVideoResult,
  VisualsAdoptVisualAssetResult,
  VisualsLockVisualAssetResult,
} from "./types.ts";
import { mediaLegacyRoutes, type MediaLegacyMethod } from "./legacy.ts";
import { PlaybackContentRoute } from "./playback-content.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `media` Remote namespace. */
    mediaController: MediaController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  mediaLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.media` namespace. */
export class MediaController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "mediaController", { namespace: "media" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
    ctx.plugin(PlaybackContentRoute);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: MediaLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = mediaLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `POST /api/v2/asset-center/{id}/action`.
   * @replaces asset-center.action
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assetCenterAction(
    id: string,
    input: AssetCenterActionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssetCenterActionResult> {
    return this.run("assetCenterAction", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/asset-center`.
   * @replaces asset-center.get
   * @param id - the `id` path parameter.
   */
  @Remote
  assetCenterGet(id: string): Promise<AssetCenterGetResult> {
    return this.run("assetCenterGet", id);
  }

  /**
   * Runs `GET /api/v2/asset-center/{id}/preview`.
   * @replaces asset-center.preview
   * @param id - the `id` path parameter.
   */
  @Remote
  assetCenterPreview(id: string): Promise<AssetCenterPreviewResult> {
    return this.run("assetCenterPreview", id);
  }

  /**
   * Runs `POST /api/v2/assets`.
   * @replaces assets.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assetsCreate(
    input: AssetsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssetsCreateResult> {
    return this.run("assetsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/assets/{id}`.
   * @replaces assets.get
   * @param id - the `id` path parameter.
   */
  @Remote
  assetsGet(id: string): Promise<AssetsGetResult> {
    return this.run("assetsGet", id);
  }

  /**
   * Runs `GET /api/v2/assets`.
   * @replaces assets.list
   * @param query - the query parameters.
   */
  @Remote
  assetsList(query?: AssetsListQuery): Promise<AssetsListResult> {
    return this.run("assetsList", query);
  }

  /**
   * Runs `DELETE /api/v2/assets/{id}`.
   * @replaces assets.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assetsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("assetsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/assets/{id}`.
   * @replaces assets.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  assetsUpdate(
    id: string,
    input: AssetsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AssetsUpdateResult> {
    return this.run("assetsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Frozen author-controlled audio revision. Runs `POST /api/v2/audio-revisions/{id}/confirm`.
   * @replaces audio-revisions.confirm
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioRevisionsConfirm(
    id: string,
    input: AudioRevisionsConfirmInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioRevisionsConfirmResult> {
    return this.run(
      "audioRevisionsConfirm",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen author-controlled audio revision. Runs `POST /api/v2/audio-revisions/{id}/discard`.
   * @replaces audio-revisions.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioRevisionsDiscard(
    id: string,
    input: AudioRevisionsDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioRevisionsDiscardResult> {
    return this.run(
      "audioRevisionsDiscard",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Frozen author-controlled audio revision. Runs `GET /api/v2/audio-revisions/{id}`.
   * @replaces audio-revisions.get
   * @param id - the `id` path parameter.
   */
  @Remote
  audioRevisionsGet(id: string): Promise<AudioRevisionsGetResult> {
    return this.run("audioRevisionsGet", id);
  }

  /**
   * Frozen author-controlled audio revision. Runs `GET /api/v2/audio-tracks/{id}/revision-previews`.
   * @replaces audio-revisions.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  audioRevisionsList(
    id: string,
    query?: AudioRevisionsListQuery,
  ): Promise<AudioRevisionsListResult> {
    return this.run("audioRevisionsList", id, query);
  }

  /**
   * Frozen author-controlled audio revision. Runs `POST /api/v2/audio-tracks/{id}/revision-previews`.
   * @replaces audio-revisions.preview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioRevisionsPreview(
    id: string,
    input: AudioRevisionsPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioRevisionsPreviewResult> {
    return this.run(
      "audioRevisionsPreview",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Read-only, identity-only Media review summaries. Runs `GET /api/v2/projects/{projectId}/audio-revision-summaries`.
   * @replaces audio-revisions.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  audioRevisionsSummaries(
    projectId: string,
    query?: AudioRevisionsSummariesQuery,
  ): Promise<AudioRevisionsSummariesResult> {
    return this.run("audioRevisionsSummaries", projectId, query);
  }

  /**
   * Runs `POST /api/v2/audio`.
   * @replaces audio.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioCreate(
    input: AudioCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioCreateResult> {
    return this.run("audioCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/audio/{id}`.
   * @replaces audio.get
   * @param id - the `id` path parameter.
   */
  @Remote
  audioGet(id: string): Promise<AudioGetResult> {
    return this.run("audioGet", id);
  }

  /**
   * Runs `GET /api/v2/audio`.
   * @replaces audio.list
   * @param query - the query parameters.
   */
  @Remote
  audioList(query?: AudioListQuery): Promise<AudioListResult> {
    return this.run("audioList", query);
  }

  /**
   * Runs `DELETE /api/v2/audio/{id}`.
   * @replaces audio.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("audioRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/audio/{id}`.
   * @replaces audio.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioUpdate(
    id: string,
    input: AudioUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioUpdateResult> {
    return this.run("audioUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/audio-tracks/{id}/adopt`.
   * @replaces episode-media.adoptAudioTrack
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeAdoptAudioTrack(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeAdoptAudioTrackResult> {
    return this.run("episodeAdoptAudioTrack", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/voice-profiles/{id}/adopt`.
   * @replaces episode-media.adoptVoiceProfile
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeAdoptVoiceProfile(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeAdoptVoiceProfileResult> {
    return this.run("episodeAdoptVoiceProfile", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/animatics`.
   * @replaces episode-media.createAnimatic
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeCreateAnimatic(
    input: EpisodeCreateAnimaticInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeCreateAnimaticResult> {
    return this.run("episodeCreateAnimatic", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/audio-tracks`.
   * @replaces episode-media.createAudioTrack
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeCreateAudioTrack(
    input: EpisodeCreateAudioTrackInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeCreateAudioTrackResult> {
    return this.run("episodeCreateAudioTrack", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/voice-profiles`.
   * @replaces episode-media.createVoiceProfile
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeCreateVoiceProfile(
    input: EpisodeCreateVoiceProfileInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeCreateVoiceProfileResult> {
    return this.run(
      "episodeCreateVoiceProfile",
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/episodes/{id}/animatic-initialization`.
   * @replaces episode-media.initializeAnimatic
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeInitializeAnimatic(
    id: string,
  ): Promise<EpisodeInitializeAnimaticResult> {
    return this.run("episodeInitializeAnimatic", id);
  }

  /**
   * Runs `GET /api/v2/episodes/{id}/animatics`.
   * @replaces episode-media.listAnimatics
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeListAnimatics(id: string): Promise<EpisodeListAnimaticsResult> {
    return this.run("episodeListAnimatics", id);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/audio-tracks`.
   * @replaces episode-media.listAudioTracks
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  episodeListAudioTracks(
    episodeId: string,
  ): Promise<EpisodeListAudioTracksResult> {
    return this.run("episodeListAudioTracks", episodeId);
  }

  /**
   * Runs `GET /api/v2/projects/{id}/voice-profiles`.
   * @replaces episode-media.listVoiceProfiles
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeListVoiceProfiles(
    id: string,
  ): Promise<EpisodeListVoiceProfilesResult> {
    return this.run("episodeListVoiceProfiles", id);
  }

  /**
   * Runs `GET /api/v2/episodes/{id}/render-preflight`.
   * @replaces episode-media.renderPreflight
   * @param id - the `id` path parameter.
   */
  @Remote
  episodeRenderPreflight(id: string): Promise<EpisodeRenderPreflightResult> {
    return this.run("episodeRenderPreflight", id);
  }

  /**
   * Runs `POST /api/v2/animatics/{id}/review`.
   * @replaces episode-media.reviewAnimatic
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  episodeReviewAnimatic(
    id: string,
    input: EpisodeReviewAnimaticInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<EpisodeReviewAnimaticResult> {
    return this.run(
      "episodeReviewAnimatic",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/image-generation/runs`.
   * @replaces image-generation.run
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  imageGenerationRun(
    input: ImageGenerationRunInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImageGenerationRunResult> {
    return this.run("imageGenerationRun", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/image`.
   * @replaces image.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  imageCreate(
    input: ImageCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImageCreateResult> {
    return this.run("imageCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/image/{id}`.
   * @replaces image.get
   * @param id - the `id` path parameter.
   */
  @Remote
  imageGet(id: string): Promise<ImageGetResult> {
    return this.run("imageGet", id);
  }

  /**
   * Runs `GET /api/v2/image`.
   * @replaces image.list
   * @param query - the query parameters.
   */
  @Remote
  imageList(query?: ImageListQuery): Promise<ImageListResult> {
    return this.run("imageList", query);
  }

  /**
   * Runs `DELETE /api/v2/image/{id}`.
   * @replaces image.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  imageRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("imageRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/image/{id}`.
   * @replaces image.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  imageUpdate(
    id: string,
    input: ImageUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ImageUpdateResult> {
    return this.run("imageUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/likeness-subjects/{id}/photos`.
   * @replaces likenessSubjects.attachPhoto
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  likenessSubjectsAttachPhoto(
    id: string,
    input: LikenessSubjectsAttachPhotoInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LikenessSubjectsAttachPhotoResult> {
    return this.run(
      "likenessSubjectsAttachPhoto",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/likeness-subjects/{id}/consent`.
   * @replaces likenessSubjects.consent
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  likenessSubjectsConsent(
    id: string,
    input: LikenessSubjectsConsentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LikenessSubjectsConsentResult> {
    return this.run(
      "likenessSubjectsConsent",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/likeness-subjects`.
   * @replaces likenessSubjects.create
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  likenessSubjectsCreate(
    projectId: string,
    input: LikenessSubjectsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LikenessSubjectsCreateResult> {
    return this.run(
      "likenessSubjectsCreate",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/likeness-subjects`.
   * @replaces likenessSubjects.list
   * @param projectId - the `projectId` path parameter.
   */
  @Remote
  likenessSubjectsList(projectId: string): Promise<LikenessSubjectsListResult> {
    return this.run("likenessSubjectsList", projectId);
  }

  /**
   * Runs `POST /api/v2/projects/{projectId}/likeness-reference-preflight`.
   * @replaces likenessSubjects.referencePreflight
   * @param projectId - the `projectId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  likenessSubjectsReferencePreflight(
    projectId: string,
    input: LikenessSubjectsReferencePreflightInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LikenessSubjectsReferencePreflightResult> {
    return this.run(
      "likenessSubjectsReferencePreflight",
      projectId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/likeness-subjects/{id}/revoke`.
   * @replaces likenessSubjects.revoke
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  likenessSubjectsRevoke(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<LikenessSubjectsRevokeResult> {
    return this.run("likenessSubjectsRevoke", id, ifMatch, idempotencyKey);
  }

  /**
   * Historical complete-byte read observation, not current file, quality or rights verification. Runs `POST /api/v2/media-records/{id}/byte-verifications`.
   * @replaces media-byte-verifications.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  byteVerificationsCreate(
    id: string,
    input: ByteVerificationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ByteVerificationsCreateResult> {
    return this.run(
      "byteVerificationsCreate",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Historical complete-byte read observation, not current file, quality or rights verification. Runs `GET /api/v2/media-byte-verifications/{id}`.
   * @replaces media-byte-verifications.get
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  byteVerificationsGet(
    id: string,
    query: ByteVerificationsGetQuery,
  ): Promise<ByteVerificationsGetResult> {
    return this.run("byteVerificationsGet", id, query);
  }

  /**
   * Historical complete-byte read observation, not current file, quality or rights verification. Runs `GET /api/v2/media-records/{id}/byte-verifications`.
   * @replaces media-byte-verifications.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  byteVerificationsList(
    id: string,
    query: ByteVerificationsListQuery,
  ): Promise<ByteVerificationsListResult> {
    return this.run("byteVerificationsList", id, query);
  }

  /**
   * Historical complete-byte read observation, not current file, quality or rights verification. Runs `GET /api/v2/media-records/{id}/byte-verifications/requests/{key}`.
   * @replaces media-byte-verifications.recover
   * @param id - the `id` path parameter.
   * @param key - the `key` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  byteVerificationsRecover(
    id: string,
    key: string,
    query: ByteVerificationsRecoverQuery,
  ): Promise<ByteVerificationsRecoverResult> {
    return this.run("byteVerificationsRecover", id, key, query);
  }

  /**
   * Owner metadata only, not a file verification. Runs `GET /api/v2/media-records/{id}/playback`.
   * @replaces media-playback.describe
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  playbackDescribe(
    id: string,
    query: PlaybackDescribeQuery,
  ): Promise<PlaybackDescribeResult> {
    return this.run("playbackDescribe", id, query);
  }

  /**
   * Owner-verified source metadata. Runs `POST /api/v2/media-source-reviews/{id}/adopt`.
   * @replaces media-sources.adopt
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourcesAdopt(
    id: string,
    input: SourcesAdoptInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SourcesAdoptResult> {
    return this.run("sourcesAdopt", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Owner-verified source metadata. Runs `POST /api/v2/media-source-reviews/{id}/discard`.
   * @replaces media-sources.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourcesDiscard(
    id: string,
    input: SourcesDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SourcesDiscardResult> {
    return this.run("sourcesDiscard", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Owner-verified source metadata. Runs `GET /api/v2/media-source-reviews/{id}`.
   * @replaces media-sources.get
   * @param id - the `id` path parameter.
   */
  @Remote
  sourcesGet(id: string): Promise<SourcesGetResult> {
    return this.run("sourcesGet", id);
  }

  /**
   * Owner-verified source metadata. Runs `GET /api/v2/media-records/{id}/source-reviews`.
   * @replaces media-sources.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  sourcesList(
    id: string,
    query?: SourcesListQuery,
  ): Promise<SourcesListResult> {
    return this.run("sourcesList", id, query);
  }

  /**
   * Owner-verified source metadata. Runs `POST /api/v2/media-records/{id}/source-reviews`.
   * @replaces media-sources.preview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  sourcesPreview(
    id: string,
    input: SourcesPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<SourcesPreviewResult> {
    return this.run("sourcesPreview", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Owner-verified source metadata. Runs `GET /api/v2/media-records/{id}`.
   * @replaces media-sources.record
   * @param id - the `id` path parameter.
   */
  @Remote
  sourcesRecord(id: string): Promise<SourcesRecordResult> {
    return this.run("sourcesRecord", id);
  }

  /**
   * Owner-verified source metadata. Runs `GET /api/v2/media-records/{id}/source`.
   * @replaces media-sources.status
   * @param id - the `id` path parameter.
   */
  @Remote
  sourcesStatus(id: string): Promise<SourcesStatusResult> {
    return this.run("sourcesStatus", id);
  }

  /**
   * Read-only, identity-only Media review summaries. Runs `GET /api/v2/projects/{projectId}/media-source-review-summaries`.
   * @replaces media-sources.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  sourcesSummaries(
    projectId: string,
    query?: SourcesSummariesQuery,
  ): Promise<SourcesSummariesResult> {
    return this.run("sourcesSummaries", projectId, query);
  }

  /**
   * Exact Media metadata only, never legal/quality/settlement or current byte approval. Runs `GET /api/v2/media-records/{id}/delivery-evidence`.
   * @replaces media.deliveryEvidence
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  deliveryEvidence(
    id: string,
    query: DeliveryEvidenceQuery,
  ): Promise<DeliveryEvidenceResult> {
    return this.run("deliveryEvidence", id, query);
  }

  /**
   * Runs `POST /api/v2/renders`.
   * @replaces renders.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rendersCreate(
    input: RendersCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RendersCreateResult> {
    return this.run("rendersCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/renders/{id}`.
   * @replaces renders.get
   * @param id - the `id` path parameter.
   */
  @Remote
  rendersGet(id: string): Promise<RendersGetResult> {
    return this.run("rendersGet", id);
  }

  /**
   * Runs `GET /api/v2/renders`.
   * @replaces renders.list
   * @param query - the query parameters.
   */
  @Remote
  rendersList(query?: RendersListQuery): Promise<RendersListResult> {
    return this.run("rendersList", query);
  }

  /**
   * Runs `DELETE /api/v2/renders/{id}`.
   * @replaces renders.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rendersRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("rendersRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/renders/{id}`.
   * @replaces renders.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rendersUpdate(
    id: string,
    input: RendersUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RendersUpdateResult> {
    return this.run("rendersUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/rights`.
   * @replaces rights.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rightsCreate(
    input: RightsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RightsCreateResult> {
    return this.run("rightsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/rights/{id}`.
   * @replaces rights.get
   * @param id - the `id` path parameter.
   */
  @Remote
  rightsGet(id: string): Promise<RightsGetResult> {
    return this.run("rightsGet", id);
  }

  /**
   * Runs `GET /api/v2/rights`.
   * @replaces rights.list
   * @param query - the query parameters.
   */
  @Remote
  rightsList(query?: RightsListQuery): Promise<RightsListResult> {
    return this.run("rightsList", query);
  }

  /**
   * Runs `DELETE /api/v2/rights/{id}`.
   * @replaces rights.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rightsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("rightsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/rights/{id}`.
   * @replaces rights.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  rightsUpdate(
    id: string,
    input: RightsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RightsUpdateResult> {
    return this.run("rightsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/shot-stills`.
   * @replaces shot-stills.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotStillsCreate(
    input: ShotStillsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ShotStillsCreateResult> {
    return this.run("shotStillsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/shot-stills/{id}`.
   * @replaces shot-stills.get
   * @param id - the `id` path parameter.
   */
  @Remote
  shotStillsGet(id: string): Promise<ShotStillsGetResult> {
    return this.run("shotStillsGet", id);
  }

  /**
   * Runs `GET /api/v2/shot-stills`.
   * @replaces shot-stills.list
   * @param query - the query parameters.
   */
  @Remote
  shotStillsList(query?: ShotStillsListQuery): Promise<ShotStillsListResult> {
    return this.run("shotStillsList", query);
  }

  /**
   * Runs `DELETE /api/v2/shot-stills/{id}`.
   * @replaces shot-stills.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotStillsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("shotStillsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/shot-stills/{id}`.
   * @replaces shot-stills.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  shotStillsUpdate(
    id: string,
    input: ShotStillsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ShotStillsUpdateResult> {
    return this.run("shotStillsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/tts-generation/runs`.
   * @replaces tts-generation.run
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  ttsGenerationRun(
    input: TtsGenerationRunInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TtsGenerationRunResult> {
    return this.run("ttsGenerationRun", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/projects/{id}/video-generation/batch-preflight`.
   * @replaces video-generation.batchPreflight
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationBatchPreflight(
    id: string,
    input: VideoGenerationBatchPreflightInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationBatchPreflightResult> {
    return this.run(
      "videoGenerationBatchPreflight",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/video-generation/runs/{id}/cancel`.
   * @replaces video-generation.cancel
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationCancel(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationCancelResult> {
    return this.run("videoGenerationCancel", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/video-generation/runs`.
   * @replaces video-generation.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationCreate(
    input: VideoGenerationCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationCreateResult> {
    return this.run("videoGenerationCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/video-generation/runs/{id}`.
   * @replaces video-generation.get
   * @param id - the `id` path parameter.
   */
  @Remote
  videoGenerationGet(id: string): Promise<VideoGenerationGetResult> {
    return this.run("videoGenerationGet", id);
  }

  /**
   * Runs `GET /api/v2/shots/{id}/video-generation/runs`.
   * @replaces video-generation.listByShot
   * @param id - the `id` path parameter.
   */
  @Remote
  videoGenerationListByShot(
    id: string,
  ): Promise<VideoGenerationListByShotResult> {
    return this.run("videoGenerationListByShot", id);
  }

  /**
   * Runs `POST /api/v2/shots/{id}/video-generation/preflight`.
   * @replaces video-generation.preflight
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationPreflight(
    id: string,
    input: VideoGenerationPreflightInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationPreflightResult> {
    return this.run(
      "videoGenerationPreflight",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/video-generation/runs/{id}/refresh`.
   * @replaces video-generation.refresh
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationRefresh(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationRefreshResult> {
    return this.run("videoGenerationRefresh", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/video-generation/runs/{id}/retry`.
   * @replaces video-generation.retry
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoGenerationRetry(
    id: string,
    input: VideoGenerationRetryInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoGenerationRetryResult> {
    return this.run("videoGenerationRetry", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/video`.
   * @replaces video.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoCreate(
    input: VideoCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoCreateResult> {
    return this.run("videoCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/video/{id}`.
   * @replaces video.get
   * @param id - the `id` path parameter.
   */
  @Remote
  videoGet(id: string): Promise<VideoGetResult> {
    return this.run("videoGet", id);
  }

  /**
   * Runs `GET /api/v2/video`.
   * @replaces video.list
   * @param query - the query parameters.
   */
  @Remote
  videoList(query?: VideoListQuery): Promise<VideoListResult> {
    return this.run("videoList", query);
  }

  /**
   * Runs `DELETE /api/v2/video/{id}`.
   * @replaces video.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("videoRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/video/{id}`.
   * @replaces video.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  videoUpdate(
    id: string,
    input: VideoUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VideoUpdateResult> {
    return this.run("videoUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/visual-assets`.
   * @replaces visual-assets.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualAssetsCreate(
    input: VisualAssetsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualAssetsCreateResult> {
    return this.run("visualAssetsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/visual-assets/{id}`.
   * @replaces visual-assets.get
   * @param id - the `id` path parameter.
   */
  @Remote
  visualAssetsGet(id: string): Promise<VisualAssetsGetResult> {
    return this.run("visualAssetsGet", id);
  }

  /**
   * Runs `GET /api/v2/visual-assets`.
   * @replaces visual-assets.list
   * @param query - the query parameters.
   */
  @Remote
  visualAssetsList(
    query?: VisualAssetsListQuery,
  ): Promise<VisualAssetsListResult> {
    return this.run("visualAssetsList", query);
  }

  /**
   * Runs `DELETE /api/v2/visual-assets/{id}`.
   * @replaces visual-assets.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualAssetsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("visualAssetsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/visual-assets/{id}`.
   * @replaces visual-assets.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualAssetsUpdate(
    id: string,
    input: VisualAssetsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualAssetsUpdateResult> {
    return this.run("visualAssetsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/shot-stills/{id}/adopt`.
   * @replaces visuals.adoptStill
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualsAdoptStill(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualsAdoptStillResult> {
    return this.run("visualsAdoptStill", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/videos/{id}/adopt`.
   * @replaces visuals.adoptVideo
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualsAdoptVideo(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualsAdoptVideoResult> {
    return this.run("visualsAdoptVideo", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/visual-assets/{id}/adopt`.
   * @replaces visuals.adoptVisualAsset
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualsAdoptVisualAsset(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualsAdoptVisualAssetResult> {
    return this.run("visualsAdoptVisualAsset", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/visual-assets/{id}/lock`.
   * @replaces visuals.lockVisualAsset
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  visualsLockVisualAsset(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<VisualsLockVisualAssetResult> {
    return this.run("visualsLockVisualAsset", id, ifMatch, idempotencyKey);
  }
}

export default MediaController;
