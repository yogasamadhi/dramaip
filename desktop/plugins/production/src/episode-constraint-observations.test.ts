import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { creationReference } from "@dramaip/contracts/creation";
import type { EpisodeDevelopmentBasis } from "@dramaip/contracts/production";
import {
  observeConstraintRead,
  observeEpisodeConstraint,
} from "./episode-constraint-observations.js";

// Projection-only fixtures. Actual Kernel tests cover formal owner reads and SQLite recovery.
const id = "91000000-0000-4000-8000-000000000001";
const current = creationReference("author-intent", {
  id,
  version: 1,
  content: "PRIVATE SOURCE /private/path",
});
const frozen = {
  sourceKind: "author_intent" as const,
  sourceId: current.sourceId,
  sourceVersion: current.sourceVersion,
  fieldPath: current.fieldPath,
  contentHash: createHash("sha256")
    .update(JSON.stringify(current.value))
    .digest("hex"),
};
const basis: Pick<EpisodeDevelopmentBasis, "references"> = {
  references: [frozen],
};
it("constraint observation returns only exact frozen identity and actual content hashes without prose, paths or extra request fields", () => {
  const supplied = { id, version: 1, strategyId: "not-public" };
  const actual = observeEpisodeConstraint({
    basis,
    kind: "author-intent",
    frozen: supplied,
    current,
    readState: "available",
    currentSourceState: "stale",
  });
  expect(actual).toEqual({
    kind: "author-intent",
    frozen: { id, version: 1, contentHash: frozen.contentHash },
    current: { id, version: 1, contentHash: frozen.contentHash },
    readState: "available",
    currentSourceState: "stale",
    change: "same-reference",
  });
  expect(JSON.stringify(actual)).not.toMatch(
    /PRIVATE|private\/path|strategyId|not-public/u,
  );
});
it("constraint observation does not fabricate a frozen fingerprint from missing, duplicate or wrong exact path/version references", () => {
  for (const references of [
    [],
    [frozen, frozen],
    [{ ...frozen, fieldPath: "/other" }],
    [{ ...frozen, sourceVersion: 2 }],
  ]) {
    const actual = observeEpisodeConstraint({
      basis: { references },
      kind: "author-intent",
      frozen: { id, version: 1 },
      current,
      readState: "available",
    });
    expect(actual.frozen!.contentHash).toBeNull();
    expect(actual.current!.contentHash).toBe(frozen.contentHash);
    expect(actual.change).toBe("same-reference");
    expect(actual.currentSourceState).toBe("unverified");
  }
});
it("constraint reads distinguish actual absence from unavailable owner and strip every exception message", () => {
  expect(observeConstraintRead(() => undefined)).toEqual({
    readState: "available",
    value: undefined,
  });
  for (const reader of [
    undefined,
    () => {
      throw new Error("PRIVATE SOURCE /private/path");
    },
  ]) {
    const read = observeConstraintRead(reader);
    expect(read).toEqual({ readState: "unavailable", value: undefined });
    const actual = observeEpisodeConstraint({
      basis,
      kind: "author-intent",
      frozen: { id, version: 1 },
      current,
      readState: read.readState,
    });
    expect(actual.current).toBeNull();
    expect(actual.change).toBe("unavailable");
    expect(actual.currentSourceState).toBeNull();
    expect(JSON.stringify({ actual, read })).not.toContain("PRIVATE");
  }
  const removed = observeEpisodeConstraint({
    basis,
    kind: "author-intent",
    frozen: { id, version: 1 },
    current: undefined,
    readState: "available",
  });
  expect(removed.change).toBe("removed");
});
