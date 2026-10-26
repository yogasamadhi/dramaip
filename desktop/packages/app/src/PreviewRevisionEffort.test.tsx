import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChapterPreviewRevisionEffortSchema,
  ChangePreviewSchema,
} from "@dramaip/contracts/automation";
import { createPreviewRevisionEffortClient } from "../../client/src/preview-revision-effort";
import { ChapterPreviewRevisionView } from "./features/ChapterPreviewRevisionPanel";
const preview = ChangePreviewSchema.parse({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  taskId: crypto.randomUUID(),
  targets: [
    {
      kind: "chapter",
      id: crypto.randomUUID(),
      baseVersion: 0,
      patch: { content: "PRIVATE 候选" },
    },
  ],
  status: "pending",
  rationale: "PRIVATE 动机",
  contentHash: "original-hash",
  createdAt: "2026-10-07T00:00:00.000Z",
});
const receipt = () =>
  ChapterPreviewRevisionEffortSchema.parse({
    format: "chapter-preview-revision-effort-v1",
    projectId: preview.projectId,
    previewId: preview.id,
    chapterId: preview.targets[0]!.id,
    taskId: preview.taskId,
    rootPreviewId: preview.id,
    contentHash: preview.contentHash,
    candidateSha256: createHash("sha256").update("PRIVATE 候选").digest("hex"),
    journalSha256: "a".repeat(64),
    status: "pending",
    coverage: "complete",
    observedContentUpdates: 2,
    observedRebases: 1,
    observedContentChangingRebases: 1,
    localRevisionCount: 3,
    scope: "exact-chapter-preview-chain",
    qualityStatus: "unverified",
  });
describe("actual saved candidate revision effort", () => {
  test("SDK binds original project, preview, chapter, task, status and SHA256; forwards abort without writes", async () => {
    let value: unknown = receipt();
    const calls: { path: string; init?: RequestInit }[] = [];
    const sdk = createPreviewRevisionEffortClient(
      async <T,>(path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return value as T;
      },
    );
    const controller = new AbortController();
    await expect(sdk.read(preview, controller.signal)).resolves.toEqual(
      receipt(),
    );
    expect(calls[0]).toEqual({
      path: `/api/v2/change-previews/${preview.id}/revision-effort?projectId=${preview.projectId}&contentHash=original-hash`,
      init: { signal: controller.signal },
    });
    for (const bad of [
      { ...receipt(), previewId: crypto.randomUUID() },
      { ...receipt(), projectId: crypto.randomUUID() },
      { ...receipt(), chapterId: crypto.randomUUID() },
      { ...receipt(), taskId: crypto.randomUUID() },
      { ...receipt(), contentHash: "other" },
      { ...receipt(), candidateSha256: "b".repeat(64) },
      { ...receipt(), status: "committed" },
      { ...receipt(), content: "PRIVATE" },
      { ...receipt(), coverage: "partial" },
      { ...receipt(), localRevisionCount: 4 },
      { ...receipt(), qualityStatus: "passed" },
    ]) {
      value = bad;
      await expect(sdk.read(preview)).rejects.toThrow();
    }
  });
  test("incomplete and untracked history cannot claim zero or fabricate full revision totals", () => {
    const partial = {
      ...receipt(),
      coverage: "partial",
      localRevisionCount: null,
    };
    expect(ChapterPreviewRevisionEffortSchema.safeParse(partial).success).toBe(
      true,
    );
    expect(
      ChapterPreviewRevisionEffortSchema.safeParse({
        ...partial,
        localRevisionCount: 0,
      }).success,
    ).toBe(false);
    expect(
      ChapterPreviewRevisionEffortSchema.safeParse({
        ...partial,
        coverage: "untracked",
      }).success,
    ).toBe(false);
    expect(
      ChapterPreviewRevisionEffortSchema.safeParse({
        ...receipt(),
        observedContentChangingRebases: 2,
        localRevisionCount: 4,
      }).success,
    ).toBe(false);
  });
  test("view separates saved changes, unchanged-content rebases and formal adoption from model stages and unknown history", () => {
    const html = renderToStaticMarkup(
      <ChapterPreviewRevisionView value={receipt()} />,
    );
    expect(html).toContain("正文修改 2 次");
    expect(html).toContain("显式合并 1 次");
    expect(html).toContain("尚未正式采用");
    expect(html).toContain("不包含模型修订阶段");
    expect(html).not.toContain("PRIVATE");
    const unknown = renderToStaticMarkup(
      <ChapterPreviewRevisionView
        value={{ ...receipt(), coverage: "partial", localRevisionCount: null }}
      />,
    );
    expect(unknown).toContain("未知（历史不完整）");
    expect(unknown).toContain("不补零");
    expect(
      renderToStaticMarkup(
        <ChapterPreviewRevisionView
          value={{ ...receipt(), status: "committed" }}
        />,
      ),
    ).toContain("正式采用时");
  });
});
