import {
  NarrativeQualityReportSchema,
  NarrativeQualityPageSchema,
  NarrativeQualitySummaryPageSchema,
  NarrativeQualityCatalogSchema,
  NarrativeQualityDispositionSchema,
  NarrativeQualityRequestSchema,
  NarrativeLocalQualitySourceSchema,
  NarrativeLocalQualityCreateSchema,
  NarrativeLocalQualityReviewSchema,
  NarrativeLocalQualityPageSchema,
  NarrativeLocalQualitySummaryPageSchema,
  NarrativeLocalQualityDecisionSchema,
  NarrativeLocalQualityDispositionSchema,
  type NarrativeQualityRequest,
  type NarrativeLocalQualitySource,
  type NarrativeLocalQualityCreate,
  type NarrativeLocalQualityReview,
  type NarrativeLocalQualitySummaryPage,
  type NarrativeQualityReport,
  type NarrativeQualityPage,
  type NarrativeQualityDisposition,
  type NarrativeQualitySummaryPage,
  type NarrativeQualityCatalog,
} from "@dramaip/contracts/creative-quality";

export interface NarrativeQualityClient {
  localPreview(
    projectId: string,
    input: NarrativeQualityRequest,
  ): Promise<NarrativeLocalQualitySource>;
  localCreate(
    projectId: string,
    input: NarrativeLocalQualityCreate,
    key: string,
  ): Promise<NarrativeLocalQualityReview>;
  localGet(id: string): Promise<NarrativeLocalQualityReview>;
  localSummaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<NarrativeLocalQualitySummaryPage>;
  localList(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: NarrativeLocalQualityReview[]; nextCursor?: string }>;
  localDecide(
    id: string,
    input: import("zod").infer<typeof NarrativeLocalQualityDecisionSchema>,
    key: string,
  ): Promise<NarrativeLocalQualityReview>;
  localDisposition(
    id: string,
    input: import("zod").infer<typeof NarrativeLocalQualityDispositionSchema>,
    key: string,
  ): Promise<NarrativeLocalQualityReview>;
  sources(projectId: string): Promise<NarrativeQualityCatalog>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<NarrativeQualitySummaryPage>;
  get(id: string): Promise<NarrativeQualityReport>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<NarrativeQualityPage>;
  disposition(
    id: string,
    input: NarrativeQualityDisposition,
    key: string,
  ): Promise<NarrativeQualityReport>;
}
export function createNarrativeQualityClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): NarrativeQualityClient {
  const item = (id: string) =>
    `/api/v2/narrative-quality-reports/${encodeURIComponent(id)}`;
  const checkPage = <T extends { id: string; projectId: string }>(
    projectId: string,
    page: { items: T[]; nextCursor?: string },
  ) => {
    if (
      page.items.some((value) => value.projectId !== projectId) ||
      new Set(page.items.map((value) => value.id)).size !== page.items.length ||
      (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id)
    )
      throw new Error(
        "质量报告分页归属／身份或游标无法核对，不以空页或最新对象替代。",
      );
    return page;
  };
  const checkReport = (id: string, raw: unknown) => {
    const value = NarrativeQualityReportSchema.parse(raw);
    if (value.id !== id) throw new Error("质量报告响应不是明确请求的原 ID。");
    return value;
  };
  const localItem = (id: string) =>
    `/api/v2/narrative-local-reviews/${encodeURIComponent(id)}`;
  const checkLocal = (id: string, raw: unknown) => {
    const value = NarrativeLocalQualityReviewSchema.parse(raw);
    if (value.id !== id) throw new Error("本地评议响应不是明确请求的原 ID。");
    return value;
  };
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : item,
    );
  return {
    localPreview: async (projectId, input) => {
      const body = NarrativeQualityRequestSchema.parse(input);
      const source = NarrativeLocalQualitySourceSchema.parse(
        await request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-local-review-sources`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      );
      if (
        source.projectId !== projectId ||
        canonical(source.basis.request) !== canonical(body)
      )
        throw new Error(
          "本地来源响应不属于明确项目／原目标范围，不换用最近来源。",
        );
      return source;
    },
    localCreate: async (projectId, input, key) => {
      const body = NarrativeLocalQualityCreateSchema.parse(input);
      const value = NarrativeLocalQualityReviewSchema.parse(
        await request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-local-reviews`,
          {
            method: "POST",
            headers: {
              "Idempotency-Key": key,
              "If-Match": `"${body.sourceFingerprint}"`,
            },
            body: JSON.stringify(body),
          },
        ),
      );
      if (
        value.projectId !== projectId ||
        value.origin !== body.origin ||
        value.source.sourceFingerprint !== body.sourceFingerprint ||
        value.source.baseReviewId !== body.baseReviewId ||
        canonical(value.source.basis.request) !== canonical(body.request)
      )
        throw new Error("本地评议回执不是明确确认的原来源与入口。");
      return value;
    },
    localGet: async (id) => checkLocal(id, await request(localItem(id))),
    localList: async (projectId, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return checkPage(
        projectId,
        NarrativeLocalQualityPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-local-reviews${query.size ? `?${query}` : ""}`,
          ),
        ),
      );
    },
    localSummaries: async (projectId, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const page = NarrativeLocalQualitySummaryPageSchema.parse(
        await request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-local-review-summaries${query.size ? `?${query}` : ""}`,
        ),
      );
      if (page.projectId !== projectId)
        throw new Error("本地评议摘要不属于明确项目。");
      checkPage(projectId, page);
      return page;
    },
    localDecide: async (id, input, key) => {
      const body = NarrativeLocalQualityDecisionSchema.parse(input);
      return checkLocal(
        id,
        await request(`${localItem(id)}/decision`, {
          method: "POST",
          headers: { "Idempotency-Key": key, "If-Match": `"${body.version}"` },
          body: JSON.stringify(body),
        }),
      );
    },
    localDisposition: async (id, input, key) => {
      const body = NarrativeLocalQualityDispositionSchema.parse(input);
      return checkLocal(
        id,
        await request(`${localItem(id)}/dispositions`, {
          method: "POST",
          headers: { "Idempotency-Key": key, "If-Match": `"${body.version}"` },
          body: JSON.stringify(body),
        }),
      );
    },
    sources: async (id) => {
      const catalog = NarrativeQualityCatalogSchema.parse(
        await request(
          `/api/v2/projects/${encodeURIComponent(id)}/narrative-quality-sources`,
        ),
      );
      if (
        new Set(
          catalog.targets.map(
            (value) => `${value.target.kind}:${value.target.id}`,
          ),
        ).size !== catalog.targets.length ||
        catalog.targets.some(
          (value) =>
            value.target.kind === "chapter-set" && value.target.id !== id,
        ) ||
        (catalog.chapterSet &&
          (catalog.chapterSet.target.kind !== "chapter-set" ||
            catalog.chapterSet.target.id !== id))
      )
        throw new Error("质量目标目录重复或不属于明确项目。");
      return catalog;
    },
    summaries: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return checkPage(
        id,
        NarrativeQualitySummaryPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(id)}/narrative-quality-summaries${query.size ? `?${query}` : ""}`,
          ),
        ),
      );
    },
    get: async (id) => checkReport(id, await request(item(id))),
    list: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return checkPage(
        id,
        NarrativeQualityPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(id)}/narrative-quality-reports${query.size ? `?${query}` : ""}`,
          ),
        ),
      );
    },
    disposition: async (id, input, key) => {
      NarrativeQualityDispositionSchema.parse(input);
      return checkReport(
        id,
        await request(`${item(id)}/dispositions`, {
          method: "POST",
          headers: { "Idempotency-Key": key, "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      );
    },
  };
}
