import {
  StoryboardAttributionSourceSchema,
  StoryboardAttributionSchema,
  StoryboardAttributionPageSchema,
  StoryboardAttributionSummaryPageSchema,
  StoryboardAttributionCreateSchema,
  StoryboardAttributionDecisionSchema,
  type StoryboardAttribution,
  type StoryboardAttributionCreate,
  type StoryboardAttributionDecision,
} from "@dramaip/contracts/production";

/** Explicit owner identities only; no automatic latest selection or model call. */
export function createStoryboardAttributionsClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/storyboard-attributions`;
  const read = (raw: unknown, projectId: string, id?: string) => {
    const value = StoryboardAttributionSchema.parse(raw);
    if (value.projectId !== projectId || (id && value.id !== id))
      throw new Error("原镜头关联归属或身份无法核对，未替换为最新对象。");
    return value;
  };
  const write = (input: unknown, key: string, etag: string): RequestInit => {
    if (!key.trim() || key.length > 200)
      throw new Error("须保留人工关联的原请求键。");
    return {
      method: "POST",
      headers: { "Idempotency-Key": key, "If-Match": `"${etag}"` },
      body: JSON.stringify(input),
    };
  };
  return {
    async sources(
      projectId: string,
      storyboard: { id: string; version: number },
    ) {
      const value = StoryboardAttributionSourceSchema.parse(
        await request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/storyboard-attribution-sources/${encodeURIComponent(storyboard.id)}?version=${storyboard.version}`,
        ),
      );
      if (
        value.projectId !== projectId ||
        value.storyboard.id !== storyboard.id ||
        value.storyboard.version !== storyboard.version
      )
        throw new Error("实际关联来源不是所指定正式分镜版本，不换成最新基准。");
      return value;
    },
    async get(projectId: string, id: string) {
      return read(
        await request(`${path(projectId)}/${encodeURIComponent(id)}`),
        projectId,
        id,
      );
    },
    async list(
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
    ) {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      const value = StoryboardAttributionPageSchema.parse(
        await request(`${path(projectId)}${query.size ? `?${query}` : ""}`),
      );
      if (
        value.projectId !== projectId ||
        value.items.some((item) => item.projectId !== projectId) ||
        new Set(value.items.map((item) => item.id)).size !==
          value.items.length ||
        (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
      )
        throw new Error("关联历史归属、原身份或分页游标无法核对。");
      for (const item of value.items) read(item, projectId);
      return value;
    },
    async summaries(
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
    ) {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      const value = StoryboardAttributionSummaryPageSchema.parse(
        await request(
          `${path(projectId)}/summaries${query.size ? `?${query}` : ""}`,
        ),
      );
      if (
        value.projectId !== projectId ||
        value.items.some((item) => item.projectId !== projectId) ||
        new Set(value.items.map((item) => item.id)).size !==
          value.items.length ||
        (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
      )
        throw new Error(
          "关联摘要项目／身份／游标无法核对，未加载私人审阅正文。",
        );
      return value;
    },
    async create(
      projectId: string,
      input: StoryboardAttributionCreate,
      key: string,
    ) {
      const parsed = StoryboardAttributionCreateSchema.parse(input),
        value = read(
          await request(
            path(projectId),
            write(parsed, key, parsed.sourceFingerprint),
          ),
          projectId,
        );
      if (
        value.status !== "pending" ||
        value.version !== 0 ||
        JSON.stringify(value.input) !== JSON.stringify(parsed)
      )
        throw new Error("原创建回执未保留明确镜头选择／来源，不当新候选成功。");
      return value;
    },
    async decide(
      projectId: string,
      original: StoryboardAttribution,
      input: StoryboardAttributionDecision,
      key: string,
    ) {
      const candidate = read(original, projectId, original.id),
        parsed = StoryboardAttributionDecisionSchema.parse(input);
      if (
        candidate.status !== "pending" ||
        parsed.version !== candidate.version ||
        parsed.sourceFingerprint !== candidate.source.sourceFingerprint ||
        parsed.associationFingerprint !== candidate.associationFingerprint
      )
        throw new Error("只能明确决定精确原候选，不自动重绑来源或采用位置。");
      const value = read(
        await request(
          `${path(projectId)}/${encodeURIComponent(candidate.id)}/decision`,
          write(parsed, key, String(parsed.version)),
        ),
        projectId,
        candidate.id,
      );
      if (
        value.status !==
          (parsed.action === "adopt" ? "adopted" : "discarded") ||
        value.version !== candidate.version + 1 ||
        value.associationFingerprint !== candidate.associationFingerprint ||
        JSON.stringify(value.input) !== JSON.stringify(candidate.input) ||
        JSON.stringify(value.source) !== JSON.stringify(candidate.source)
      )
        throw new Error("原决定回执未保留冻结来源及人工关联。");
      return value;
    },
  };
}
export type StoryboardAttributionsClient = ReturnType<
  typeof createStoryboardAttributionsClient
>;
