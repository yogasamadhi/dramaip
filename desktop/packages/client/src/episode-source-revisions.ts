import {
  EpisodeSourceRevisionSchema,
  EpisodeSourceRevisionContextSchema,
  EpisodeSourceRevisionInputSchema,
  EpisodeSourceRevisionConfirmationSchema,
  EpisodeSourceRevisionPageSchema,
  EpisodeSourceRevisionSummaryPageSchema,
  type EpisodeSourceRevision,
  type EpisodeSourceRevisionContext,
  type EpisodeSourceRevisionInput,
  type EpisodeSourceRevisionConfirmation,
  type EpisodeSourceRevisionSummary,
} from "@dramaip/contracts/production";
import { canonicalCreativeMetricJSON } from "@dramaip/contracts/insights";

export interface EpisodeSourceRevisionClient {
  previewSourceRevision(
    id: string,
    input: EpisodeSourceRevisionInput,
    key: string,
  ): Promise<EpisodeSourceRevision>;
  getSourceRevision(id: string): Promise<EpisodeSourceRevision>;
  getSourceRevisionContext(
    expected: EpisodeSourceRevision,
  ): Promise<EpisodeSourceRevisionContext>;
  listSourceRevisions(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: EpisodeSourceRevision[]; nextCursor?: string }>;
  sourceRevisionSummaries(
    projectId: string,
    cursor?: string,
  ): Promise<{ items: EpisodeSourceRevisionSummary[]; nextCursor?: string }>;
  adoptSourceRevision(
    id: string,
    stateVersion: number,
    confirmation: EpisodeSourceRevisionConfirmation,
    key: string,
  ): Promise<EpisodeSourceRevision>;
  discardSourceRevision(
    id: string,
    stateVersion: number,
    key: string,
  ): Promise<EpisodeSourceRevision>;
}

export function createEpisodeSourceRevisionClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): EpisodeSourceRevisionClient {
  const revision = (id: string) =>
    `/api/v2/episode-source-revisions/${encodeURIComponent(id)}`;
  const exact = (id: string, raw: unknown) => {
    const value = EpisodeSourceRevisionSchema.parse(raw);
    if (value.id !== id)
      throw new Error("来源确认身份不符，不读取或决定其他预览。");
    return value;
  };
  const page = <T extends { id: string; projectId: string }>(
    projectId: string,
    value: { items: T[]; nextCursor?: string },
  ) => {
    if (
      value.items.some((item) => item.projectId !== projectId) ||
      new Set(value.items.map((item) => item.id)).size !== value.items.length ||
      (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
    )
      throw new Error(
        "来源确认历史归属、重复身份或游标不符，不回退或补空列表。",
      );
    return value;
  };
  const post = (path: string, body: unknown, version: number, key: string) =>
    request(path, {
      method: "POST",
      headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  return {
    previewSourceRevision: async (id, raw, key) => {
      const input = EpisodeSourceRevisionInputSchema.parse(raw);
      const value = EpisodeSourceRevisionSchema.parse(
        await post(
          `/api/v2/episode-development/${encodeURIComponent(id)}/source-revision-previews`,
          input,
          input.sourceVersion,
          key,
        ),
      );
      if (
        value.sourceScript.id !== id ||
        value.sourceScript.version !== input.sourceVersion ||
        value.sourceOutline.id !== input.outline.id ||
        value.sourceOutline.version !== input.outline.version ||
        value.document.version !== input.documentVersion ||
        (input.request.direct &&
          value.projectId !== input.request.direct.project.id) ||
        canonicalCreativeMetricJSON(value.input) !==
          canonicalCreativeMetricJSON(input)
      )
        throw new Error(
          "来源确认预览未绑定完整原请求，不使用其他来源、预算或映射。",
        );
      return value;
    },
    getSourceRevision: async (id) => exact(id, await request(revision(id))),
    getSourceRevisionContext: async (raw) => {
      const expected = EpisodeSourceRevisionSchema.parse(raw);
      if (expected.sourceState !== "current")
        throw new Error("原来源已失效，不读取或回退正文。");
      const value = EpisodeSourceRevisionContextSchema.parse(
        await request(`${revision(expected.id)}/source-context`),
      );
      const { entries, tokenBudget, ...binding } = value;
      const original = Object.fromEntries(
        Object.keys(binding).map((key) => [
          key,
          expected[key as keyof typeof expected],
        ]),
      );
      if (
        canonicalCreativeMetricJSON(binding) !==
          canonicalCreativeMetricJSON(original) ||
        tokenBudget !== expected.input.tokenBudget ||
        canonicalCreativeMetricJSON(
          entries.map(({ value: _body, ...ref }) => ref),
        ) !== canonicalCreativeMetricJSON(expected.outlineBasis.references)
      )
        throw new Error(
          "来源正文未绑定完整原预览、状态、快照及全部表达；不使用部分或替代来源。",
        );
      for (const entry of entries) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(entry.value)),
        );
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (sha256 !== entry.contentHash)
          throw new Error("来源正文实际字节哈希不符；未使用缓存或其他版本。");
      }
      return value;
    },
    listSourceRevisions: async (projectId, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return page(
        projectId,
        EpisodeSourceRevisionPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/episode-source-revisions${query.size ? `?${query}` : ""}`,
          ),
        ),
      );
    },
    sourceRevisionSummaries: async (projectId, cursor) =>
      page(
        projectId,
        EpisodeSourceRevisionSummaryPageSchema.parse(
          await request(
            `/api/v2/projects/${encodeURIComponent(projectId)}/episode-source-revision-summaries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          ),
        ),
      ),
    adoptSourceRevision: async (id, version, raw, key) => {
      const confirmation = EpisodeSourceRevisionConfirmationSchema.parse(raw);
      const value = exact(
        id,
        await post(
          `${revision(id)}/adopt`,
          { stateVersion: version, confirmation },
          version,
          key,
        ),
      );
      if (
        value.status !== "adopted" ||
        value.stateVersion !== version + 1 ||
        canonicalCreativeMetricJSON(value.confirmation) !==
          canonicalCreativeMetricJSON(confirmation)
      )
        throw new Error("新来源采用回执未对应原状态和五项明确审阅。");
      return value;
    },
    discardSourceRevision: async (id, version, key) => {
      const value = exact(
        id,
        await post(
          `${revision(id)}/discard`,
          { stateVersion: version },
          version,
          key,
        ),
      );
      if (value.status !== "discarded" || value.stateVersion !== version + 1)
        throw new Error("来源确认撤回回执未对应原状态。");
      return value;
    },
  };
}
