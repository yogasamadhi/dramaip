import { describe, expect, test } from "bun:test";
import type {
  CreativeDiagnostic,
  CreativeIssueAcknowledgement,
} from "@dramaip/contracts/product";
import {
  readLegacyAcknowledgementHistory,
  readLegacyDiagnosticHistory,
  readLegacyEpisodeAnalysis,
  isLegacyQualityTask,
} from "./legacy-quality-history";

const old: CreativeDiagnostic = {
  id: "original",
  projectId: "project",
  targetKind: "project",
  targetTitle: "原项目",
  kind: "quality_gate",
  title: "旧报告",
  summary: "旧未认证结论原文",
  scores: [{ label: "原量纲未知", value: 72 }],
  findings: ["原问题"],
  recommendations: ["原建议"],
  curve: [35, 52, 68, 81],
  sourceFingerprint: "old-request-hash-not-a-content-hash",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const ack: CreativeIssueAcknowledgement = {
  id: "old-ack",
  projectId: "project",
  diagnosticId: old.id,
  issueKey: "原问题",
  disposition: "fixed",
  note: "旧人工声明",
  createdAt: old.createdAt,
};
describe("legacy history read identity never certifies quality", () => {
  test("legacy zero analysis and tasks remain unverified, successful 204 is distinct from a pending read", () => {
    const analysis = {
      id: "original",
      adaptationId: "adaptation",
      episodeCount: 0,
      hookCoverage: 0,
      cliffhangerCoverage: 0,
      outlineCoverage: 0,
      overallScore: 0,
      summary: "原零结论",
      suggestions: ["原建议"],
      createdAt: old.createdAt,
      updatedAt: old.createdAt,
    };
    expect(readLegacyEpisodeAnalysis(analysis, "adaptation")).toEqual(analysis);
    expect(readLegacyEpisodeAnalysis(undefined, "adaptation")).toBeNull();
    expect(readLegacyEpisodeAnalysis(null, "adaptation")).toBeNull();
    for (const value of [
      { ...analysis, adaptationId: "other" },
      { ...analysis, hookCoverage: NaN },
      { ...analysis, episodeCount: 1.5 },
      { ...analysis, suggestions: null },
    ])
      expect(() => readLegacyEpisodeAnalysis(value, "adaptation")).toThrow();
    expect(isLegacyQualityTask("quality-check")).toBe(true);
    expect(isLegacyQualityTask("creative_diagnostics")).toBe(true);
    expect(isLegacyQualityTask("creation.quality-review")).toBe(false);
  });
  test("keeps the entire original values, unknown scale and old declaration unchanged", () => {
    expect(readLegacyDiagnosticHistory([old], "project")).toEqual([old]);
    expect(readLegacyDiagnosticHistory([old], "project")[0]).toBe(old);
    expect(readLegacyAcknowledgementHistory([ack], "project")).toEqual([ack]);
    expect(readLegacyDiagnosticHistory([], "project")).toEqual([]);
  });
  test("refuses the entire malformed, duplicate or foreign-project response", () => {
    for (const value of [
      null,
      {},
      [old, old],
      [{ ...old, projectId: "other" }],
      [{ ...old, scores: [{ label: "x", value: NaN }] }],
      [{ ...old, curve: [Infinity] }],
      [{ ...old, kind: "fake" }],
      [{ ...old, recommendations: null }],
    ])
      expect(() => readLegacyDiagnosticHistory(value, "project")).toThrow();
    for (const value of [
      [ack, ack],
      [{ ...ack, projectId: "other" }],
      [{ ...ack, disposition: "certified" }],
      [{ ...ack, note: 42 }],
    ])
      expect(() =>
        readLegacyAcknowledgementHistory(value, "project"),
      ).toThrow();
  });
});
