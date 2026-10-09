import {
  createStudioClient as createBaseClient,
  type StudioClient as BaseClient,
  type StudioClientOptions,
} from "./generated.js";
import {
  createGeneratedOpenApiClient,
  requestGeneratedApi,
} from "./openapi-client.js";
import { asApiError, StudioClientError } from "./errors.js";
import {
  createWritingVolumesClient,
  type WritingVolumesClient,
} from "./writing-volumes.js";
import {
  createSourceImportClient,
  type SourceImportClient,
} from "./source-imports.js";
import {
  createAgentUsageClient,
  type AgentUsageClient,
} from "./agent-usage.js";
import {
  createCreationExecutionClient,
  type CreationExecutionClient,
} from "./creation-execution.js";
import { createCreationWorkflowClient } from "./creation-workflows.js";
import {
  createNovelRevisionEffortClient,
  type NovelRevisionEffortClient,
} from "./novel-revision-effort.js";
import {
  createPreviewRevisionEffortClient,
  type PreviewRevisionEffortClient,
} from "./preview-revision-effort.js";
import {
  createGenerationCostsClient,
  type GenerationCostsClient,
} from "./generation-costs.js";
import {
  createCreativeOutcomeClient,
  type CreativeOutcomeClient,
} from "./creative-outcomes.js";
import {
  createTimelineRenderClient,
  type TimelineRenderClient,
} from "./timeline-renders.js";
import {
  createTimelineMediaCopyClient,
  type TimelineMediaCopyClient,
} from "./timeline-media-copies.js";
import {
  createAdaptationStrategyClient,
  type AdaptationStrategyClient,
} from "./adaptation-strategies.js";
import {
  createMediaPlaybackClient,
  type MediaPlaybackClient,
} from "./media-playback.js";
import {
  createStoryIntelligenceClient,
  type StoryIntelligenceClient,
} from "./story-intelligence.js";
import {
  createStoryDeclarationsClient,
  type StoryDeclarationsClient,
} from "./story-declarations.js";
import {
  createStoryAssertionsClient,
  type StoryAssertionsClient,
} from "./story-assertions.js";
import {
  createScreenplaySourcesClient,
  type ScreenplaySourcesClient,
} from "./screenplay-sources.js";
import {
  createProductionQualitySourcesClient,
  type ProductionQualitySourcesClient,
} from "./production-quality-sources.js";
import {
  createStoryboardAttributionsClient,
  type StoryboardAttributionsClient,
} from "./storyboard-attributions.js";
import type {
  AudioAssemblyApplyInput,
  TimelineManifest,
  AudioResolution,
  AudioResolutionInput,
  AudioResolutionConfirmation,
  AudioResolutionOptions,
  AudioResolutionPage,
  AudioResolutionSummaryPage,
  TimelinePlaybackPlan,
} from "@dramaip/contracts/timeline";
import { TimelinePlaybackPlanSchema } from "@dramaip/contracts/timeline";
import {
  NarrativeStoryIndexSchema,
  type NarrativeStoryIndex,
} from "@dramaip/contracts/knowledge";
import {
  ProviderActionPreviewSummaryPageSchema,
  type ProviderActionPreviewSummaryPage,
} from "@dramaip/contracts/automation";
import type {
  MediaRecord,
  MediaSourceStatus,
  MediaSourceReview,
  MediaSourceReviewInput,
  MediaSourceReviewConfirmation,
  MediaSourceReviewPage,
  AudioTrack,
  AudioRevision,
  AudioRevisionInput,
  AudioRevisionConfirmation,
  AudioRevisionPage,
  AudioRevisionSummaryPage,
  MediaSourceReviewSummaryPage,
} from "@dramaip/contracts/media";

/** Hand-maintained SDK composition; OpenAPI output remains generator-owned. */
export interface StudioClient extends Omit<
  BaseClient,
  "episodeMedia" | "timeline" | "storyIntelligence" | "sourceImports"
> {
  sourceImports: SourceImportClient;
  writingVolumes: WritingVolumesClient;
  storyIntelligence: StoryIntelligenceClient;
  agentUsage: AgentUsageClient;
  creationExecution: CreationExecutionClient;
  novelRevisionEffort: NovelRevisionEffortClient;
  previewRevisionEffort: PreviewRevisionEffortClient;
  generationCosts: GenerationCostsClient;
  storyDeclarations: StoryDeclarationsClient;
  storyAssertions: StoryAssertionsClient;
  screenplaySources: ScreenplaySourcesClient;
  productionQualitySources: ProductionQualitySourcesClient;
  storyboardAttributions: StoryboardAttributionsClient;
  mediaPlayback: MediaPlaybackClient;
  adaptationStrategies: AdaptationStrategyClient;
  creativeOutcomes: CreativeOutcomeClient;
  timelineRenders: TimelineRenderClient;
  timelineMediaCopies: TimelineMediaCopyClient;
  narrativeStoryIndex: {
    catalog(projectId: string): Promise<NarrativeStoryIndex>;
  };
  providerActionPreviews: BaseClient["providerActionPreviews"] & {
    summaries(
      projectId: string,
      cursor?: string,
      limit?: number,
    ): Promise<ProviderActionPreviewSummaryPage>;
  };
  timeline: Omit<
    BaseClient["timeline"],
    "applyAudioAssembly" | "playbackPlan"
  > & {
    playbackPlan(
      id: string,
      projectId: string,
      version: number,
      signal?: AbortSignal,
    ): Promise<TimelinePlaybackPlan>;
    applyAudioAssembly(
      episodeId: string,
      input: AudioAssemblyApplyInput,
      key: string,
    ): Promise<TimelineManifest>;
  };
  episodeMedia: Omit<BaseClient["episodeMedia"], "adoptAudioTrack"> & {
    adoptAudioTrack(
      id: string,
      version: number,
      key: string,
    ): Promise<AudioTrack>;
  };
  audioRevisions: {
    summaries(
      projectId: string,
      cursor?: string,
      limit?: number,
    ): Promise<AudioRevisionSummaryPage>;
    list(
      trackId: string,
      cursor?: string,
      limit?: number,
    ): Promise<AudioRevisionPage>;
    get(id: string): Promise<AudioRevision>;
    preview(
      trackId: string,
      input: AudioRevisionInput,
      key: string,
    ): Promise<AudioRevision>;
    confirm(
      id: string,
      version: number,
      input: AudioRevisionConfirmation,
      key: string,
    ): Promise<AudioRevision>;
    discard(id: string, version: number, key: string): Promise<AudioRevision>;
  };
  audioResolutions: {
    summaries(
      projectId: string,
      cursor?: string,
      limit?: number,
    ): Promise<AudioResolutionSummaryPage>;
    options(timelineId: string): Promise<AudioResolutionOptions>;
    list(
      timelineId: string,
      cursor?: string,
      limit?: number,
    ): Promise<AudioResolutionPage>;
    get(id: string): Promise<AudioResolution>;
    preview(
      timelineId: string,
      input: AudioResolutionInput,
      key: string,
    ): Promise<AudioResolution>;
    confirm(
      id: string,
      version: number,
      input: AudioResolutionConfirmation,
      key: string,
    ): Promise<AudioResolution>;
    discard(id: string, version: number, key: string): Promise<AudioResolution>;
  };
  mediaSources: {
    record(id: string, signal?: AbortSignal): Promise<MediaRecord>;
    summaries(
      projectId: string,
      cursor?: string,
      limit?: number,
    ): Promise<MediaSourceReviewSummaryPage>;
    status(recordId: string): Promise<MediaSourceStatus>;
    list(
      recordId: string,
      cursor?: string,
      limit?: number,
    ): Promise<MediaSourceReviewPage>;
    get(id: string): Promise<MediaSourceReview>;
    preview(
      recordId: string,
      input: MediaSourceReviewInput,
      key: string,
    ): Promise<MediaSourceReview>;
    adopt(
      id: string,
      version: number,
      input: MediaSourceReviewConfirmation,
      key: string,
    ): Promise<MediaSourceReview>;
    discard(
      id: string,
      version: number,
      key: string,
    ): Promise<MediaSourceReview>;
  };
}
export function createStudioClient(options: StudioClientOptions): StudioClient {
  const generated = createGeneratedOpenApiClient(options);
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const { response, data, error } = await requestGeneratedApi(
      generated,
      path,
      init,
    );
    if (!response.ok)
      throw new StudioClientError(response.status, asApiError(error));
    return data as T;
  };
  const path = (id: string) =>
    `/api/v2/media-records/${encodeURIComponent(id)}`;
  const reviewPath = (id: string) =>
    `/api/v2/media-source-reviews/${encodeURIComponent(id)}`;
  const base = createBaseClient(options);
  const summaries = <T>(
    projectId: string,
    name: string,
    cursor?: string,
    limit?: number,
  ) => {
    const query = new URLSearchParams();
    if (cursor) query.set("cursor", cursor);
    if (limit !== undefined) query.set("limit", String(limit));
    return request<T>(
      `/api/v2/projects/${encodeURIComponent(projectId)}/${name}${query.size ? `?${query}` : ""}`,
    );
  };
  return {
    ...base,
    creation: createCreationWorkflowClient(base.creation),
    narrativeStoryIndex: {
      catalog: async (projectId) => {
        const value = NarrativeStoryIndexSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-story-index`,
          ),
        );
        if (
          value.projectId !== projectId ||
          value.entries.some((entry) => entry.projectId !== projectId) ||
          new Set(
            value.entries.map(
              (entry) => `${entry.selection.kind}:${entry.selection.id}`,
            ),
          ).size !== value.entries.length
        )
          throw new Error(
            "叙事索引项目或声明身份无法核对，未使用其他项目或重复目录。",
          );
        return value;
      },
    },
    providerActionPreviews: {
      ...base.providerActionPreviews,
      summaries: async (projectId, cursor, limit) => {
        const query = new URLSearchParams();
        if (cursor) query.set("cursor", cursor);
        if (limit !== undefined) query.set("limit", String(limit));
        const page = ProviderActionPreviewSummaryPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/provider-action-preview-summaries${query.size ? `?${query}` : ""}`,
          ),
        );
        if (
          page.projectId !== projectId ||
          page.items.some((item) => item.projectId !== projectId) ||
          new Set(page.items.map((item) => item.id)).size !==
            page.items.length ||
          (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id)
        )
          throw new Error(
            "费用确认摘要归属、身份或游标无法核对，未使用其他项目。",
          );
        return page;
      },
    },
    writingVolumes: createWritingVolumesClient(request),
    sourceImports: createSourceImportClient(request, base.sourceImports),
    agentUsage: createAgentUsageClient(request),
    creationExecution: createCreationExecutionClient(request),
    novelRevisionEffort: createNovelRevisionEffortClient(request),
    previewRevisionEffort: createPreviewRevisionEffortClient(request),
    generationCosts: createGenerationCostsClient(request),
    storyIntelligence: createStoryIntelligenceClient(request),
    storyDeclarations: createStoryDeclarationsClient(request),
    storyAssertions: createStoryAssertionsClient(request),
    screenplaySources: createScreenplaySourcesClient(request),
    productionQualitySources: createProductionQualitySourcesClient(request),
    storyboardAttributions: createStoryboardAttributionsClient(request),
    adaptationStrategies: createAdaptationStrategyClient(request),
    creativeOutcomes: createCreativeOutcomeClient(request),
    mediaPlayback: createMediaPlaybackClient(options),
    timelineRenders: createTimelineRenderClient(request),
    timelineMediaCopies: createTimelineMediaCopyClient(request),
    timeline: {
      ...base.timeline,
      playbackPlan: async (id, projectId, version, signal) => {
        const query = new URLSearchParams({
          projectId,
          timelineVersion: String(version),
        });
        const value = TimelinePlaybackPlanSchema.parse(
          await request(
            `/api/v2/timelines/${encodeURIComponent(id)}/playback-plan?${query}`,
            { signal },
          ),
        );
        if (
          value.timeline.id !== id ||
          value.timeline.projectId !== projectId ||
          value.timeline.version !== version
        )
          throw new Error("实际时间线身份或版本无法核对。");
        return value;
      },
      applyAudioAssembly: (episodeId, input, key) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/audio-assembly/apply`,
          {
            method: "POST",
            headers: {
              "If-Match": `"timeline:${input.timelineId}:${input.timelineVersion}"`,
              "Idempotency-Key": key,
            },
            body: JSON.stringify(input),
          },
        ),
    },
    episodeMedia: {
      ...base.episodeMedia,
      adoptAudioTrack: (id, version, key) =>
        request(`/api/v2/audio-tracks/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
          headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
        }),
    },
    audioRevisions: {
      summaries: (id, cursor, limit) =>
        summaries(id, "audio-revision-summaries", cursor, limit),
      list: (id, cursor, limit) => {
        const query = new URLSearchParams();
        if (cursor) query.set("cursor", cursor);
        if (limit !== undefined) query.set("limit", String(limit));
        return request(
          `/api/v2/audio-tracks/${encodeURIComponent(id)}/revision-previews${query.size ? `?${query}` : ""}`,
        );
      },
      get: (id) => request(`/api/v2/audio-revisions/${encodeURIComponent(id)}`),
      preview: (id, input, key) =>
        request(
          `/api/v2/audio-tracks/${encodeURIComponent(id)}/revision-previews`,
          {
            method: "POST",
            headers: {
              "If-Match": `"${input.sourceVersion}"`,
              "Idempotency-Key": key,
            },
            body: JSON.stringify(input),
          },
        ),
      confirm: (id, version, input, key) =>
        request(`/api/v2/audio-revisions/${encodeURIComponent(id)}/confirm`, {
          method: "POST",
          headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
          body: JSON.stringify(input),
        }),
      discard: (id, version, key) =>
        request(`/api/v2/audio-revisions/${encodeURIComponent(id)}/discard`, {
          method: "POST",
          headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
          body: "{}",
        }),
    },
    audioResolutions: {
      summaries: (id, cursor, limit) =>
        summaries(id, "audio-resolution-summaries", cursor, limit),
      options: (id) =>
        request(
          `/api/v2/timelines/${encodeURIComponent(id)}/audio-source-options`,
        ),
      list: (id, cursor, limit) => {
        const query = new URLSearchParams();
        if (cursor) query.set("cursor", cursor);
        if (limit !== undefined) query.set("limit", String(limit));
        return request(
          `/api/v2/timelines/${encodeURIComponent(id)}/audio-resolution-previews${query.size ? `?${query}` : ""}`,
        );
      },
      get: (id) =>
        request(`/api/v2/audio-resolutions/${encodeURIComponent(id)}`),
      preview: (id, input, key) =>
        request(
          `/api/v2/timelines/${encodeURIComponent(id)}/audio-resolution-previews`,
          {
            method: "POST",
            headers: {
              "If-Match": `"${input.timelineVersion}"`,
              "Idempotency-Key": key,
            },
            body: JSON.stringify(input),
          },
        ),
      confirm: (id, version, input, key) =>
        request(`/api/v2/audio-resolutions/${encodeURIComponent(id)}/confirm`, {
          method: "POST",
          headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
          body: JSON.stringify(input),
        }),
      discard: (id, version, key) =>
        request(`/api/v2/audio-resolutions/${encodeURIComponent(id)}/discard`, {
          method: "POST",
          headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
          body: "{}",
        }),
    },
    mediaSources: {
      record: (id, signal) =>
        request(`/api/v2/media-records/${encodeURIComponent(id)}`, { signal }),
      summaries: (id, cursor, limit) =>
        summaries(id, "media-source-review-summaries", cursor, limit),
      status: (id) => request(`${path(id)}/source`),
      list: (id, cursor, limit) => {
        const query = new URLSearchParams();
        if (cursor) query.set("cursor", cursor);
        if (limit !== undefined) query.set("limit", String(limit));
        return request(
          `${path(id)}/source-reviews${query.size ? `?${query}` : ""}`,
        );
      },
      get: (id) => request(reviewPath(id)),
      preview: (id, input, key) =>
        request(`${path(id)}/source-reviews`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(input),
        }),
      adopt: (id, version, input, key) =>
        request(`${reviewPath(id)}/adopt`, {
          method: "POST",
          headers: { "Idempotency-Key": key, "If-Match": `"${version}"` },
          body: JSON.stringify(input),
        }),
      discard: (id, version, key) =>
        request(`${reviewPath(id)}/discard`, {
          method: "POST",
          headers: { "Idempotency-Key": key, "If-Match": `"${version}"` },
          body: "{}",
        }),
    },
  };
}
