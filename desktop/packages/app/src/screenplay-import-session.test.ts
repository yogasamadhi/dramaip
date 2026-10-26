import { describe, expect, it } from "vitest";
import type { StudioClient } from "@dramaip/client";
import type {
  EpisodeDevelopmentCatalog,
  ScreenplayImportPreview,
} from "@dramaip/contracts/production";
import {
  ScreenplayImportBindingSchema,
  screenplayImportStorageKey,
  resolveScreenplayImport,
  readScreenplayImportSession,
} from "./screenplay-import-session";

const projectId = crypto.randomUUID();
const episodeId = crypto.randomUUID();
const scriptId = crypto.randomUUID();
const target = { projectVersion: 3, episodeVersion: 0 };
const preview: ScreenplayImportPreview = {
  previewId: crypto.randomUUID(),
  projectId,
  parentId: episodeId,
  title: "作者原稿",
  sourceName: "原稿.fdx",
  sourceFormat: "fdx",
  target,
  blocks: [{ id: crypto.randomUUID(), type: "action", text: "林晚记录警告。" }],
  lossReport: {
    unsupported: ["dual_dialogue_layout"],
    warnings: ["核对排版"],
    preserved: ["text_content"],
  },
  etag: '"exact-preview:0"',
  status: "pending",
  createdAt: new Date().toISOString(),
};
const binding = {
  previewId: preview.previewId,
  projectId,
  episodeId,
  etag: preview.etag,
  target,
};
const sources: EpisodeDevelopmentCatalog = {
  projectId,
  storyBibleCount: 0,
  episodes: [],
  currentResults: [],
  direct: {
    entryPath: "script",
    project: { id: projectId, version: 3 },
    episodes: [
      {
        id: episodeId,
        version: 0,
        title: "实际第一集",
        orderIndex: 0,
        scripts: [],
      },
    ],
  },
};
const committed = (): ScreenplayImportPreview => ({
  ...preview,
  status: "committed",
  receipt: {
    scriptId,
    scriptVersion: 0,
    documentId: crypto.randomUUID(),
    documentVersion: 0,
    committedAt: new Date().toISOString(),
    confirmation: { rightsDeclared: true, lossReportReviewed: true },
  },
});
describe("exact native screenplay import recovery", () => {
  it("binds the exact pending preview, project/episode and versions without requiring adopted development", () => {
    expect(resolveScreenplayImport(preview, binding, sources)).toMatchObject({
      targetCurrent: true,
      receiptCurrent: false,
      canCommit: true,
    });
    expect(screenplayImportStorageKey(projectId, episodeId)).toContain(
      `${projectId}:${episodeId}`,
    );
    expect(ScreenplayImportBindingSchema.parse(binding)).toEqual(binding);
    expect(() =>
      ScreenplayImportBindingSchema.parse({
        ...binding,
        grantId: crypto.randomUUID(),
        rightsDeclared: true,
      }),
    ).toThrow();
  });
  it("rejects mismatched preview identity, project, parent, ETag or immutable target", () => {
    for (const patch of [
      { previewId: crypto.randomUUID() },
      { projectId: crypto.randomUUID() },
      { parentId: crypto.randomUUID() },
      { etag: '"other"' },
      { target: undefined },
      { target: { ...target, episodeVersion: 1 } },
    ])
      expect(() =>
        resolveScreenplayImport({ ...preview, ...patch }, binding, sources),
      ).toThrow();
    expect(() =>
      resolveScreenplayImport(preview, binding, {
        ...sources,
        projectId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      resolveScreenplayImport(preview, binding, {
        ...sources,
        direct: undefined,
      }),
    ).toThrow();
  });
  it("shows changed or absent current targets as noncommittable, never rebinding the preview", () => {
    for (const direct of [
      {
        ...sources.direct!,
        project: { ...sources.direct!.project, version: 4 },
      },
      { ...sources.direct!, episodes: [] },
      {
        ...sources.direct!,
        episodes: [{ ...sources.direct!.episodes[0]!, version: 1 }],
      },
    ]) {
      const result = resolveScreenplayImport(preview, binding, {
        ...sources,
        direct,
      });
      expect(result.canCommit).toBe(false);
      expect(result.preview.target).toEqual(target);
    }
    expect(() =>
      resolveScreenplayImport(preview, binding, {
        ...sources,
        direct: {
          ...sources.direct!,
          episodes: [
            sources.direct!.episodes[0]!,
            sources.direct!.episodes[0]!,
          ],
        },
      }),
    ).toThrow();
  });
  it("does not treat layout-only, corrupt or duplicate blocks, discarded previews or PDF as story sources", () => {
    for (const next of [
      { ...preview, blocks: [] },
      {
        ...preview,
        blocks: [
          { id: crypto.randomUUID(), type: "note" as const, text: "只备注" },
        ],
      },
      { ...preview, blocks: [preview.blocks[0]!, preview.blocks[0]!] },
      { ...preview, status: "discarded" as const },
      { ...preview, sourceFormat: "pdf" as const },
    ])
      expect(resolveScreenplayImport(next, binding, sources).canCommit).toBe(
        false,
      );
    expect(() =>
      resolveScreenplayImport(
        { ...preview, blocks: [{ id: "bad", type: "action", text: "损坏" }] },
        binding,
        sources,
      ),
    ).toThrow();
  });
  it("only a recorded receipt with the exact actual original record and document versions is current", () => {
    const saved = committed();
    const actual = {
      ...sources,
      direct: {
        ...sources.direct!,
        episodes: [
          {
            ...sources.direct!.episodes[0]!,
            scripts: [
              {
                id: scriptId,
                title: "任意改名不靠标题猜测",
                version: 0,
                documentVersion: 0,
              },
            ],
          },
        ],
      },
    };
    expect(resolveScreenplayImport(saved, binding, actual)).toMatchObject({
      receiptCurrent: true,
      canCommit: false,
    });
    for (const item of [
      { id: crypto.randomUUID(), version: 0, documentVersion: 0 },
      { id: scriptId, version: 1, documentVersion: 0 },
      { id: scriptId, version: 0, documentVersion: null },
      { id: scriptId, version: 0, documentVersion: 1 },
    ]) {
      const result = resolveScreenplayImport(saved, binding, {
        ...actual,
        direct: {
          ...actual.direct,
          episodes: [
            {
              ...actual.direct.episodes[0]!,
              scripts: [{ ...item, title: preview.title }],
            },
          ],
        },
      });
      expect(result.receiptCurrent).toBe(false);
      expect(result.preview.receipt).toEqual(saved.receipt);
    }
    expect(
      resolveScreenplayImport(
        { ...saved, receipt: undefined },
        binding,
        actual,
      ),
    ).toMatchObject({ receiptCurrent: false, canCommit: false });
  });
  it("recovery performs only two scoped reads and never commits, discards, selects a source or calls the model", async () => {
    const calls: string[] = [];
    const client = {
      screenplayImports: {
        get: async (id: string) => {
          calls.push(`preview:${id}`);
          return committed();
        },
        commit: async () => {
          throw new Error("unexpected write");
        },
        discard: async () => {
          throw new Error("unexpected write");
        },
      },
      episodeDevelopments: {
        sources: async (id: string) => {
          calls.push(`sources:${id}`);
          return sources;
        },
      },
    } as unknown as Pick<
      StudioClient,
      "screenplayImports" | "episodeDevelopments"
    >;
    expect(
      (await readScreenplayImportSession(client, binding)).preview.status,
    ).toBe("committed");
    expect(calls).toEqual([
      `preview:${preview.previewId}`,
      `sources:${projectId}`,
    ]);
    client.screenplayImports.get = async () => {
      throw new Error("read unavailable");
    };
    await expect(readScreenplayImportSession(client, binding)).rejects.toThrow(
      "read unavailable",
    );
  });
});
