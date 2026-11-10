// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type { DeliveryEvidenceResult } from "@dramaip/production-media/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryEvidence } from "../src/client/evidence/DeliveryEvidence.tsx";
import { zh } from "../src/client/locale.ts";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"media">;

const base = {
  recordId: "r-1",
  projectId: "p-1",
  recordVersion: 4,
  kind: "image",
  scope: "exact-media-record-metadata",
  releaseReady: false,
  qualityState: "unverified",
  settlementState: "unknown",
  currentFileIntegrity: "not-read",
  declarations: {
    rightsStatus: "restricted",
    rightsDeclaration: "user-reported-restricted",
    costStatus: "unknown",
    costDeclaration: "not-provided",
    providerStatus: "unknown",
    providerDeclaration: "user-reported-not-required",
  },
  source: {
    recordId: "r-1",
    recordVersion: 4,
    state: "stale",
    verification: "actual-record-version-only",
    reasons: [],
  },
  blockers: ["DECLARED_RIGHTS_RESTRICTED", "SOURCE_STALE"],
} as unknown as DeliveryEvidenceResult;

describe("the delivery evidence", () => {
  it("names the exact version, the declarations and every blocker", () => {
    render(<DeliveryEvidence value={base} t={t} />);
    const view = screen.getByTestId("media-delivery-evidence-result");
    expect(view.textContent).toContain("原素材 r-1 · v4");
    expect(view.textContent).toContain(
      "实际来源：原来源已变化；可编辑权利声明：用户声明受限／撤回／过期；费用声明：未提供声明；服务声明：用户声明无需服务。",
    );
    expect(view.textContent).toContain("没有当前精确版本的单一有效素材 存档");
    expect(view.textContent).toContain("没有已记录的原版本完整读取凭证");
    expect(screen.getByRole("alert").textContent).toBe(
      "已知阻断：用户声明权利受限、撤回或过期（DECLARED_RIGHTS_RESTRICTED） · 原来源已变化（SOURCE_STALE）",
    );
  });

  it("shows the archive and the latest read without calling them a check of now", () => {
    render(
      <DeliveryEvidence
        value={
          {
            ...base,
            blockers: [],
            archive: { artifactId: "a-1", sizeBytes: 12, sha256: "abc" },
            latestByteRead: {
              id: "v-1",
              verifiedAt: "2026-11-01",
              descriptor: { sha256: "abc" },
              currentArchiveBinding: "matching-archive-metadata",
            },
          } as unknown as DeliveryEvidenceResult
        }
        t={t}
      />,
    );
    const text = screen.getByTestId(
      "media-delivery-evidence-result",
    ).textContent;
    expect(text).toContain(
      "原素材存档 a-1 · 12 字节 · SHA abc（不是本次字节验证）",
    );
    expect(text).toContain(
      "最近原版本完整读取凭证 v-1 · 2026-11-01 · SHA abc · 与当前存档元数据一致（未重读字节）",
    );
    expect(text).toContain("本次元数据没有已知负面标记");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
