import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type {
  EpisodeDevelopmentImpact,
  StoryboardAttributionImpact,
} from "@dramaip/contracts/production";
import {
  EpisodeUpstreamConstraintsSchema,
  episodeConstraintChange,
} from "@dramaip/contracts/production";
import {
  currentEpisodeImpact,
  episodeImpactIdentityMatches,
} from "./episode-impact-view";

const reference = {
  id: "91000000-0000-4000-8000-000000000001",
  projectId: "91000000-0000-4000-8000-000000000002",
  episodeId: "contract-only-episode",
  version: 2,
};
const other = "91000000-0000-4000-8000-000000000003";
// Contract-only transport sample, not a manuscript, semantic result or real owner report.
const report: EpisodeDevelopmentImpact = {
  result: { id: reference.id, version: reference.version },
  projectId: reference.projectId,
  episodeId: reference.episodeId,
  isCurrent: true,
  sourceState: "current",
  staleReasons: [],
  script: {
    id: null,
    result: null,
    frozenDocumentVersion: null,
    currentDocumentVersion: null,
  },
  blockChanges: [],
  shots: [],
  globalReviewReasons: ["Contract sample cannot localize any real source."],
  comparison: "frozen-script-to-actual-document-and-record-versions-v1",
  semanticVerification: "unverified",
  automaticRedo: false,
  snapshotHash: "a".repeat(64),
};
function transport(value: unknown, status = 200) {
  const calls: { path: string; method: string }[] = [];
  const searches: string[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: reference.projectId,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      searches.push(new URL(request.url).search);
      calls.push({
        path: new URL(request.url).pathname,
        method: request.method,
      });
      return Response.json(value, { status });
    },
  });
  return { sdk: sdk.episodeDevelopments, calls, searches };
}

const selectedAttribution = { id: other, version: 1 };
const snapshotRecord = (id: string) => ({
  id,
  version: 0,
  contentHash: "b".repeat(64),
});
const originalLink = {
  sceneId: "scene-1",
  shotId: "shot-1",
  blockIds: [other],
  evidenceId: "evidence-1",
  matchIndex: 1,
  evidence: {
    sceneId: "scene-1",
    evidenceId: "evidence-1",
    source: {
      sourceKind: "chapter" as const,
      sourceId: other,
      sourceVersion: 4,
      fieldPath: `/chapters/${other}`,
      contentHash: "c".repeat(64),
    },
    valuePath: "/content",
    quoteHash: "a".repeat(64),
    quoteCharacters: 3,
    offsetUnit: "utf16-code-unit" as const,
    match: { start: 6, end: 9, chapterStart: 6, chapterEnd: 9 },
    attribution: "model-declared" as const,
    matchVerification: "rule" as const,
    semanticVerification: "unverified" as const,
  },
  attribution: "human-declared" as const,
  matchVerification: "rule" as const,
  semanticVerification: "unverified" as const,
};
// Strict contract-only sample. No real prose, owner state or semantic evidence.
const attributionImpact: StoryboardAttributionImpact = {
  format: "exact-shot-attribution-impact-v1",
  projectId: reference.projectId,
  episodeId: reference.episodeId,
  attribution: selectedAttribution,
  storyboard: { id: reference.id, version: reference.version },
  isCurrent: false,
  sourceFingerprint: "a".repeat(64),
  associationFingerprint: "b".repeat(64),
  coverage: {
    totalShots: 1,
    associatedShots: 1,
    nodeAssociatedShots: 0,
    associatedBlockCount: 1,
    unassociatedShotIds: [],
  },
  links: [
    {
      index: 0,
      original: originalLink,
      quote: {
        frozenVerified: true,
        readState: "available",
        currentSourceVersion: 4,
        expressionHash: "b".repeat(64),
        currentSliceHash: "a".repeat(64),
        comparison: "same-position-match",
        sourceBlock: null,
        paragraph: null,
      },
      blocks: [
        {
          id: other,
          frozen: {
            id: other,
            index: 2,
            type: "action",
            contentHash: "b".repeat(64),
          },
          current: {
            id: other,
            index: 2,
            type: "action",
            contentHash: "b".repeat(64),
          },
          readState: "available",
          change: "same-reference",
        },
      ],
      records: {
        scene: {
          frozen: snapshotRecord(reference.id),
          current: { ...snapshotRecord(reference.id), retired: false },
          readState: "available",
          change: "same-reference",
        },
        shot: {
          frozen: snapshotRecord(other),
          current: { ...snapshotRecord(other), retired: false },
          readState: "available",
          change: "same-reference",
        },
      },
      node: null,
      reasonCodes: [],
      associationImpact: "no-observed-change",
    },
  ],
  textIncluded: false,
  semanticVerification: "unverified",
  automaticRedo: false,
};
test("explicit original attribution impact SDK sends the exact ID/version once and preserves original links, including historical adopted metadata", async () => {
  const value = { ...report, attributionImpact };
  const { sdk, calls, searches } = transport(value);
  expect(
    await sdk.impact(reference.id, reference, selectedAttribution),
  ).toEqual(value);
  expect(calls).toEqual([
    {
      path: `/api/v2/episode-development/${reference.id}/impact`,
      method: "GET",
    },
  ]);
  expect(searches).toEqual([`?attributionId=${other}&attributionVersion=1`]);
  await expect(
    transport(value).sdk.impact(reference.id, reference),
  ).rejects.toThrow();
  await expect(
    transport(report).sdk.impact(reference.id, reference, selectedAttribution),
  ).rejects.toThrow();
});
test("explicit attribution impact SDK rejects mismatches, private bodies and false unchanged/coverage claims without falling back", async () => {
  const link = attributionImpact.links[0]!;
  for (const mutation of [
    { attribution: { ...selectedAttribution, version: 2 } },
    { attribution: { id: reference.id, version: 1 } },
    { projectId: other },
    { episodeId: "another-episode" },
    { storyboard: { ...attributionImpact.storyboard, version: 3 } },
    { textIncluded: true },
    { automaticRedo: true },
    { semanticVerification: "verified" },
    {
      links: [
        { ...link, original: { ...link.original, rationale: "PRIVATE body" } },
      ],
    },
    {
      links: [
        { ...link, quote: { ...link.quote, currentSliceHash: "d".repeat(64) } },
      ],
    },
    {
      links: [{ ...link, quote: { ...link.quote, readState: "unavailable" } }],
    },
    {
      links: [
        {
          ...link,
          blocks: [
            {
              ...link.blocks[0],
              current: {
                ...link.blocks[0]!.current,
                contentHash: "d".repeat(64),
              },
            },
          ],
        },
      ],
    },
    {
      links: [
        {
          ...link,
          node: {
            readState: "unavailable",
            observation: null,
            referenceComparison: "unavailable",
          },
        },
      ],
    },
    {
      links: [
        {
          ...link,
          reasonCodes: ["story-node-unavailable"],
          associationImpact: "no-observed-change",
        },
      ],
    },
    { coverage: { ...attributionImpact.coverage, totalShots: 2 } },
  ]) {
    const { sdk, calls } = transport({
      ...report,
      attributionImpact: { ...attributionImpact, ...mutation },
    });
    await expect(
      sdk.impact(reference.id, reference, selectedAttribution),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
});
test("impact presentation isolates exact selected association version and hides warm/failed/late reads", () => {
  const value = { ...report, attributionImpact };
  const state = {
    reference,
    report: value,
    attribution: selectedAttribution,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentEpisodeImpact(state)).toBe(value);
  for (const change of [
    { attribution: undefined },
    { attribution: { ...selectedAttribution, version: 2 } },
    { opened: false },
    { fetching: true },
    { error: true },
    { report },
  ])
    expect(currentEpisodeImpact({ ...state, ...change })).toBeUndefined();
  expect(episodeImpactIdentityMatches(reference, value)).toBe(false);
  expect(
    episodeImpactIdentityMatches(reference, value, selectedAttribution),
  ).toBe(true);
});

test("impact SDK reads only the requested original result and preserves historical stale/global-review evidence", async () => {
  for (const value of [
    report,
    {
      ...report,
      isCurrent: false,
      sourceState: "stale" as const,
      staleReasons: ["Original source changed"],
    },
  ]) {
    const { sdk, calls } = transport(value);
    expect(await sdk.impact(reference.id, reference)).toEqual(value);
    expect(calls).toEqual([
      {
        path: `/api/v2/episode-development/${reference.id}/impact`,
        method: "GET",
      },
    ]);
  }
  expect(await transport(report).sdk.impact(reference.id)).toEqual(report);
});

test("impact SDK rejects forged result/project/episode/version and non-contract semantic or redo claims without latest fallback", async () => {
  for (const value of [
    { ...report, result: { ...report.result, id: other } },
    { ...report, result: { ...report.result, version: 3 } },
    { ...report, projectId: other },
    { ...report, episodeId: "other-episode" },
    { ...report, semanticVerification: "verified" },
    { ...report, automaticRedo: true },
    { ...report, snapshotHash: "not-a-hash" },
    { ...report, shots: [{ sceneId: "missing-fields" }] },
    { ...report, script: { ...report.script, currentDocumentVersion: -1 } },
  ]) {
    const { sdk, calls } = transport(value);
    await expect(sdk.impact(reference.id, reference)).rejects.toThrow();
    expect(calls).toEqual([
      {
        path: `/api/v2/episode-development/${reference.id}/impact`,
        method: "GET",
      },
    ]);
  }
});

test("impact SDK propagates a real read failure with one GET, never a cached empty success or write", async () => {
  const { sdk, calls } = transport(
    {
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      detail: "Actual controlled impact owner read failed",
    },
    503,
  );
  await expect(sdk.impact(reference.id, reference)).rejects.toThrow();
  expect(calls).toEqual([
    {
      path: `/api/v2/episode-development/${reference.id}/impact`,
      method: "GET",
    },
  ]);
});

test("impact presentation hides warm cache until explicit read completes and gives read failure precedence", () => {
  const state = {
    reference,
    report,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentEpisodeImpact(state)).toBe(report);
  for (const change of [
    { opened: false },
    { fetching: true },
    { error: true },
    { report: undefined },
  ])
    expect(currentEpisodeImpact({ ...state, ...change })).toBeUndefined();
});

test("impact presentation cannot borrow another project/result/episode/version or a late report but preserves exact stale history", () => {
  for (const change of [
    { id: other },
    { projectId: other },
    { episodeId: "other" },
    { version: 3 },
  ]) {
    const requested = { ...reference, ...change };
    expect(episodeImpactIdentityMatches(requested, report)).toBe(false);
    expect(
      currentEpisodeImpact({
        reference: requested,
        report,
        opened: true,
        fetching: false,
        error: false,
      }),
    ).toBeUndefined();
  }
  const historical = {
    ...report,
    isCurrent: false,
    sourceState: "stale" as const,
    staleReasons: ["Original source changed"],
  };
  expect(
    currentEpisodeImpact({
      reference,
      report: historical,
      opened: true,
      fetching: false,
      error: false,
    }),
  ).toBe(historical);
  expect(historical.automaticRedo).toBe(false);
  expect(historical.semanticVerification).toBe("unverified");
});

const constraints = EpisodeUpstreamConstraintsSchema.parse({
  format: "formal-constraint-observations-v1",
  items: [
    {
      kind: "author-intent",
      frozen: { id: other, version: 1, contentHash: null },
      current: { id: other, version: 1, contentHash: "b".repeat(64) },
      readState: "available",
      currentSourceState: "stale",
      change: "same-reference",
    },
  ],
  approvedStoryBible: {
    frozenCount: 0,
    currentCount: 0,
    readState: "available",
  },
});
test("impact SDK preserves exact body-free constraint observations and explicit legacy absence without promoting unchanged identity to semantic verification", async () => {
  for (const value of [
    report,
    { ...report, upstreamConstraints: constraints },
  ]) {
    const { sdk, calls } = transport(value);
    const actual = await sdk.impact(reference.id, reference);
    expect(actual).toEqual(value);
    expect(actual.semanticVerification).toBe("unverified");
    expect(actual.automaticRedo).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
  }
  expect(
    (await transport(report).sdk.impact(reference.id)).upstreamConstraints,
  ).toBeUndefined();
});
test("impact constraint contract rejects false changes, leaked body, duplicate identities and incomplete approved collections with one original GET", async () => {
  const row = constraints.items[0]!;
  const bible = {
    ...row,
    kind: "story-bible",
    frozen: { ...row.frozen!, position: 0 },
    current: { ...row.current!, position: 0 },
  };
  const collection = {
    frozenCount: 1,
    currentCount: 1,
    readState: "available",
  };
  for (const upstreamConstraints of [
    { ...constraints, items: [{ ...row, change: "changed" }] },
    {
      ...constraints,
      items: [{ ...row, current: { ...row.current, content: "PRIVATE BODY" } }],
    },
    {
      ...constraints,
      items: [{ ...row, readState: "unavailable", change: "unavailable" }],
    },
    { ...constraints, items: [row, row] },
    {
      ...constraints,
      items: [row, bible, bible],
      approvedStoryBible: { ...collection, frozenCount: 2, currentCount: 2 },
    },
    {
      ...constraints,
      items: [row, bible],
      approvedStoryBible: constraints.approvedStoryBible,
    },
    {
      ...constraints,
      items: [row, { ...bible, current: { ...bible.current, position: 2 } }],
      approvedStoryBible: collection,
    },
    {
      ...constraints,
      items: [row],
      approvedStoryBible: {
        frozenCount: 0,
        currentCount: 0,
        readState: "unavailable",
      },
    },
  ]) {
    const { sdk, calls } = transport({ ...report, upstreamConstraints });
    await expect(sdk.impact(reference.id, reference)).rejects.toThrow();
    expect(calls).toEqual([
      {
        path: `/api/v2/episode-development/${reference.id}/impact`,
        method: "GET",
      },
    ]);
  }
});
test("constraint change classification distinguishes actual identity, version, hash, order and document changes from unavailable reads, without filling missing original fingerprints", () => {
  const frozen = { id: reference.id, version: 1, contentHash: "a".repeat(64) };
  const compare = (
    current: typeof frozen | null,
    readState: "available" | "unavailable" = "available",
  ) => episodeConstraintChange({ frozen, current, readState });
  expect(compare(frozen)).toBe("same-reference");
  expect(compare({ ...frozen, id: other })).toBe("replaced");
  expect(compare({ ...frozen, version: 2 })).toBe("changed");
  expect(compare({ ...frozen, contentHash: "b".repeat(64) })).toBe("changed");
  expect(compare(null)).toBe("removed");
  expect(compare(null, "unavailable")).toBe("unavailable");
  expect(
    episodeConstraintChange({
      frozen: null,
      current: frozen,
      readState: "available",
    }),
  ).toBe("added");
  expect(
    episodeConstraintChange({
      frozen: null,
      current: null,
      readState: "available",
    }),
  ).toBe("unverified");
  expect(
    episodeConstraintChange({
      frozen: { ...frozen, contentHash: null },
      current: frozen,
      readState: "available",
    }),
  ).toBe("same-reference");
  for (const extra of [{ position: 1 }, { documentVersion: 2 }])
    expect(
      episodeConstraintChange({
        frozen,
        current: { ...frozen, ...extra },
        readState: "available",
      }),
    ).toBe("changed");
});
