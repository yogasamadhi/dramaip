// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../src/client/locale.ts";
import type { StageRemotes } from "../src/client/remote.ts";
import {
  OwnerEvidenceView,
  type OwnerEvidence,
} from "../src/client/stages/MediaReview.tsx";
import {
  parseMediaPending,
  parsePlatformPending,
  platformPendingKey,
  mediaPendingKey,
} from "../src/client/stages/pending.ts";
import { PreflightView } from "../src/client/stages/PlatformDelivery.tsx";
import { recordDomain } from "../src/client/stages/records.ts";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"review">;

const uuid = () => crypto.randomUUID();
const digest = "a".repeat(64);

function archive() {
  const projectId = uuid(),
    adaptationId = uuid(),
    episodeId = uuid();
  return {
    operation: "archive" as const,
    key: uuid(),
    projectId,
    adaptationId,
    episodeId,
    aggregateId: episodeId,
    input: {
      projectId,
      profileId: uuid(),
      creativeVariantId: uuid(),
      manualFieldsConfirmed: true,
      sourceFingerprint: digest,
    },
  };
}

describe("pending platform requests", () => {
  it("read back only strict, scope-bound opaque IDs and hashes", () => {
    const original = archive();
    const scope = {
      projectId: original.projectId,
      adaptationId: original.adaptationId,
      episodeId: original.episodeId,
    };
    expect(parsePlatformPending(original, scope)).toEqual(original);
    expect(() =>
      parsePlatformPending(original, { ...scope, projectId: uuid() }),
    ).toThrow();
    expect(() =>
      parsePlatformPending({ ...original, title: "PRIVATE" }, scope),
    ).toThrow();
    expect(() =>
      parsePlatformPending(
        { ...original, input: { ...original.input, projectId: uuid() } },
        scope,
      ),
    ).toThrow();
    expect(() =>
      parsePlatformPending({ ...original, aggregateId: uuid() }, scope),
    ).toThrow();
    expect(() =>
      parsePlatformPending({ ...original, operation: "restore" }, scope),
    ).toThrow();
    expect(
      platformPendingKey(scope.projectId, scope.adaptationId, scope.episodeId),
    ).toBe(
      `dramaip:platform-metadata:${scope.projectId}:${scope.adaptationId}:${scope.episodeId}`,
    );
  });

  it("bind an adoption to its own adaptation", () => {
    const projectId = uuid(),
      adaptationId = uuid(),
      episodeId = uuid();
    const adopt = {
      operation: "adopt" as const,
      key: uuid(),
      projectId,
      adaptationId,
      episodeId,
      aggregateId: uuid(),
      input: {
        projectId,
        adaptationId,
        projectVersion: 2,
        adaptationVersion: 3,
        variantVersion: 1,
        contentFingerprint: digest,
        expectedHeadRevision: 1,
      },
    };
    const scope = { projectId, adaptationId, episodeId };
    expect(parsePlatformPending(adopt, scope)).toEqual(adopt);
    expect(() =>
      parsePlatformPending(
        { ...adopt, input: { ...adopt.input, adaptationId: uuid() } },
        scope,
      ),
    ).toThrow();
    expect(() =>
      parsePlatformPending(
        { ...adopt, input: { ...adopt.input, projectVersion: -1 } },
        scope,
      ),
    ).toThrow();
  });
});

describe("pending media review requests", () => {
  it("keep only the request key, episode and fingerprinted input", () => {
    const projectId = uuid(),
      episodeId = uuid();
    const pending = {
      requestKey: uuid(),
      episodeId,
      input: { projectId, sourceFingerprint: digest },
    };
    const scope = { projectId, episodeId };
    expect(parseMediaPending(pending, scope)).toEqual(pending);
    for (const bad of [
      { ...pending, approved: true },
      { ...pending, input: { ...pending.input, privatePath: "PRIVATE" } },
      { ...pending, input: { ...pending.input, sourceFingerprint: "x" } },
    ])
      expect(() => parseMediaPending(bad, scope)).toThrow();
    expect(() =>
      parseMediaPending(pending, { projectId: uuid(), episodeId }),
    ).toThrow();
    expect(() =>
      parseMediaPending(pending, { projectId, episodeId: uuid() }),
    ).toThrow();
    expect(mediaPendingKey(projectId, episodeId)).toBe(
      `dramaip:media-review:${projectId}:${episodeId}`,
    );
  });
});

describe("the platform preflight view", () => {
  it("labels the original title, adopted revision, fingerprint and every unverified boundary", () => {
    const preflight = {
      ok: true,
      blockers: [],
      warnings: ["不是发行批准"],
      expectedFiles: ["dramaip-test.json"],
      finalBaseName: "dramaip-test",
      sourceFingerprint: digest,
      snapshot: {
        variant: { title: "原作者标题", version: 1, headRevision: 1 },
      },
    };
    const { container } = render(
      <PreflightView preflight={preflight as never} t={t} />,
    );
    const text = container.textContent ?? "";
    for (const expected of [
      "原作者标题",
      "采用修订1",
      digest,
      "仅提交资料元数据",
      "成片质量",
      "合法授权",
      "实际结算",
      "当前文件",
      "目标平台规格",
      "尚未生成／附加／读取",
      "不是发行批准",
      "dramaip-test",
    ])
      expect(text).toContain(expected);
    expect(screen.getByTestId("platform-metadata-original")).toBeTruthy();
  });

  it("names a failed preflight", () => {
    render(
      <PreflightView
        preflight={
          {
            ok: false,
            blockers: ["缺少标题"],
            warnings: [],
            expectedFiles: [],
            sourceFingerprint: digest,
          } as never
        }
        t={t}
      />,
    );
    expect(screen.getByText("预检未通过", { exact: true })).toBeTruthy();
    expect(screen.getByText("缺少标题")).toBeTruthy();
  });
});

describe("the original package owner evidence", () => {
  it("shows known blockers and boundaries and hands exact evidence to the media factory", () => {
    const evidence = { recordId: uuid() };
    const assetId = uuid();
    const value = {
      scope: "original-package-media-owner-metadata",
      state: "blocked",
      assets: [
        {
          id: assetId,
          version: 0,
          fingerprint: digest,
          binding: "exact",
          archiveBinding: "unbound",
          evidence,
        },
      ],
      blockers: [
        { recordId: assetId, code: "DECLARED_RIGHTS_RESTRICTED" },
        { recordId: assetId, code: "DECLARED_PROVIDER_UNAVAILABLE" },
        { recordId: assetId, code: "ORIGINAL_ARCHIVE_UNBOUND" },
      ],
      releaseReady: false,
    } as unknown as OwnerEvidence;
    const renderFactorySlot = vi.fn(() => null);
    render(
      <OwnerEvidenceView
        value={value}
        renderFactorySlot={renderFactorySlot as never}
        t={t}
      />,
    );
    const region = screen.getByRole("region", { name: "原包逐素材owner证据" });
    for (const code of [
      "DECLARED_RIGHTS_RESTRICTED",
      "DECLARED_PROVIDER_UNAVAILABLE",
      "ORIGINAL_ARCHIVE_UNBOUND",
      "人工审片决定与素材证据分别记录",
    ])
      expect(region.textContent).toContain(code);
    expect(renderFactorySlot).toHaveBeenCalledWith("media.delivery-evidence", {
      value: evidence,
    });
  });

  it("does not demand media for a package without any", () => {
    const renderFactorySlot = vi.fn(() => null);
    const { container } = render(
      <OwnerEvidenceView
        value={
          {
            scope: "original-package-media-owner-metadata",
            state: "no-media",
            assets: [],
            blockers: [],
            releaseReady: false,
          } as unknown as OwnerEvidence
        }
        renderFactorySlot={renderFactorySlot as never}
        t={t}
      />,
    );
    expect(container.textContent).toContain("不强制补媒体");
    expect(renderFactorySlot).not.toHaveBeenCalled();
  });
});

describe("the review record domains", () => {
  const ok = (value: unknown) => Promise.resolve({ ok: true as const, value });

  it("map the records workspace store onto the domain's calls", async () => {
    const review = {
      recordsList: vi.fn(() => ok([])),
      recordsCreate: vi.fn(() => ok({ id: "r1" })),
      recordsUpdate: vi.fn(() => ok({ id: "r1" })),
      recordsRemove: vi.fn(() => ok(undefined)),
    };
    const domain = recordDomain(
      "review",
      { review } as unknown as Pick<
        StageRemotes,
        "quality" | "review" | "delivery" | "system"
      >,
      t,
    );
    expect(domain.fields.map((field) => field.key)).toEqual([
      "审片方式",
      "审片状态",
      "评论",
      "决策与跟进",
    ]);
    await domain.store.list({ projectId: "p", parentId: "e" });
    expect(review.recordsList).toHaveBeenCalledWith({
      projectId: "p",
      parentId: "e",
    });
    await domain.store.list({ projectId: undefined, parentId: undefined });
    expect(review.recordsList).toHaveBeenLastCalledWith({});
    await domain.store.create({
      projectId: "p",
      parentId: "e",
      title: "审片",
      payload: {},
    } as never);
    expect(review.recordsCreate).toHaveBeenCalledWith(
      { projectId: "p", parentId: "e", title: "审片", payload: {} },
      undefined,
      undefined,
    );
    await domain.store.update("r1", { version: 3, title: "x" } as never);
    expect(review.recordsUpdate).toHaveBeenCalledWith(
      "r1",
      { version: 3, title: "x" },
      '"3"',
      undefined,
    );
    await domain.store.remove("r1");
    expect(review.recordsRemove).toHaveBeenCalledWith(
      "r1",
      undefined,
      undefined,
    );
  });

  it("offer subtitle exports on localization records", async () => {
    const delivery = {
      localizationSubtitles: vi.fn(() =>
        ok({ fileName: "a.srt", mimeType: "text/plain", content: "1" }),
      ),
    };
    const system = { saveTextFile: vi.fn(() => ok({ saved: true })) };
    const domain = recordDomain(
      "localization",
      { delivery, system } as unknown as Pick<
        StageRemotes,
        "quality" | "review" | "delivery" | "system"
      >,
      t,
    );
    const actions = domain.actions?.({ id: "l1" } as never, {}) ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(4);
  });
});
