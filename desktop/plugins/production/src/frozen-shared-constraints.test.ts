import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { creationReference } from "@dramaip/contracts/creation";
import type { EpisodeUpstreamConstraints } from "@dramaip/contracts/production";
import { frozenEpisodeSharedInputsMatch } from "./frozen-shared-constraints.js";

type Basis = Parameters<typeof frozenEpisodeSharedInputsMatch>[0];
function fixture() {
  const projectId = crypto.randomUUID();
  const refs = [0, 1, 2].map((version) => ({
    id: crypto.randomUUID(),
    version,
  }));
  const kinds = [
    "season-plan",
    "adaptation-diagnosis",
    "author-intent",
  ] as const;
  const references = refs.map((ref, index) => {
    const source = creationReference(kinds[index]!, {
      ...ref,
      content: "Original adopted shared value",
    });
    const sourceKind =
      index === 2 ? ("author_intent" as const) : ("production" as const);
    expect(source.sourceKind).toBe(sourceKind);
    return {
      sourceKind,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      fieldPath: source.fieldPath,
      contentHash: createHash("sha256")
        .update(JSON.stringify(source.value))
        .digest("hex"),
    };
  });
  const basis: Basis = {
    request: {
      seasonPlan: refs[0]!,
      episodeId: "stable-episode-0",
      episodeNarrativeContext: { format: "narrative-context-v1", chapters: [] },
    },
    authorIntent: refs[2]!,
    diagnosis: { ...refs[1]!, strategyId: "selected-original-strategy" },
    references,
    sourceBasis: {
      kind: "author-selected-narrative-sources",
      projectId,
      chapters: [],
      omitted: [],
      references: [],
    },
  };
  const observed: EpisodeUpstreamConstraints = {
    format: "formal-constraint-observations-v1",
    items: references.map((source, index) => ({
      kind: kinds[index]!,
      frozen: { ...refs[index]!, contentHash: source.contentHash },
      current: { ...refs[index]!, contentHash: source.contentHash },
      readState: "available",
      currentSourceState: index < 2 ? "stale" : "current",
      change: "same-reference",
    })),
    approvedStoryBible: {
      frozenCount: 0,
      currentCount: 0,
      readState: "available",
    },
  };
  return { basis, observed };
}
describe("M4 exact frozen shared constraints (not generation or semantic authority)", () => {
  it("compares all original actual values without upgrading parent source state or rewriting history", () => {
    const { basis, observed } = fixture(),
      before = structuredClone({ basis, observed });
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(true);
    expect({ basis, observed }).toEqual(before);
    expect(observed.items[0]!.currentSourceState).toBe("stale");
  });
  it("never applies to legacy inheritance or an absent explicit original source basis", () => {
    const { basis, observed } = fixture();
    expect(
      frozenEpisodeSharedInputsMatch(
        {
          ...basis,
          request: { ...basis.request, episodeNarrativeContext: undefined },
        },
        observed,
      ),
    ).toBe(false);
    expect(
      frozenEpisodeSharedInputsMatch(
        { ...basis, sourceBasis: undefined },
        observed,
      ),
    ).toBe(false);
    expect(
      frozenEpisodeSharedInputsMatch(
        { ...basis, diagnosis: undefined },
        observed,
      ),
    ).toBe(false);
  });
  it("rejects removed, replaced and modified shared heads rather than accepting equal counts", () => {
    for (const state of ["removed", "replaced", "changed"] as const) {
      const { basis, observed } = fixture(),
        item = observed.items[0]!;
      item.change = state;
      if (state === "removed") {
        item.current = null;
        item.currentSourceState = null;
      } else if (state === "replaced") item.current!.id = crypto.randomUUID();
      else item.current!.version++;
      expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
    }
  });
  it("same-version altered shared bytes do not clear a gate", () => {
    const { basis, observed } = fixture();
    observed.items[0]!.current!.contentHash = "a".repeat(64);
    observed.items[0]!.change = "changed";
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
  });
  it("unknown, absent, duplicate and different frozen hashes never prove equality", () => {
    for (const mode of ["unknown", "absent", "duplicate", "different"]) {
      const { basis, observed } = fixture();
      if (mode === "unknown") observed.items[0]!.frozen!.contentHash = null;
      else if (mode === "absent") basis.references.shift();
      else if (mode === "duplicate")
        basis.references.push(basis.references[0]!);
      else {
        observed.items[0]!.frozen!.contentHash = "b".repeat(64);
        observed.items[0]!.current!.contentHash = "b".repeat(64);
      }
      expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
    }
  });
  it("owner failures and unverified formal source-state responses stay rejected", () => {
    const { basis, observed } = fixture();
    observed.items[0]!.currentSourceState = "unverified";
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
    observed.items[0]!.readState = "unavailable";
    observed.items[0]!.current = null;
    observed.items[0]!.currentSourceState = null;
    observed.items[0]!.change = "unavailable";
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
  });
  it("does not invent an empty approved Bible collection when reading fails", () => {
    const { basis, observed } = fixture();
    observed.approvedStoryBible.readState = "unavailable";
    observed.approvedStoryBible.currentCount = null;
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
  });
  it("all original adopted Bible identities, order and known hashes are required", () => {
    const { basis, observed } = fixture();
    const ref = creationReference("knowledge", {
      id: crypto.randomUUID(),
      version: 0,
      content: "Original approved Bible",
    });
    expect(ref.sourceKind).toBe("knowledge");
    const source = {
      sourceKind: "knowledge" as const,
      sourceId: ref.sourceId,
      sourceVersion: ref.sourceVersion,
      fieldPath: ref.fieldPath,
      contentHash: createHash("sha256")
        .update(JSON.stringify(ref.value))
        .digest("hex"),
    };
    basis.references.push(source);
    observed.approvedStoryBible = {
      frozenCount: 1,
      currentCount: 1,
      readState: "available",
    };
    const snapshot = {
      id: source.sourceId,
      version: source.sourceVersion,
      contentHash: source.contentHash,
      position: 0,
    };
    observed.items.push({
      kind: "story-bible",
      frozen: { ...snapshot },
      current: { ...snapshot },
      currentSourceState: "unverified",
      readState: "available",
      change: "same-reference",
    });
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(true);
    observed.items.at(-1)!.current!.version++;
    observed.items.at(-1)!.change = "changed";
    expect(frozenEpisodeSharedInputsMatch(basis, observed)).toBe(false);
  });
});
