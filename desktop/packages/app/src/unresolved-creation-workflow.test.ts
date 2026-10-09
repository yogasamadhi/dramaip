import { describe, expect, it } from "bun:test";
import {
  CreationWorkflowSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { selectUnresolvedCreationWorkflow } from "./unresolved-creation-workflow";

function workflow(stage: CreationWorkflow["stage"], index = 1) {
  return CreationWorkflowSchema.parse({
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    taskId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    input: {
      projectId: "30000000-0000-4000-8000-000000000001",
      operation: "episode-script",
      instruction: "PRIVATE precise frozen request",
      engineKind: "pi",
    },
    stage,
    version: 1,
    runIds: [],
    contextSnapshotIds: [],
    sources: [],
    preparedPrompt: "PRIVATE frozen prompt",
    issues: [],
    createdAt: `2026-10-03T00:00:${String(index).padStart(2, "0")}.000Z`,
    updatedAt: "2026-10-03T00:01:00.000Z",
  });
}

describe("unresolved workflow selection after the caller has checked the formal basis", () => {
  it.each([
    "preparing",
    "generating",
    "checking",
    "revising",
    "rechecking",
  ] as const)(
    "keeps an actual older %s run behind a newer terminal record",
    (stage) => {
      const original = workflow(stage);
      expect(
        selectUnresolvedCreationWorkflow([workflow("canceled", 2), original]),
      ).toBe(original);
    },
  );
  it("prefers a pending author decision over a newer active run", () => {
    const pending = workflow("awaiting-review");
    expect(
      selectUnresolvedCreationWorkflow([workflow("checking", 2), pending]),
    ).toBe(pending);
  });
  it("returns the newest pending record and never mutates the caller's history", () => {
    const older = workflow("awaiting-review");
    const newer = workflow("awaiting-review", 2);
    const history = Object.freeze([older, workflow("canceled", 3), newer]);
    const original = JSON.stringify(history);
    expect(selectUnresolvedCreationWorkflow(history)).toBe(newer);
    expect(JSON.stringify(history)).toBe(original);
  });
  it.each(["canceled", "discarded", "applied"] as const)(
    "still suppresses historical failures behind the latest %s when no unresolved run exists",
    (stage) => {
      expect(
        selectUnresolvedCreationWorkflow([
          workflow("failed"),
          workflow(stage, 2),
        ]),
      ).toBeUndefined();
    },
  );
  it("keeps the actual latest failure rather than returning an older failure", () => {
    const current = workflow("interrupted", 2);
    expect(
      selectUnresolvedCreationWorkflow([workflow("failed"), current]),
    ).toBe(current);
    expect(selectUnresolvedCreationWorkflow([])).toBeUndefined();
  });
});
