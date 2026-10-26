import { expect, test } from "vitest";
import {
  ProductionRecordMergeRequestSchema,
  ProductionRecordMergeSourceSchema,
} from "@dramaip/contracts/production";
import {
  freezeProductionRecordMergeRequest,
  readProductionRecordMergeRequest,
  clearExactProductionRecordMergeRequest,
  productionRecordMergeStorageKey,
} from "./production-record-merge-recovery";

const projectId = "92000000-0000-4000-8000-000000000001",
  id = "92000000-0000-4000-8000-000000000002",
  baseId = "92000000-0000-4000-8000-000000000003";
const input = {
  format: "storyboard-record-field-merge-request-v1" as const,
  projectId,
  episodeId: "pilot",
  workflow: { id, version: 7 },
  base: { id: baseId, version: 2 },
  comparisonHash: "a".repeat(64),
  choices: { [`${id}:镜头描述`]: "main" as const },
  reviewed: true as const,
  modelDisclosureConfirmed: true as const,
};
test("actual-field recovery stores only the exact original identities, choices and key and never upgrades to a new comparison", () => {
  const request = freezeProductionRecordMergeRequest(input),
    raw = JSON.stringify(request);
  expect(
    readProductionRecordMergeRequest(raw, projectId, id, "pilot", baseId),
  ).toEqual(request);
  expect(
    readProductionRecordMergeRequest(null, projectId, id, "pilot", baseId),
  ).toBeUndefined();
  for (const scope of [
    [baseId, id, "pilot", baseId],
    [projectId, baseId, "pilot", baseId],
    [projectId, id, "other", baseId],
    [projectId, id, "pilot", id],
  ])
    expect(() =>
      readProductionRecordMergeRequest(
        raw,
        scope[0]!,
        scope[1]!,
        scope[2]!,
        scope[3]!,
      ),
    ).toThrow();
  expect(() =>
    readProductionRecordMergeRequest(
      JSON.stringify({ ...request, prose: "不该存本地" }),
      projectId,
      id,
      "pilot",
      baseId,
    ),
  ).toThrow();
  expect(raw).not.toContain("text");
  expect(raw).not.toContain("candidate");
  expect(request.input.workflow.version).toBe(7);
  expect(request.input.comparisonHash).toBe(input.comparisonHash);
});
test("confirmed-structure recovery retains only the original v2 structural hash and choices without copying maps or upgrading v1", () => {
  const mapped = {
    ...input,
    format: "storyboard-record-field-merge-request-v2" as const,
    structureHash: "c".repeat(64),
  };
  const request = freezeProductionRecordMergeRequest(mapped),
    raw = JSON.stringify(request);
  expect(
    readProductionRecordMergeRequest(raw, projectId, id, "pilot", baseId),
  ).toEqual(request);
  expect(request.input).toEqual(mapped);
  expect(raw).not.toContain("sceneMappings");
  expect(raw).not.toContain("text");
  expect(freezeProductionRecordMergeRequest(input).input.format).toBe(
    "storyboard-record-field-merge-request-v1",
  );
  for (const changed of [
    { ...mapped, structureHash: undefined },
    { ...mapped, sceneMappings: [] },
    { ...input, structureHash: mapped.structureHash },
  ])
    expect(ProductionRecordMergeRequestSchema.safeParse(changed).success).toBe(
      false,
    );
});
test("actual-field request rejects unsafe raw keys, arbitrary metadata, false disclosure and malformed choices before normalization", () => {
  expect(ProductionRecordMergeRequestSchema.safeParse(input).success).toBe(
    true,
  );
  for (const changed of [
    { ...input, choices: JSON.parse('{"__proto__":"main"}') },
    { ...input, choices: { constructor: "main" } },
    { ...input, choices: { [`${id}:payload`]: "main" } },
    { ...input, choices: { [`${id}:镜头描述`]: "delete" } },
    { ...input, choices: Object.create({ [`${id}:镜头描述`]: "main" }) },
    { ...input, reviewed: false },
    { ...input, modelDisclosureConfirmed: false },
    { ...input, comparison: { raw: "不能冻结客户端伪造正文" } },
  ])
    expect(ProductionRecordMergeRequestSchema.safeParse(changed).success).toBe(
      false,
    );
  expect(
    ProductionRecordMergeSourceSchema.safeParse({
      format: "storyboard-record-field-merge-v1",
      request: input,
      comparison: {},
      outputHash: "a".repeat(64),
    }).success,
  ).toBe(false);
});
test("author shot-plan v3 recovery stores no structure or prose and retains the exact protocol and original key", () => {
  const planned = {
    ...input,
    format: "storyboard-record-field-merge-request-v3" as const,
    structureHash: "d".repeat(64),
  };
  const request = freezeProductionRecordMergeRequest(planned),
    raw = JSON.stringify(request);
  expect(
    readProductionRecordMergeRequest(raw, projectId, id, "pilot", baseId),
  ).toEqual(request);
  expect(request.input).toEqual(planned);
  expect(raw).not.toContain("scenePlans");
  expect(raw).not.toContain("text");
  expect(
    readProductionRecordMergeRequest(raw, projectId, id, "pilot", baseId)!.key,
  ).toBe(request.key);
  for (const invalid of [
    { ...planned, structureHash: undefined },
    { ...planned, scenePlans: [] },
    { ...planned, text: "不能存正文" },
    { ...input, structureHash: planned.structureHash },
  ])
    expect(ProductionRecordMergeRequestSchema.safeParse(invalid).success).toBe(
      false,
    );
});
test("late actual-field response cannot clear a different or newer local request", () => {
  const request = freezeProductionRecordMergeRequest(input),
    newer = freezeProductionRecordMergeRequest({
      ...input,
      comparisonHash: "b".repeat(64),
    });
  let raw: string | null = JSON.stringify(newer),
    removes = 0;
  const storage = {
    getItem: (key: string) => {
      expect(key).toBe(productionRecordMergeStorageKey(projectId, id));
      return raw;
    },
    removeItem: () => {
      removes++;
      raw = null;
    },
  };
  expect(clearExactProductionRecordMergeRequest(storage, request)).toBe(false);
  expect(removes).toBe(0);
  expect(clearExactProductionRecordMergeRequest(storage, newer)).toBe(true);
  expect(raw).toBeNull();
  expect(removes).toBe(1);
});
