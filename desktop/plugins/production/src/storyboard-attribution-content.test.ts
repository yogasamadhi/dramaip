import { describe, expect, test } from "vitest";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  StoryboardAttributionCreateSchema,
  StoryboardAttributionSchema,
  type StoryboardAttributionSource,
  type StoryboardAttributionCreate,
} from "@dramaip/contracts/production";
import {
  inspectStoryboardAttribution,
  storyboardAttributionHash,
  storyboardAttributionSourceHash,
} from "./storyboard-attribution-content.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (n: number) => String(n).padStart(64, "a");
const ref = (n: number) => ({ id: id(n), version: 2 });
function fixture() {
  const body = {
    format: "exact-shot-attribution-source-v1" as const,
    projectId: id(1),
    episodeId: "episode-1",
    storyboard: { ...ref(2), contentHash: sha(2), sourceSnapshotId: id(3) },
    outline: { ...ref(4), contentHash: sha(4), sourceSnapshotId: id(5) },
    script: { ...ref(6), contentHash: sha(6), sourceSnapshotId: id(7) },
    document: {
      ...ref(8),
      scriptId: id(9),
      scriptVersion: 2,
      contentHash: sha(8),
    },
    originalScriptDocument: {
      ...ref(10),
      scriptId: id(11),
      scriptVersion: 2,
      contentHash: sha(10),
    },
    chapters: [{ ...ref(12), contentHash: sha(12) }],
    scriptBlocks: [
      { id: id(13), index: 0, type: "scene_heading" as const },
      { id: id(14), index: 1, type: "action" as const },
      { id: id(15), index: 2, type: "dialogue" as const },
    ],
    shots: [
      {
        sceneId: "scene-1",
        shotId: "shot-1",
        sceneRecord: { ...ref(16), contentHash: sha(16) },
        shotRecord: { ...ref(17), contentHash: sha(17) },
        sourceBlockIds: [id(14), id(15)],
      },
      {
        sceneId: "scene-1",
        shotId: "shot-2",
        sceneRecord: { ...ref(16), contentHash: sha(16) },
        shotRecord: { ...ref(18), contentHash: sha(18) },
        sourceBlockIds: [id(15)],
      },
    ],
    evidence: [
      {
        sceneId: "scene-1",
        evidenceId: "quote-1",
        source: {
          sourceKind: "chapter" as const,
          sourceId: id(12),
          sourceVersion: 2,
          fieldPath: `/chapters/${id(12)}/paragraphs/p-1`,
          contentHash: sha(20),
        },
        valuePath: "/content",
        quoteHash: sha(21),
        quoteCharacters: 4,
        offsetUnit: "utf16-code-unit" as const,
        matches: [
          { start: 0, end: 4, chapterStart: 10, chapterEnd: 14 },
          { start: 8, end: 12, chapterStart: 18, chapterEnd: 22 },
        ],
        paragraphId: "p-1",
        attribution: "model-declared" as const,
        matchVerification: "rule" as const,
        semanticVerification: "unverified" as const,
      },
    ],
    semanticVerification: "unverified" as const,
  };
  const source: StoryboardAttributionSource = {
    ...body,
    sourceFingerprint: storyboardAttributionSourceHash(body),
    baseAttributionId: null,
  };
  const request: StoryboardAttributionCreate = {
    storyboard: ref(2),
    sourceFingerprint: source.sourceFingerprint,
    baseAttributionId: null,
    selections: [
      {
        sceneId: "scene-1",
        shotId: "shot-1",
        blockIds: [id(14), id(15)],
        evidenceId: "quote-1",
        matchIndex: 1,
        rationale: "私人理由，不进入交付关联",
      },
    ],
  };
  return { source, request };
}
function nodeReference(start = 18, end = 22): AgentContextReference {
  return {
    sourceKind: "knowledge",
    sourceId: id(30),
    sourceVersion: 1,
    fieldPath: `/story-declarations/${id(30)}`,
    sensitivity: "project",
    policyDependencies: [
      {
        sourceId: id(31),
        sourceVersion: 3,
        fieldPath: `/story-declarations/nodes/${id(31)}`,
      },
    ],
    value: {
      id: id(30),
      projectId: id(1),
      version: 1,
      kind: "event",
      title: "私人节点标题",
      statement: "私人节点正文",
      evidenceBasis:
        "human-adopted-source-anchored-declaration-not-semantic-proof",
      sourceFingerprint: sha(30),
      sourceAnchors: [
        {
          selection: {
            kind: "paragraphs",
            chapterId: id(12),
            chapterVersion: 2,
            chapterContentHash: sha(12),
            paragraphIds: ["p-1"],
          },
          quoteHash: sha(31),
          anchors: [{ start, end, paragraphIds: ["p-1"] }],
        },
      ],
    },
  };
}
function inspect(value = fixture(), reference?: AgentContextReference) {
  return inspectStoryboardAttribution({
    ...value,
    nodeReference: () => reference,
  });
}
function rehash(
  source: StoryboardAttributionSource,
  request: StoryboardAttributionCreate,
) {
  const {
    sourceFingerprint: _hash,
    baseAttributionId: _base,
    ...body
  } = source;
  source.sourceFingerprint = storyboardAttributionSourceHash(body);
  request.sourceFingerprint = source.sourceFingerprint;
}
describe("explicit exact-shot source attribution, not semantic proof", () => {
  test("preserves the second repeated occurrence and actual ordered blocks, with incomplete coverage", () => {
    const result = inspect();
    expect(result.links[0]!.matchIndex).toBe(1);
    expect(result.links[0]!.evidence.match.chapterStart).toBe(18);
    expect(result.coverage).toEqual({
      totalShots: 2,
      associatedShots: 1,
      nodeAssociatedShots: 0,
      associatedBlockCount: 2,
      unassociatedShotIds: ["shot-2"],
    });
    expect(result.links[0]!.attribution).toBe("human-declared");
    expect(result.links[0]!.semanticVerification).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("私人理由");
  });
  test("does not include adoption head in the source hash", () => {
    const value = fixture();
    const original = value.source.sourceFingerprint;
    value.source.baseAttributionId = id(32);
    value.request.baseAttributionId = id(32);
    expect(inspect(value).links).toHaveLength(1);
    expect(value.source.sourceFingerprint).toBe(original);
  });
  test("requires an explicit occurrence; missing match index is not defaulted", () => {
    const value = fixture();
    delete (
      value.request.selections[0] as Partial<
        StoryboardAttributionCreate["selections"][number]
      >
    ).matchIndex;
    expect(() => inspect(value)).toThrow();
  });
  for (const [label, mutate] of [
    [
      "out-of-range occurrence",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.matchIndex = 2;
      },
    ],
    [
      "other scene evidence",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.sceneId = "other-scene";
      },
    ],
    [
      "unknown shot",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.shotId = "other-shot";
      },
    ],
    [
      "unselected source block",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.blockIds = [id(13)];
      },
    ],
    [
      "reversed blocks",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.blockIds.reverse();
      },
    ],
    [
      "duplicate blocks",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections[0]!.blockIds.push(id(14));
      },
    ],
    [
      "duplicate attribution",
      (v: ReturnType<typeof fixture>) => {
        v.request.selections.push(structuredClone(v.request.selections[0]!));
      },
    ],
    [
      "changed confirmed fingerprint",
      (v: ReturnType<typeof fixture>) => {
        v.request.sourceFingerprint = sha(99);
      },
    ],
    [
      "changed expected head",
      (v: ReturnType<typeof fixture>) => {
        v.request.baseAttributionId = id(99);
      },
    ],
    [
      "changed formal version",
      (v: ReturnType<typeof fixture>) => {
        v.request.storyboard.version++;
      },
    ],
    [
      "same-version field drift",
      (v: ReturnType<typeof fixture>) => {
        v.source.shots[0]!.shotRecord.contentHash = sha(99);
      },
    ],
  ] as const)
    test(`refuses ${label}`, () => {
      const value = fixture();
      mutate(value);
      expect(() => inspect(value)).toThrow();
    });
  test("allows an actual node containing this exact original chapter position without leaking its body", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    const result = inspect(value, nodeReference());
    expect(result.links[0]!.storyNode?.linkKind).toBe("chapter-position");
    expect(result.links[0]!.storyNode?.node).toEqual({
      id: id(31),
      version: 3,
    });
    expect(result.coverage.nodeAssociatedShots).toBe(1);
    expect(JSON.stringify(result)).not.toContain("私人节点");
  });
  test("accepts exact adopted event time metadata in the node fingerprint without exporting its private annotation or weakening node/source checks", () => {
    const value = fixture(),
      reference = nodeReference();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    const eventTimeline = {
      storyOrder: 0,
      timeLabel: "PRIVATE TIME 开场前一日",
      interpretation: "author-inferred",
    };
    reference.value = {
      ...(reference.value as Record<string, unknown>),
      eventTimeline,
    };
    const result = inspect(value, reference);
    expect(result.links[0]!.storyNode?.referenceHash).toBe(
      storyboardAttributionHash(reference),
    );
    expect(result.links[0]!.storyNode?.referenceHash).not.toBe(
      inspect(value, nodeReference()).links[0]!.storyNode?.referenceHash,
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE TIME");
    expect(JSON.stringify(result)).not.toContain("eventTimeline");
    for (const patch of [
      { kind: "character" },
      { eventTimeline: { ...eventTimeline, storyOrder: -1 } },
      { unexpectedPrivateAnnotation: "PRIVATE" },
    ]) {
      expect(() =>
        inspect(value, {
          ...reference,
          value: { ...(reference.value as Record<string, unknown>), ...patch },
        }),
      ).toThrow();
    }
  });
  test("same chapter node anchored to the first occurrence does not prove the second", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    expect(() => inspect(value, nodeReference(10, 14))).toThrow();
  });
  test("missing or stale adopted node is not replaced by another node", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    expect(() => inspect(value)).toThrow();
  });
  test("node must carry the exact requested adopted identity, not merely the declaration", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 4 };
    expect(() => inspect(value, nodeReference())).toThrow();
  });
  test("same project is insufficient when chapter hashes differ", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    value.source.chapters[0]!.contentHash = sha(99);
    rehash(value.source, value.request);
    expect(() => inspect(value, nodeReference())).toThrow();
  });
  test("summary offsets are not upgraded to original chapter positions", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    const evidence = value.source.evidence[0]!;
    evidence.source.sourceKind = "knowledge";
    evidence.source.sourceId = id(50);
    evidence.valuePath = "/summary";
    evidence.matches = [{ start: 18, end: 22 }];
    delete evidence.paragraphId;
    value.request.selections[0]!.matchIndex = 0;
    rehash(value.source, value.request);
    expect(() => inspect(value, nodeReference())).toThrow();
    delete value.request.selections[0]!.storyNode;
    expect(inspect(value).links[0]!.evidence.match).toEqual({
      start: 18,
      end: 22,
    });
  });
  test("actual saved original block may anchor a screenplay node; Fountain offsets alone may not", () => {
    const value = fixture();
    value.request.selections[0]!.storyNode = { id: id(31), version: 3 };
    const evidence = value.source.evidence[0]!;
    evidence.source = {
      sourceKind: "production",
      sourceId: id(11),
      sourceVersion: 2,
      fieldPath: `/production/${id(11)}`,
      contentHash: sha(11),
    };
    evidence.valuePath = "/blocks/1/text";
    evidence.sourceBlockId = id(60);
    evidence.matches = [{ start: 0, end: 4 }];
    delete evidence.paragraphId;
    value.request.selections[0]!.matchIndex = 0;
    rehash(value.source, value.request);
    const reference = nodeReference();
    (reference.value as Record<string, unknown>).sourceAnchors = [
      {
        selection: {
          kind: "screenplay-blocks",
          scriptId: id(11),
          scriptVersion: 2,
          documentId: id(10),
          documentVersion: 2,
          documentContentHash: sha(10),
          blockIds: [id(60)],
        },
        quoteHash: sha(60),
        anchors: [{ blockId: id(60), blockIndex: 1, blockType: "action" }],
      },
    ];
    expect(inspect(value, reference).links[0]!.storyNode?.linkKind).toBe(
      "screenplay-block",
    );
    delete evidence.sourceBlockId;
    evidence.valuePath = "/content";
    rehash(value.source, value.request);
    expect(() => inspect(value, reference)).toThrow();
  });
  test("association fingerprint includes original private declaration but body-free links do not", () => {
    const value = fixture();
    const first = inspect(value);
    value.request.selections[0]!.rationale = "另一个实际理由";
    expect(inspect(value).associationFingerprint).not.toBe(
      first.associationFingerprint,
    );
    expect(inspect(value).links).toEqual(first.links);
    expect(storyboardAttributionHash(first.links)).toHaveLength(64);
  });
  test("receipt schema refuses invented model workflow and false adopted status", () => {
    const value = fixture(),
      result = inspect(value),
      now = new Date().toISOString();
    const receipt = {
      id: id(70),
      projectId: id(1),
      version: 0,
      status: "pending",
      origin: "human-declared",
      input: value.request,
      source: value.source,
      ...result,
      isCurrent: false,
      sourceState: "current",
      sourceReasons: [],
      createdAt: now,
      updatedAt: now,
    };
    expect(StoryboardAttributionSchema.safeParse(receipt).success).toBe(true);
    expect(
      StoryboardAttributionSchema.safeParse({ ...receipt, workflowId: id(71) })
        .success,
    ).toBe(false);
    expect(
      StoryboardAttributionSchema.safeParse({ ...receipt, status: "adopted" })
        .success,
    ).toBe(false);
    expect(
      StoryboardAttributionCreateSchema.safeParse({
        ...value.request,
        selections: [],
      }).success,
    ).toBe(false);
  });
});
