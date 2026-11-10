import {
  TimelineRenderCreateInputSchema,
  TimelineRenderJobSchema,
  TimelineRenderPreflightSchema,
  TimelineRenderCatalogSchema,
  TimelineRenderCatalogQuerySchema,
  TimelineRenderSubtitlePolicySchema,
  TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  type TimelineRenderSubtitlePolicy,
  type TimelineRenderCreateInput,
} from "@dramaip/contracts/timeline";

export function createTimelineRenderClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const validatePolicy = (
    profile: string,
    policy?: TimelineRenderSubtitlePolicy,
  ) => {
    if (
      (profile === TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION) !==
      Boolean(policy)
    )
      throw new Error("字幕策略缺证或不属于该输出版本；不能推测旧任务策略。");
  };
  const job = async (
    path: string,
    timelineId: string,
    init?: RequestInit,
    jobId?: string,
  ) => {
    const value = TimelineRenderJobSchema.strict().parse(
      await request(path, init),
    );
    init?.signal?.throwIfAborted();
    validatePolicy(value.timelineProfileVersion, value.subtitlePolicy);
    if (value.timelineId !== timelineId || (jobId && value.jobId !== jobId))
      throw new Error("实际渲染任务身份无法核对。");
    if (
      value.outputRecord &&
      (value.status !== "succeeded" ||
        !value.outputMediaRef ||
        !value.outputSha256)
    )
      throw new Error("输出记录缺少成功任务与完整归档证明。");
    return value;
  };
  const write = async (
    path: string,
    timelineId: string,
    version: number,
    input: TimelineRenderCreateInput,
    key: string,
    signal?: AbortSignal,
  ) => {
    const body = TimelineRenderCreateInputSchema.strict().parse(input);
    validatePolicy(body.timelineProfileVersion, body.subtitlePolicy);
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !key.trim() ||
      key.trim().length > 200
    )
      throw new Error("须提供实际时间线版本与同次请求键。");
    const value = await job(path, timelineId, {
      method: "POST",
      headers: {
        "If-Match": `"timeline:${timelineId}:${version}"`,
        "Idempotency-Key": key.trim(),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (
      value.timelineVersion !== version ||
      value.sourceFingerprint !== body.sourceFingerprint ||
      value.timelineProfileVersion !== body.timelineProfileVersion ||
      value.rendererVersion !== body.rendererVersion ||
      value.sidecarArtifactVersion !== body.sidecarArtifactVersion ||
      JSON.stringify(value.subtitlePolicy) !==
        JSON.stringify(body.subtitlePolicy)
    )
      throw new Error("实际渲染回执与冻结输入不一致。");
    return value;
  };
  return {
    list: async (
      projectId: string,
      episodeId: string,
      options: {
        cursor?: string;
        limit?: number;
        requestFingerprint?: string;
      } = {},
      signal?: AbortSignal,
    ) => {
      const query = TimelineRenderCatalogQuerySchema.parse({
        projectId,
        ...options,
      });
      const params = new URLSearchParams({
        projectId,
        limit: String(query.limit),
      });
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.requestFingerprint)
        params.set("requestFingerprint", query.requestFingerprint);
      const result = TimelineRenderCatalogSchema.parse(
        await request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/timeline-renders?${params}`,
          { signal },
        ),
      );
      signal?.throwIfAborted();
      for (const item of result.items)
        validatePolicy(item.timelineProfileVersion, item.subtitlePolicy);
      if (
        result.projectId !== projectId ||
        result.episodeId !== episodeId ||
        (!result.timeline && (result.items.length || result.nextCursor)) ||
        new Set(result.items.map((item) => item.jobId)).size !==
          result.items.length ||
        result.items.some(
          (item) =>
            item.timelineId !== result.timeline?.id ||
            item.timelineVersion > result.timeline.version ||
            (item.outputRecord &&
              (item.outputRecord.projectId !== projectId ||
                item.status !== "succeeded" ||
                !item.outputSha256 ||
                !item.outputMediaRef)) ||
            (query.requestFingerprint &&
              item.requestFingerprint !== query.requestFingerprint),
        ) ||
        (query.requestFingerprint &&
          (result.items.length > 1 || result.nextCursor))
      )
        throw new Error("实际渲染历史身份、范围或请求回执无法核对。");
      return result;
    },
    preflight: async (
      timelineId: string,
      version: number,
      signal?: AbortSignal,
      subtitlePolicy?: TimelineRenderSubtitlePolicy,
    ) => {
      const policy = subtitlePolicy
        ? TimelineRenderSubtitlePolicySchema.parse(subtitlePolicy)
        : undefined;
      const query = new URLSearchParams();
      if (policy) {
        query.set("subtitleMode", policy.mode);
        if (policy.mode === "burn-in") {
          query.set("fontId", policy.font.id);
          query.set("fontPackVersion", policy.font.packVersion);
          query.set("fontSha256", policy.font.sha256);
        }
      }
      const value = TimelineRenderPreflightSchema.strict().parse(
        await request(
          `/api/v2/timelines/${encodeURIComponent(timelineId)}/render-preflight${query.size ? `?${query}` : ""}`,
          { signal },
        ),
      );
      signal?.throwIfAborted();
      validatePolicy(value.profileVersion, value.subtitlePolicy);
      const fonts = value.subtitleFonts ?? [];
      if (
        (value.subtitleBurnInAvailable &&
          (!fonts.length ||
            new Set(fonts.map((font) => font.id)).size !== fonts.length ||
            fonts.reduce((total, font) => total + font.sizeBytes, 0) >
              64 * 1024 * 1024)) ||
        (value.subtitleBurnInAvailable === false && fonts.length) ||
        (value.ready &&
          policy?.mode === "burn-in" &&
          (!value.subtitleBurnInAvailable ||
            !fonts.some(
              (font) =>
                font.id === policy.font.id &&
                font.packVersion === policy.font.packVersion &&
                font.sha256 === policy.font.sha256,
            )))
      )
        throw new Error("实际字幕能力、原字体目录或选定身份无法核对。");
      if (
        value.timelineId !== timelineId ||
        value.timelineVersion !== version ||
        value.timelineEtag !== `"timeline:${timelineId}:${version}"` ||
        JSON.stringify(value.subtitlePolicy) !== JSON.stringify(policy) ||
        (value.ready &&
          (!value.sourceFingerprint ||
            !value.rendererVersion ||
            !value.sidecarArtifactVersion))
      )
        throw new Error("实际渲染预检身份、版本或冻结证明无法核对。");
      return value;
    },
    create: (
      timelineId: string,
      version: number,
      input: TimelineRenderCreateInput,
      key: string,
      signal?: AbortSignal,
    ) =>
      write(
        `/api/v2/timelines/${encodeURIComponent(timelineId)}/renders`,
        timelineId,
        version,
        input,
        key,
        signal,
      ),
    get: (jobId: string, timelineId: string, signal?: AbortSignal) =>
      job(
        `/api/v2/timeline-renders/${encodeURIComponent(jobId)}`,
        timelineId,
        { signal },
        jobId,
      ),
    cancel: (jobId: string, timelineId: string, signal?: AbortSignal) =>
      job(
        `/api/v2/timeline-renders/${encodeURIComponent(jobId)}/cancel`,
        timelineId,
        { method: "POST", signal },
        jobId,
      ),
    retry: (
      jobId: string,
      timelineId: string,
      version: number,
      input: TimelineRenderCreateInput,
      key: string,
      signal?: AbortSignal,
    ) =>
      write(
        `/api/v2/timeline-renders/${encodeURIComponent(jobId)}/retry`,
        timelineId,
        version,
        input,
        key,
        signal,
      ),
  };
}
export type TimelineRenderClient = ReturnType<
  typeof createTimelineRenderClient
>;
