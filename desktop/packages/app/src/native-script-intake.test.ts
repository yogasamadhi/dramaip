import { describe, expect, it } from "bun:test";
import { StudioClientError, type StudioClient } from "@dramaip/client";
import type { ScreenplayIntakePreview } from "@dramaip/contracts/production";
import {
  NativeScriptIntakeBindingSchema,
  readNativeScriptIntake,
  readNativeScriptIntakeRecovery,
  resolveNativeScriptIntake,
} from "./native-script-intake";

const preview: ScreenplayIntakePreview = {
  id: crypto.randomUUID(),
  sourceName: "作者原稿.fdx",
  sourceFormat: "fdx",
  blocks: [{ id: crypto.randomUUID(), type: "action", text: "林晚主动求证。" }],
  lossReport: { unsupported: [], warnings: [], preserved: ["text_content"] },
  etag: '"exact-intake:0"',
  status: "pending",
  createdAt: new Date().toISOString(),
  sourceState: "unknown",
};
const binding = { previewId: preview.id, etag: preview.etag };
const requestKey = crypto.randomUUID();
const started = (): ScreenplayIntakePreview => ({
  ...preview,
  status: "creating",
  requestKey,
  request: {
    previewId: preview.id,
    project: {
      title: "冻结的原稿目标",
      mode: "single_season",
      modeConfig: {
        mode: "single_season",
        entryPath: "script",
        targetEpisodeCount: 12,
      },
    },
    confirmation: { rightsDeclared: true, lossReportReviewed: true },
  },
});
const materialized = (): ScreenplayIntakePreview => ({
  ...started(),
  status: "materialized",
  sourceState: "current",
  receipt: {
    projectId: crypto.randomUUID(),
    projectVersion: 0,
    adaptationId: crypto.randomUUID(),
    adaptationVersion: 0,
    episodeId: crypto.randomUUID(),
    episodeVersion: 0,
    scriptId: crypto.randomUUID(),
    scriptVersion: 0,
    documentId: crypto.randomUUID(),
    documentVersion: 0,
    committedAt: new Date().toISOString(),
  },
});
describe("projectless native script intake recovery", () => {
  const clientReading = (
    read: (id: string) => Promise<ScreenplayIntakePreview>,
  ) => ({ screenplayIntakes: { get: read } }) as unknown as StudioClient;
  const missing = () =>
    new StudioClientError(404, {
      code: "SCREENPLAY_INTAKE",
      message: "同一预览不存在",
      requestId: crypto.randomUUID(),
    });
  it("recognizes only actual owner 404 with no local create key; recovery remains one same-ID GET", async () => {
    const calls: string[] = [];
    const client = clientReading(async (id) => {
      calls.push(id);
      throw missing();
    });
    expect(
      await readNativeScriptIntakeRecovery(client, { previewId: preview.id }),
    ).toEqual({ kind: "missing-before-create", previewId: preview.id });
    expect(await readNativeScriptIntakeRecovery(client, binding)).toEqual({
      kind: "missing-before-create",
      previewId: preview.id,
    });
    expect(calls).toEqual([preview.id, preview.id]);
  });
  it("never turns timeouts, network/permission failures, generic route 404 or create-bound 404 into permission to release", async () => {
    for (const cause of [
      new Error("timeout"),
      new TypeError("network"),
      { status: 404, body: { code: "SCREENPLAY_INTAKE" } },
      ...[401, 403, 409, 500].map(
        (status) =>
          new StudioClientError(status, {
            code: "SCREENPLAY_INTAKE",
            message: "不可核验",
            requestId: crypto.randomUUID(),
          }),
      ),
      new StudioClientError(404, {
        code: "NOT_FOUND",
        message: "未知路由",
        requestId: crypto.randomUUID(),
      }),
    ]) {
      await expect(
        readNativeScriptIntakeRecovery(
          clientReading(async () => {
            throw cause;
          }),
          binding,
        ),
      ).rejects.toEqual(cause);
    }
    const cause = missing();
    await expect(
      readNativeScriptIntakeRecovery(
        clientReading(async () => {
          throw cause;
        }),
        { ...binding, requestKey },
      ),
    ).rejects.toBe(cause);
  });
  it("fresh same-ID revalidation prefers a late real preview and rejects malformed or cross-bound replies", async () => {
    let reads = 0;
    const client = clientReading(async (id) => {
      expect(id).toBe(preview.id);
      if (++reads === 1) throw missing();
      return preview;
    });
    expect((await readNativeScriptIntakeRecovery(client, binding)).kind).toBe(
      "missing-before-create",
    );
    expect(await readNativeScriptIntakeRecovery(client, binding)).toMatchObject(
      { kind: "verified", session: { preview, canCreate: true } },
    );
    expect(reads).toBe(2);
    for (const bad of [
      { ...preview, id: crypto.randomUUID() },
      { ...preview, etag: '"wrong"' },
      { ...preview, sourceFormat: "unknown" },
    ])
      await expect(
        readNativeScriptIntakeRecovery(
          clientReading(async () => bad as ScreenplayIntakePreview),
          binding,
        ),
      ).rejects.toThrow();
  });
  const structured = (): ScreenplayIntakePreview => ({
    ...preview,
    sourceFormat: "script-json",
    sourceName: "全部原稿.json",
    blocks: [],
    episodes: [4, 2].map((episodeNumber) => ({
      id: crypto.randomUUID(),
      episodeNumber,
      title: `第 ${episodeNumber} 集`,
      content: "林晚主动求证。",
      contentSource: "episode-content",
      blocks: [
        { id: crypto.randomUUID(), type: "action", text: "林晚主动求证。" },
      ],
      scenes: [{ title: "原场景", content: "原作者资料" }],
      lossReport: preview.lossReport,
    })),
  });
  const structuredCommitted = () => {
    const source = structured();
    const base = materialized();
    const episodes = source.episodes!.map((episode) => ({
      previewEpisodeId: episode.id,
      episodeNumber: episode.episodeNumber,
      episodeId: crypto.randomUUID(),
      episodeVersion: 0,
      scriptId: crypto.randomUUID(),
      scriptVersion: 0,
      documentId: crypto.randomUUID(),
      documentVersion: 0,
      scenes: [{ id: crypto.randomUUID(), version: 0, sourceIndex: 0 }],
    }));
    const first = episodes[0]!;
    return {
      ...base,
      ...source,
      status: "committed" as const,
      sourceState: "current" as const,
      requestKey: base.requestKey,
      request: base.request,
      receipt: {
        ...base.receipt!,
        episodeId: first.episodeId,
        episodeVersion: first.episodeVersion,
        scriptId: first.scriptId,
        scriptVersion: first.scriptVersion,
        documentId: first.documentId,
        documentVersion: first.documentVersion,
        episodes,
      },
    };
  };
  it("JSON creation requires actual story blocks in every episode, with globally unique stable IDs", () => {
    const next = structured();
    expect(resolveNativeScriptIntake(next, binding).canCreate).toBe(true);
    for (const blocks of [
      [],
      [{ id: crypto.randomUUID(), type: "note" as const, text: "备注" }],
      next.episodes![0]!.blocks,
    ]) {
      const changed = {
        ...next,
        episodes: [next.episodes![0]!, { ...next.episodes![1]!, blocks }],
      };
      expect(resolveNativeScriptIntake(changed, binding).canCreate).toBe(false);
    }
    expect(() =>
      resolveNativeScriptIntake({ ...next, episodes: undefined }, binding),
    ).toThrow();
    expect(() =>
      resolveNativeScriptIntake({ ...next, blocks: preview.blocks }, binding),
    ).toThrow();
  });
  it("JSON opening binds every receipt entry to the exact file-order episode and original scene", () => {
    const next = structuredCommitted();
    const identity = { ...binding, requestKey };
    expect(resolveNativeScriptIntake(next, identity).canOpen).toBe(true);
    const receipt = next.receipt;
    for (const patch of [
      { episodes: undefined },
      { episodes: receipt.episodes.slice(0, 1) },
      { episodes: [...receipt.episodes].reverse() },
      {
        episodes: [
          receipt.episodes[0]!,
          { ...receipt.episodes[1]!, previewEpisodeId: crypto.randomUUID() },
        ],
      },
      {
        episodes: [
          receipt.episodes[0]!,
          { ...receipt.episodes[1]!, scenes: [] },
        ],
      },
      {
        episodes: [
          receipt.episodes[0]!,
          { ...receipt.episodes[1]!, scriptId: receipt.scriptId },
        ],
      },
      { scriptId: receipt.episodes[1]!.scriptId },
    ])
      expect(() =>
        resolveNativeScriptIntake(
          { ...next, receipt: { ...receipt, ...patch } },
          identity,
        ),
      ).toThrow();
    expect(
      resolveNativeScriptIntake({ ...next, sourceState: "stale" }, identity)
        .canOpen,
    ).toBe(false);
  });
  it("JSON preview cannot masquerade as a native one-script source or reuse episode identities/numbers", () => {
    const next = structured();
    for (const patch of [
      { sourceFormat: "fdx" as const },
      {
        episodes: [
          next.episodes![0]!,
          { ...next.episodes![1]!, id: next.episodes![0]!.id },
        ],
      },
      {
        episodes: [
          next.episodes![0]!,
          {
            ...next.episodes![1]!,
            episodeNumber: next.episodes![0]!.episodeNumber,
          },
        ],
      },
    ])
      expect(() =>
        resolveNativeScriptIntake({ ...next, ...patch }, binding),
      ).toThrow();
  });
  it("stores only exact identity/version/key, never source, grant, request or consent", () => {
    expect(NativeScriptIntakeBindingSchema.parse(binding)).toEqual(binding);
    for (const extra of [
      { grantId: crypto.randomUUID() },
      { sourceName: "原稿.fdx" },
      { path: "/private/original.fdx" },
      { blocks: preview.blocks },
      { rightsDeclared: true },
      { request: started().request },
    ])
      expect(() =>
        NativeScriptIntakeBindingSchema.parse({ ...binding, ...extra }),
      ).toThrow();
  });
  it("pending previews allow only fresh explicit creation; notes, duplicate blocks and discarded do not", () => {
    expect(resolveNativeScriptIntake(preview, binding)).toMatchObject({
      canCreate: true,
      canResume: false,
      canOpen: false,
    });
    for (const patch of [
      { blocks: [] },
      {
        blocks: [
          { id: crypto.randomUUID(), type: "note" as const, text: "仅备注" },
        ],
      },
      { blocks: [preview.blocks[0]!, preview.blocks[0]!] },
      { status: "discarded" as const },
    ])
      expect(
        resolveNativeScriptIntake({ ...preview, ...patch }, binding).canCreate,
      ).toBe(false);
  });
  it("refuses another identity, version, key or frozen target instead of rebinding", () => {
    for (const patch of [{ id: crypto.randomUUID() }, { etag: '"other"' }])
      expect(() =>
        resolveNativeScriptIntake({ ...preview, ...patch }, binding),
      ).toThrow();
    const next = started();
    for (const patch of [
      { requestKey: undefined },
      { requestKey: crypto.randomUUID() },
      { request: undefined },
      { request: { ...next.request!, previewId: crypto.randomUUID() } },
    ])
      expect(() =>
        resolveNativeScriptIntake(
          { ...next, ...patch },
          { ...binding, requestKey },
        ),
      ).toThrow();
    expect(() => resolveNativeScriptIntake(next, binding)).toThrow();
    expect(() =>
      resolveNativeScriptIntake({ ...preview, request: next.request }, binding),
    ).toThrow();
  });
  it("continues only the same durable creating input; never treats it as a new or completed project", () => {
    const next = started();
    const resolved = resolveNativeScriptIntake(next, {
      ...binding,
      requestKey,
    });
    expect(resolved).toMatchObject({
      canCreate: false,
      canResume: true,
      canOpen: false,
    });
    expect(resolved.preview.request).toEqual(next.request);
  });
  it("requires materialized receipt/current objects to resume and committed/current objects to open", () => {
    const next = materialized();
    const identity = { ...binding, requestKey };
    expect(resolveNativeScriptIntake(next, identity)).toMatchObject({
      canCreate: false,
      canResume: true,
      canOpen: false,
    });
    expect(
      resolveNativeScriptIntake({ ...next, status: "committed" }, identity),
    ).toMatchObject({ canResume: false, canOpen: true });
    for (const sourceState of ["stale", "unknown"] as const) {
      expect(
        resolveNativeScriptIntake({ ...next, sourceState }, identity).canResume,
      ).toBe(false);
      expect(
        resolveNativeScriptIntake(
          { ...next, status: "committed", sourceState },
          identity,
        ).canOpen,
      ).toBe(false);
    }
    for (const status of ["materialized", "committed"] as const)
      expect(() =>
        resolveNativeScriptIntake(
          { ...next, status, receipt: undefined },
          identity,
        ),
      ).toThrow();
  });
  it("recovery makes one same-ID GET and no picker, project/import write or model call", async () => {
    const calls: string[] = [];
    const client = {
      screenplayIntakes: {
        get: async (id: string) => {
          calls.push(id);
          return preview;
        },
      },
    } as unknown as StudioClient;
    expect((await readNativeScriptIntake(client, binding)).canCreate).toBe(
      true,
    );
    expect(calls).toEqual([preview.id]);
  });
});
