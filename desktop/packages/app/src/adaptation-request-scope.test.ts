import { describe, expect, test } from "vitest";
import type {
  DiagnosisRequest,
  SeasonPlanRequest,
} from "@dramaip/contracts/production";
import {
  sameDiagnosisRequest,
  sameSeasonPlanRequest,
} from "./adaptation-request-scope";

const chapter = { id: crypto.randomUUID(), version: 2 };
const summary = { id: crypto.randomUUID(), version: 1 };
const request: DiagnosisRequest = {
  scope: "selected-chapters",
  chapters: [chapter],
  inventoryFingerprint: "a".repeat(64),
  authorIntent: { id: crypto.randomUUID(), version: 1 },
  rightsDeclared: true,
  target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
  context: {
    format: "narrative-context-v1",
    chapters: [
      { ...chapter, representation: "paragraphs", paragraphIds: ["actual"] },
    ],
    summaries: [summary],
  },
};

describe("confirmed adaptation request identity", () => {
  test("canonical object order matches but expression and scope substitutions never do", () => {
    const equivalent: DiagnosisRequest = {
      ...request,
      context: {
        summaries: [{ version: summary.version, id: summary.id }],
        chapters: [
          {
            paragraphIds: ["actual"],
            representation: "paragraphs",
            version: chapter.version,
            id: chapter.id,
          },
        ],
        format: "narrative-context-v1",
      },
    };
    expect(sameDiagnosisRequest(request, equivalent)).toBe(true);
    expect(sameDiagnosisRequest(undefined, request)).toBe(false);
    for (const changed of [
      { ...request, context: undefined },
      {
        ...request,
        context: {
          ...request.context!,
          chapters: [{ ...chapter, representation: "original" as const }],
        },
      },
      {
        ...request,
        context: {
          ...request.context!,
          summaries: [{ ...summary, version: 2 }],
        },
      },
      {
        ...request,
        context: {
          ...request.context!,
          chapters: [
            {
              ...chapter,
              representation: "paragraphs" as const,
              paragraphIds: ["other"],
            },
          ],
        },
      },
      { ...request, chapters: [{ ...chapter, version: 3 }] },
      { ...request, inventoryFingerprint: "b".repeat(64) },
      { ...request, target: { ...request.target, episodeCount: 3 } },
      { ...request, authorIntent: { ...request.authorIntent, version: 2 } },
    ])
      expect(sameDiagnosisRequest(request, changed)).toBe(false);
  });
  test("season selection binds the exact adopted diagnosis, strategy and plan head", () => {
    const plan: SeasonPlanRequest = {
      diagnosis: {
        id: crypto.randomUUID(),
        version: 1,
        strategyId: "faithful",
      },
      baseAdoptedId: crypto.randomUUID(),
    };
    expect(
      sameSeasonPlanRequest(plan, {
        baseAdoptedId: plan.baseAdoptedId,
        diagnosis: {
          strategyId: "faithful",
          version: 1,
          id: plan.diagnosis.id,
        },
      }),
    ).toBe(true);
    expect(sameSeasonPlanRequest(undefined, plan)).toBe(false);
    for (const changed of [
      { ...plan, diagnosis: { ...plan.diagnosis, version: 2 } },
      { ...plan, diagnosis: { ...plan.diagnosis, id: crypto.randomUUID() } },
      { ...plan, diagnosis: { ...plan.diagnosis, strategyId: "reorder" } },
      { ...plan, baseAdoptedId: undefined },
    ])
      expect(sameSeasonPlanRequest(plan, changed)).toBe(false);
  });
});
