/**
 * Host face of the timeline domain. It owns the `timeline` Remote namespace:
 * timelines and their tracks, render preflight, renders and their events, playback plans, delivery manifests, audio resolutions and timeline media copies. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * timeline plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/production-timeline
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AudioResolutionsConfirmInput,
  AudioResolutionsConfirmResult,
  AudioResolutionsDiscardInput,
  AudioResolutionsDiscardResult,
  AudioResolutionsGetResult,
  AudioResolutionsListQuery,
  AudioResolutionsListResult,
  AudioResolutionsOptionsResult,
  AudioResolutionsPreviewInput,
  AudioResolutionsPreviewResult,
  AudioResolutionsSummariesQuery,
  AudioResolutionsSummariesResult,
  MediaCopiesCancelInput,
  MediaCopiesCancelResult,
  MediaCopiesCreateInput,
  MediaCopiesCreateResult,
  MediaCopiesGetQuery,
  MediaCopiesGetResult,
  MediaCopiesListQuery,
  MediaCopiesListResult,
  MediaCopiesRefreshInput,
  MediaCopiesRefreshResult,
  MediaCopiesRevealInput,
  MediaCopiesRevealResult,
  MediaCopiesSelectDirectoryInput,
  MediaCopiesSelectDirectoryResult,
  ApplyAudioAssemblyInput,
  ApplyAudioAssemblyResult,
  AudioAssemblyPreviewResult,
  CancelRenderResult,
  CommandInput,
  CommandResult,
  CreateRenderInput,
  CreateRenderResult,
  DeliveryManifestResult,
  ExportDeliveryResult,
  GetResult,
  GetRenderResult,
  HistoryResult,
  PlaybackPlanQuery,
  PlaybackPlanResult,
  PreviewResult,
  RedoResult,
  RenderCatalogQuery,
  RenderCatalogResult,
  RenderEventsEvent,
  RenderPreflightQuery,
  RenderPreflightResult,
  RetryRenderInput,
  RetryRenderResult,
  UndoResult,
} from "./types.ts";
import { timelineLegacyRoutes, type TimelineLegacyMethod } from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `timeline` Remote namespace. */
    timelineController: TimelineController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  timelineLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.timeline` namespace. */
export class TimelineController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "timelineController", { namespace: "timeline" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: TimelineLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = timelineLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /** Read the events of the streaming operation behind `method`. */
  private stream<T>(
    method: TimelineLegacyMethod,
    signal: AbortSignal,
    ...args: readonly unknown[]
  ): AsyncIterable<T> {
    const route = timelineLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.stream(
      route.operationId,
      compatCallOf(route, args),
      signal,
    ) as AsyncIterable<T>;
  }

  /**
   * Explicit, frozen audio resolution. Runs `POST /api/v2/audio-resolutions/{id}/confirm`.
   * @replaces audio-resolutions.confirm
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioResolutionsConfirm(
    id: string,
    input: AudioResolutionsConfirmInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioResolutionsConfirmResult> {
    return this.run(
      "audioResolutionsConfirm",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicit, frozen audio resolution. Runs `POST /api/v2/audio-resolutions/{id}/discard`.
   * @replaces audio-resolutions.discard
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioResolutionsDiscard(
    id: string,
    input: AudioResolutionsDiscardInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioResolutionsDiscardResult> {
    return this.run(
      "audioResolutionsDiscard",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Explicit, frozen audio resolution. Runs `GET /api/v2/audio-resolutions/{id}`.
   * @replaces audio-resolutions.get
   * @param id - the `id` path parameter.
   */
  @Remote
  audioResolutionsGet(id: string): Promise<AudioResolutionsGetResult> {
    return this.run("audioResolutionsGet", id);
  }

  /**
   * Explicit, frozen audio resolution. Runs `GET /api/v2/timelines/{id}/audio-resolution-previews`.
   * @replaces audio-resolutions.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  audioResolutionsList(
    id: string,
    query?: AudioResolutionsListQuery,
  ): Promise<AudioResolutionsListResult> {
    return this.run("audioResolutionsList", id, query);
  }

  /**
   * Explicit, frozen audio resolution. Runs `GET /api/v2/timelines/{id}/audio-source-options`.
   * @replaces audio-resolutions.options
   * @param id - the `id` path parameter.
   */
  @Remote
  audioResolutionsOptions(id: string): Promise<AudioResolutionsOptionsResult> {
    return this.run("audioResolutionsOptions", id);
  }

  /**
   * Explicit, frozen audio resolution. Runs `POST /api/v2/timelines/{id}/audio-resolution-previews`.
   * @replaces audio-resolutions.preview
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  audioResolutionsPreview(
    id: string,
    input: AudioResolutionsPreviewInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AudioResolutionsPreviewResult> {
    return this.run(
      "audioResolutionsPreview",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Identity-only actual Timeline resolution summaries. Runs `GET /api/v2/projects/{projectId}/audio-resolution-summaries`.
   * @replaces audio-resolutions.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  audioResolutionsSummaries(
    projectId: string,
    query?: AudioResolutionsSummariesQuery,
  ): Promise<AudioResolutionsSummariesResult> {
    return this.run("audioResolutionsSummaries", projectId, query);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `POST /api/v2/timeline-media-copies/{id}/cancel`.
   * @replaces timeline-media-copies.cancel
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCopiesCancel(
    id: string,
    input: MediaCopiesCancelInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCopiesCancelResult> {
    return this.run("mediaCopiesCancel", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `POST /api/v2/timelines/{id}/media-copies`.
   * @replaces timeline-media-copies.create
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCopiesCreate(
    id: string,
    input: MediaCopiesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCopiesCreateResult> {
    return this.run("mediaCopiesCreate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `GET /api/v2/timeline-media-copies/{id}`.
   * @replaces timeline-media-copies.get
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaCopiesGet(
    id: string,
    query: MediaCopiesGetQuery,
  ): Promise<MediaCopiesGetResult> {
    return this.run("mediaCopiesGet", id, query);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `GET /api/v2/timelines/{id}/media-copies`.
   * @replaces timeline-media-copies.list
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  mediaCopiesList(
    id: string,
    query: MediaCopiesListQuery,
  ): Promise<MediaCopiesListResult> {
    return this.run("mediaCopiesList", id, query);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `POST /api/v2/timeline-media-copies/{id}/refresh`.
   * @replaces timeline-media-copies.refresh
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCopiesRefresh(
    id: string,
    input: MediaCopiesRefreshInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCopiesRefreshResult> {
    return this.run("mediaCopiesRefresh", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `POST /api/v2/timeline-media-copies/{id}/reveal`.
   * @replaces timeline-media-copies.reveal
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCopiesReveal(
    id: string,
    input: MediaCopiesRevealInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCopiesRevealResult> {
    return this.run("mediaCopiesReveal", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Original local-copy observation, not current integrity or delivery quality. Runs `POST /api/v2/timelines/{id}/media-copy-directory`.
   * @replaces timeline-media-copies.selectDirectory
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  mediaCopiesSelectDirectory(
    id: string,
    input: MediaCopiesSelectDirectoryInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<MediaCopiesSelectDirectoryResult> {
    return this.run(
      "mediaCopiesSelectDirectory",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/episodes/{episodeId}/audio-assembly/apply`.
   * @replaces timeline.applyAudioAssembly
   * @param episodeId - the `episodeId` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  applyAudioAssembly(
    episodeId: string,
    input: ApplyAudioAssemblyInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ApplyAudioAssemblyResult> {
    return this.run(
      "applyAudioAssembly",
      episodeId,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/audio-assembly/preview`.
   * @replaces timeline.audioAssemblyPreview
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  audioAssemblyPreview(episodeId: string): Promise<AudioAssemblyPreviewResult> {
    return this.run("audioAssemblyPreview", episodeId);
  }

  /**
   * Runs `POST /api/v2/timeline-renders/{id}/cancel`.
   * @replaces timeline.cancelRender
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  cancelRender(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CancelRenderResult> {
    return this.run("cancelRender", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/timelines/{id}/commands`.
   * @replaces timeline.command
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  command(
    id: string,
    input: CommandInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CommandResult> {
    return this.run("command", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/timelines/{id}/renders`.
   * @replaces timeline.createRender
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  createRender(
    id: string,
    input: CreateRenderInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreateRenderResult> {
    return this.run("createRender", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/timeline-delivery/manifest`.
   * @replaces timeline.deliveryManifest
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  deliveryManifest(episodeId: string): Promise<DeliveryManifestResult> {
    return this.run("deliveryManifest", episodeId);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/timeline-delivery/export/{format}`.
   * @replaces timeline.exportDelivery
   * @param episodeId - the `episodeId` path parameter.
   * @param format - the `format` path parameter.
   */
  @Remote
  exportDelivery(
    episodeId: string,
    format: "manifest" | "fcpxml" | "otio" | "edl" | "srt" | "vtt" | "relink",
  ): Promise<ExportDeliveryResult> {
    return this.run("exportDelivery", episodeId, format);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/timeline`.
   * @replaces timeline.get
   * @param episodeId - the `episodeId` path parameter.
   */
  @Remote
  get(episodeId: string): Promise<GetResult> {
    return this.run("get", episodeId);
  }

  /**
   * Runs `GET /api/v2/timeline-renders/{id}`.
   * @replaces timeline.getRender
   * @param id - the `id` path parameter.
   */
  @Remote
  getRender(id: string): Promise<GetRenderResult> {
    return this.run("getRender", id);
  }

  /**
   * Runs `GET /api/v2/timelines/{id}/history`.
   * @replaces timeline.history
   * @param id - the `id` path parameter.
   */
  @Remote
  history(id: string): Promise<HistoryResult> {
    return this.run("history", id);
  }

  /**
   * Exact timeline and frozen source proof, not actual bytes or quality. Runs `GET /api/v2/timelines/{id}/playback-plan`.
   * @replaces timeline.playbackPlan
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  playbackPlan(
    id: string,
    query: PlaybackPlanQuery,
  ): Promise<PlaybackPlanResult> {
    return this.run("playbackPlan", id, query);
  }

  /**
   * Runs `GET /api/v2/timeline-media/{id}/preview`.
   * @replaces timeline.preview
   * @param id - the `id` path parameter.
   */
  @Remote
  preview(id: string): Promise<PreviewResult> {
    return this.run("preview", id);
  }

  /**
   * Runs `POST /api/v2/timelines/{id}/redo`.
   * @replaces timeline.redo
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  redo(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RedoResult> {
    return this.run("redo", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/episodes/{episodeId}/timeline-renders`.
   * @replaces timeline.renderCatalog
   * @param episodeId - the `episodeId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  renderCatalog(
    episodeId: string,
    query: RenderCatalogQuery,
  ): Promise<RenderCatalogResult> {
    return this.run("renderCatalog", episodeId, query);
  }

  /**
   * The events the handler of `GET /api/v2/timeline-renders/{id}/events` writes, replayed after
   * `cursor` and then live, until the caller cancels.
   * @replaces timeline.renderEvents
   * @param id - the `id` path parameter.
   * @param cursor - the last event cursor seen (the original `Last-Event-ID`); 0 for the whole log.
   * @param signal - stream cancellation.
   */
  @Remote({ mode: "stream" })
  async *renderEvents(
    id: string,
    cursor: number,
    signal: AbortSignal,
  ): AsyncIterable<RenderEventsEvent> {
    yield* this.stream<RenderEventsEvent>("renderEvents", signal, id, cursor);
  }

  /**
   * Runs `GET /api/v2/timelines/{id}/render-preflight`.
   * @replaces timeline.renderPreflight
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  renderPreflight(
    id: string,
    query?: RenderPreflightQuery,
  ): Promise<RenderPreflightResult> {
    return this.run("renderPreflight", id, query);
  }

  /**
   * Runs `POST /api/v2/timeline-renders/{id}/retry`.
   * @replaces timeline.retryRender
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  retryRender(
    id: string,
    input: RetryRenderInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RetryRenderResult> {
    return this.run("retryRender", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/timelines/{id}/undo`.
   * @replaces timeline.undo
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  undo(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<UndoResult> {
    return this.run("undo", id, ifMatch, idempotencyKey);
  }
}

export default TimelineController;
