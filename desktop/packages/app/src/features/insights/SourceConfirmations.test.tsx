import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreativeSourceConfirmationSummarySchema } from "@dramaip/contracts/insights";
import { SourceConfirmations } from "./SourceConfirmations";

const empty = {
  historyPolicy: "recorded-owner-source-confirmations-only",
  unit: "owner-and-original-source-id",
  recordedConfirmations: 0,
  byWorkflow: [
    { workflowPath: "novel", total: 0 },
    { workflowPath: "adaptation", total: 0 },
    { workflowPath: null, total: 0 },
  ],
  items: [],
};
test("source confirmation view adds no empty section or fabricated historical confirmation", () => {
  expect(
    renderToStaticMarkup(
      <SourceConfirmations
        value={CreativeSourceConfirmationSummarySchema.parse(empty)}
      />,
    ),
  ).toBe("");
});
test("native source view preserves exact preview, document and script references without certifying losslessness or copyright", () => {
  const entry = {
    kind: "script-document",
    sourceIndex: 0,
    previewEntryId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    version: 0,
    scriptId: crypto.randomUUID(),
    scriptVersion: 0,
  };
  const item = {
    eventVersion: 1,
    owner: "production",
    sourceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    projectVersion: 1,
    projectMode: "single_season",
    workflowPath: "adaptation",
    entry: "native-screenplay-intake",
    sourceFormat: "fdx",
    contentKind: "script",
    scopePolicy: "confirmed-parsed-entries-not-entire-file",
    entryCount: 1,
    sceneCount: 0,
    bindingFingerprint: "a".repeat(64),
    receiptFingerprint: "b".repeat(64),
    rightsState: "declared-not-verified",
    lossReportReviewed: true,
    evidenceKind: "explicit-source-declaration-and-owner-commit",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "not-assessed",
    entries: [entry],
    eventId: crypto.randomUUID(),
    cursor: 2,
    occurredAt: "2026-10-04T00:00:00.000Z",
    bindingDisplay: "first-five-original-bindings",
  };
  const html = renderToStaticMarkup(
    <SourceConfirmations
      value={CreativeSourceConfirmationSummarySchema.parse({
        ...empty,
        recordedConfirmations: 1,
        byWorkflow: [
          { workflowPath: "novel", total: 0 },
          { workflowPath: "adaptation", total: 1 },
          { workflowPath: null, total: 0 },
        ],
        items: [item],
      })}
    />,
  );
  for (const identity of [entry.previewEntryId, entry.id, entry.scriptId])
    expect(html).toContain(identity);
  expect(html).toContain("原生剧本导入");
  expect(html).toContain("不认证转换无损或授权");
  expect(html).toContain("当前有效性未评估");
  expect(html).not.toContain("<button");
});
test("source confirmation view displays bounded original IDs and unknown evidence without actions or forcing other modes into novel goals", () => {
  const entries = Array.from({ length: 5 }, (_, sourceIndex) => ({
    kind: "chapter",
    sourceIndex,
    id: crypto.randomUUID(),
    version: 0,
  }));
  const item = {
    eventVersion: 1,
    owner: "workspace",
    sourceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    projectVersion: 3,
    projectMode: "personal_theater",
    workflowPath: null,
    entry: "ordinary-import",
    sourceFormat: "markdown",
    contentKind: "novel",
    scopePolicy: "confirmed-parsed-entries-not-entire-file",
    entryCount: 8,
    sceneCount: 0,
    bindingFingerprint: "a".repeat(64),
    receiptFingerprint: "b".repeat(64),
    rightsState: "declared-not-verified",
    evidenceKind: "explicit-source-declaration-and-owner-commit",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "not-assessed",
    entries,
    eventId: crypto.randomUUID(),
    cursor: 2,
    occurredAt: "2026-10-04T00:00:00.000Z",
    bindingDisplay: "first-five-original-bindings",
  };
  const html = renderToStaticMarkup(
    <SourceConfirmations
      value={CreativeSourceConfirmationSummarySchema.parse({
        ...empty,
        recordedConfirmations: 1,
        byWorkflow: [
          { workflowPath: "novel", total: 0 },
          { workflowPath: "adaptation", total: 0 },
          { workflowPath: null, total: 1 },
        ],
        items: [item],
      })}
    />,
  );
  expect(html).toContain("其他项目模式 1");
  expect(html).toContain("原解析条目 8");
  expect(html).toContain("每次最多前 5 个原绑定");
  expect(html.match(/data-original-source-binding-id=/g)).toHaveLength(5);
  for (const entry of entries) expect(html).toContain(`${entry.id} @ 0`);
  expect(html).toContain("当前有效性未评估");
  expect(html).toContain("权利声明未核验");
  expect(html).toContain("项目产品路径不是创建时明确目标");
  expect(html).toContain("无正文、文件名、路径、grant 或外部遥测");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("先完成小说");
});
