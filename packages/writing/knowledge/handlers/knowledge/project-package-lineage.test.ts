import { expect, test } from "vitest";
import { projectPackageLineage } from "./project-package-lineage.js";
import { CreativePackageAssetsSchema } from "@dramaip/contracts";

const nodeId = crypto.randomUUID(),
  sourceId = crypto.randomUUID(),
  now = new Date().toISOString();
const assets = CreativePackageAssetsSchema.parse({
  corpusItems: [],
  causalNodes: [
    {
      id: nodeId,
      kind: "character",
      title: "作者明确允许的角色",
      summary: "正式故事摘要",
      sourceType: "manual",
      sourceId,
      sourceVersion: 2,
      confirmed: true,
      version: 3,
      createdAt: now,
      updatedAt: now,
    },
  ],
  causalEdges: [],
  audienceStates: [],
  provenance: [
    {
      id: crypto.randomUUID(),
      fromType: "story_node",
      fromId: nodeId,
      relation: "derived_from",
      toType: "manuscript",
      toId: sourceId,
      quoteExcerpt: "SYNTHETIC_UNNECESSARY_CONTEXT",
      version: 2,
      createdAt: now,
    },
  ],
});
test("export policy preserves actual opaque lineage and original records, but non-quote relationships do not export an unnecessary excerpt", () => {
  const before = JSON.stringify(assets),
    exported = projectPackageLineage(assets);
  expect(exported.provenance[0]).toEqual({
    ...assets.provenance[0],
    quoteExcerpt: undefined,
  });
  expect(exported.provenance[0]).not.toHaveProperty("quoteExcerpt");
  expect(exported.causalNodes).toEqual(assets.causalNodes);
  expect(JSON.stringify(assets)).toBe(before);
  expect(CreativePackageAssetsSchema.safeParse(exported).success).toBe(true);
});
test("actual quoted_from excerpts retain their permitted bounded content without pretending to grant rights", () => {
  const quoted = CreativePackageAssetsSchema.parse({
    ...assets,
    provenance: [
      {
        ...assets.provenance[0],
        relation: "quoted_from",
        quoteExcerpt: "作者提交的短引用，仍须人工核查权利",
      },
    ],
  });
  expect(projectPackageLineage(quoted)).toEqual(quoted);
});
test("local source paths are refused before export, with a body-free explanation and no source record mutation", () => {
  for (const path of [
    "/synthetic/private/SYNTHETIC_PATH",
    "C:\\synthetic\\private\\SYNTHETIC_PATH",
    "\\\\synthetic\\private\\SYNTHETIC_PATH",
    "~/synthetic/private/SYNTHETIC_PATH",
    "file:///synthetic/private/SYNTHETIC_PATH",
  ]) {
    const before = JSON.stringify(assets);
    for (const unsafe of [
      {
        ...assets,
        causalNodes: [{ ...assets.causalNodes[0]!, sourceId: path }],
      },
      { ...assets, provenance: [{ ...assets.provenance[0]!, fromId: path }] },
      { ...assets, provenance: [{ ...assets.provenance[0]!, toId: path }] },
    ]) {
      expect(() => projectPackageLineage(unsafe)).toThrow("不透明来源引用");
      try {
        projectPackageLineage(unsafe);
      } catch (error) {
        expect((error as Error).message).not.toContain("SYNTHETIC_PATH");
      }
    }
    expect(JSON.stringify(assets)).toBe(before);
  }
});
