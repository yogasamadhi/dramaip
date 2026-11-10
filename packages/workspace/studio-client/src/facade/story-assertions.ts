import {
  StoryAssertionAdoptInputSchema,
  StoryAssertionInputSchema,
  StoryAssertionPageSchema,
  StoryAssertionSchema,
  type StoryAssertion,
  type StoryAssertionAdoptInput,
  type StoryAssertionInput,
} from "@dramaip/contracts/knowledge";
import {
  createSourceLifecycleActions,
  validSourceLifecycle,
} from "./story-source-lifecycle.js";

export function createStoryAssertionsClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/story-assertions`;
  const exactNodes = (result: StoryAssertion) => {
    const input = result.input;
    const characterId =
      input.kind === "cognition" && input.subject.kind === "character"
        ? input.subject.node.id
        : undefined;
    const selected =
      input.kind === "relationship"
        ? [input.from, input.to]
        : [
            input.target,
            ...(input.subject.kind === "character" ? [input.subject.node] : []),
          ];
    const unique = [
      ...new Map(selected.map((node) => [node.id, node])).values(),
    ];
    return (
      new Set(result.basis.nodes.map((node) => node.id)).size ===
        result.basis.nodes.length &&
      result.basis.nodes.length === unique.length &&
      unique.every((selected, index) => {
        const frozen = result.basis.nodes[index];
        return (
          frozen &&
          frozen.id === selected.id &&
          frozen.version === selected.version &&
          frozen.projectId === result.projectId &&
          frozen.confirmed
        );
      }) &&
      (input.kind !== "cognition" ||
        input.subject.kind !== "character" ||
        result.basis.nodes.some(
          (node) => node.id === characterId && node.kind === "character",
        ))
    );
  };
  const read = (raw: unknown, projectId: string, id?: string) => {
    const result = StoryAssertionSchema.parse(raw);
    const dependencies = new Map(
      result.basis.policyDependencies.map((item) => [item.fieldPath, item]),
    );
    const required = [
      ...result.basis.sourceBasis.policyDependencies,
      ...result.basis.nodes.flatMap((node) => [
        {
          sourceId: node.id,
          sourceVersion: node.version,
          fieldPath: `/story-declarations/nodes/${node.id}`,
        },
        ...(node.sourceType === "source-anchored-declaration-v1"
          ? [
              {
                sourceId: node.sourceId,
                sourceVersion: node.sourceVersion,
                fieldPath: `/story-declarations/${node.sourceId}`,
              },
            ]
          : []),
      ]),
    ];
    if (
      result.projectId !== projectId ||
      result.basis.projectId !== projectId ||
      (id && result.id !== id) ||
      JSON.stringify(result.input.sources) !==
        JSON.stringify(
          result.basis.sourceBasis.sources.map((source) => source.selection),
        ) ||
      (result.status === "adopted") !== Boolean(result.adoptedRecord) ||
      !validSourceLifecycle(
        result.status,
        result.id,
        result.adoptedRecord,
        result.lifecycle,
      ) ||
      result.basis.sourceBasis.projectId !== projectId ||
      (result.adoptedRecord &&
        result.adoptedRecord.kind !==
          (result.input.kind === "relationship" ? "edge" : "cognition")) ||
      !exactNodes(result) ||
      dependencies.size !== result.basis.policyDependencies.length ||
      required.some((item) => {
        const actual = dependencies.get(item.fieldPath);
        return (
          !actual ||
          actual.sourceId !== item.sourceId ||
          actual.sourceVersion !== item.sourceVersion
        );
      })
    )
      throw new Error("原来源声明身份或冻结选择无法核对，未替换为最新声明。");
    return result;
  };
  const write = (body: unknown, key: string, etag?: string): RequestInit => {
    if (!key.trim() || key.length > 200)
      throw new Error("须保留本次声明的原请求键。");
    if (etag !== undefined && !/^"[a-f0-9]{64}"$/u.test(etag))
      throw new Error("须提供原声明审阅 ETag。");
    return {
      method: "POST",
      headers: {
        "Idempotency-Key": key,
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: JSON.stringify(body),
    };
  };
  return {
    ...createSourceLifecycleActions(request, path, read, write),
    get: async (projectId: string, id: string): Promise<StoryAssertion> =>
      read(
        await request(`${path(projectId)}/${encodeURIComponent(id)}`),
        projectId,
        id,
      ),
    list: async (
      projectId: string,
      input: { cursor?: string; limit?: number } = {},
    ) => {
      const query = new URLSearchParams();
      if (input.cursor) query.set("cursor", input.cursor);
      if (input.limit !== undefined) query.set("limit", String(input.limit));
      const result = StoryAssertionPageSchema.parse(
        await request(`${path(projectId)}${query.size ? `?${query}` : ""}`),
      );
      if (
        result.projectId !== projectId ||
        result.items.some(
          (item) =>
            item.projectId !== projectId ||
            (item.status === "adopted") !== Boolean(item.adoptedRecord) ||
            !validSourceLifecycle(
              item.status,
              item.id,
              item.adoptedRecord,
              item.lifecycle,
            ) ||
            (item.adoptedRecord &&
              item.adoptedRecord.kind !==
                (item.kind === "relationship" ? "edge" : "cognition")),
        ) ||
        new Set(result.items.map((item) => item.id)).size !==
          result.items.length ||
        (result.nextCursor && result.nextCursor !== result.items.at(-1)?.id)
      )
        throw new Error("声明历史归属或分页身份无法核对。");
      return result;
    },
    create: async (
      projectId: string,
      input: StoryAssertionInput,
      key: string,
    ) => {
      const parsed = StoryAssertionInputSchema.parse(input);
      const result = read(
        await request(path(projectId), write(parsed, key)),
        projectId,
      );
      if (
        result.status !== "pending" ||
        result.version !== 0 ||
        result.sourceStatus.state !== "current" ||
        JSON.stringify(result.input) !== JSON.stringify(parsed)
      )
        throw new Error("候选回执不是本次精确选择，未视作已创建或已采用。");
      return result;
    },
    adopt: async (
      projectId: string,
      original: StoryAssertion,
      input: StoryAssertionAdoptInput,
      key: string,
    ) => {
      const candidate = read(original, projectId, original.id),
        parsed = StoryAssertionAdoptInputSchema.parse(input);
      if (
        candidate.status !== "pending" ||
        candidate.sourceStatus.state !== "current" ||
        parsed.sourceFingerprint !== candidate.basis.fingerprint
      )
        throw new Error("只可采用本次审阅的当前候选，不自动更换来源。");
      const result = read(
        await request(
          `${path(projectId)}/${encodeURIComponent(candidate.id)}/adopt`,
          write(parsed, key, candidate.etag),
        ),
        projectId,
        candidate.id,
      );
      if (
        result.status !== "adopted" ||
        result.version !== candidate.version + 1 ||
        result.basis.fingerprint !== candidate.basis.fingerprint ||
        JSON.stringify(result.input) !== JSON.stringify(candidate.input)
      )
        throw new Error("采用回执未保留原声明与冻结来源。");
      return result;
    },
    discard: async (
      projectId: string,
      original: StoryAssertion,
      key: string,
    ) => {
      const candidate = read(original, projectId, original.id);
      if (candidate.status !== "pending")
        throw new Error("原声明已处理，不能再次放弃。");
      const result = read(
        await request(
          `${path(projectId)}/${encodeURIComponent(candidate.id)}/discard`,
          write({}, key, candidate.etag),
        ),
        projectId,
        candidate.id,
      );
      if (
        result.status !== "discarded" ||
        result.version !== candidate.version + 1 ||
        result.basis.fingerprint !== candidate.basis.fingerprint ||
        JSON.stringify(result.input) !== JSON.stringify(candidate.input)
      )
        throw new Error("放弃回执未保留原声明身份。");
      return result;
    },
  };
}
export type StoryAssertionsClient = ReturnType<
  typeof createStoryAssertionsClient
>;
