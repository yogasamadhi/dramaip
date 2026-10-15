import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  measureNovelRevisionEffort,
  NovelRevisionEffortPageSchema,
  NovelRevisionFactSchema,
} from "@dramaip/contracts/insights";
import { createNovelRevisionEffortClient } from "../../client/src/novel-revision-effort";
import { NovelRevisionEffortView } from "./features/insights/NovelRevisionEffort";
const projectId = crypto.randomUUID(),
  chapterId = crypto.randomUUID(),
  flow = crypto.randomUUID(),
  second = crypto.randomUUID(),
  preview = crypto.randomUUID(),
  otherPreview = crypto.randomUUID(),
  rebased = crypto.randomUUID(),
  targetKey = "b".repeat(64),
  at = "2026-10-07T00:00:00.000Z";
const hash = (c: string) => c.repeat(64);
function fixture() {
  const request = (id: string, attempt: number, cursor: number) => ({
    eventId: crypto.randomUUID(),
    cursor,
    occurredAt: at,
    fact: {
      eventVersion: 1,
      projectId,
      workflowId: id,
      workflowVersion: 0,
      workflowPath: "novel",
      metric: "novel.chapter",
      targetKey,
      requestedAt: at,
      evidenceKind: "rule",
      modelEvidence: "unknown",
      kind: "request",
      targetAttempt: attempt,
      requestKind: "new-request",
      sourceVersions: [],
    },
  });
  const a = request(flow, 1, 1),
    b = request(second, 2, 5);
  const candidate = (
    q: typeof a,
    id: string,
    fingerprint: string,
    cursor: number,
  ) => ({
    eventId: crypto.randomUUID(),
    cursor,
    occurredAt: at,
    fact: {
      ...q.fact,
      workflowVersion: 1,
      kind: "candidate-ready",
      candidate: { id, contentFingerprint: fingerprint },
      targetAttempt: undefined,
      requestKind: undefined,
      sourceVersions: undefined,
    },
  });
  const make = (
    workflowId: string,
    previewId: string,
    kind: string,
    sequence: number,
    afterFingerprint: string,
    cursor: number,
    extra = {},
  ) => ({
    eventId: crypto.randomUUID(),
    cursor,
    occurredAt: at,
    fact: {
      eventVersion: 1,
      projectId,
      workflowId,
      workflowVersion: 1,
      targetKey,
      chapterId,
      previewId,
      rootPreviewId: previewId,
      kind,
      sequence,
      coverage: "complete",
      afterFingerprint,
      evidenceKind: "rule",
      qualityState: "unverified",
      ...extra,
    },
  });
  const revision = [
    make(flow, preview, "initial", 0, hash("a"), 2),
    make(flow, preview, "content-update", 1, hash("b"), 4, {
      beforeFingerprint: hash("a"),
    }),
    make(second, otherPreview, "initial", 0, hash("c"), 6),
    make(second, rebased, "rebase", 0, hash("d"), 8, {
      sourcePreviewId: otherPreview,
      rootPreviewId: otherPreview,
      beforeFingerprint: hash("c"),
    }),
  ];
  const outcome = {
    eventVersion: 1,
    projectId,
    objectId: chapterId,
    workflowId: second,
    kind: "novel.chapter-adopted",
    workflowPath: "novel",
    candidate: { id: rebased, contentFingerprint: hash("d") },
    formalVersions: [{ kind: "chapter", id: chapterId, version: 1 }],
    sourceVersions: [],
    evidenceKind: "human",
    modelEvidence: "unknown",
    qualityState: "unverified",
    resultStatus: "adopted",
    eventId: crypto.randomUUID(),
    cursor: 10,
    unitKey: hash("f"),
    occurredAt: at,
  };
  // Strict records must not retain request-only keys on candidates.
  const ca = candidate(a, preview, hash("a"), 3),
    cb = candidate(b, otherPreview, hash("c"), 7);
  for (const c of [ca, cb])
    for (const k of ["targetAttempt", "requestKind", "sourceVersions"])
      delete (c.fact as Record<string, unknown>)[k];
  return { funnel: [a, ca, b, cb], outcomes: [outcome], revisions: revision };
}
const page = () => {
  const d = fixture();
  return NovelRevisionEffortPageSchema.parse({
    format: "novel-revision-effort-page-v1",
    projectId,
    projection: { state: "healthy", checkpoint: 20 },
    totalTargets: 1,
    items: measureNovelRevisionEffort(
      projectId,
      d.funnel,
      d.outcomes,
      d.revisions,
    ),
    policy: "saved-content-changes-before-first-recorded-formal-adoption",
    modelRevisions: "excluded",
    qualityState: "unverified",
  });
};
describe("first formal novel adoption revision observations", () => {
  test("counts discarded/retry candidate changes once and cuts off at the exact first adoption event", () => {
    const d = fixture(),
      result = measureNovelRevisionEffort(
        projectId,
        d.funnel,
        d.outcomes,
        d.revisions,
      );
    expect(result[0]).toMatchObject({
      state: "measured",
      localRevisionCount: 2,
      observedContentUpdates: 1,
      observedRebases: 1,
      workflowIds: [flow, second],
    });
    const late = {
      ...d.revisions[1]!,
      eventId: crypto.randomUUID(),
      cursor: 11,
      fact: {
        ...d.revisions[1]!.fact,
        sequence: 2,
        beforeFingerprint: hash("b"),
        afterFingerprint: hash("e"),
      },
    };
    expect(
      measureNovelRevisionEffort(projectId, d.funnel, d.outcomes, [
        ...d.revisions,
        late,
      ]),
    ).toEqual(result);
  });
  test("pending, unobserved baseline and partial publications never establish a false zero or full total", () => {
    const d = fixture();
    expect(
      measureNovelRevisionEffort(projectId, d.funnel, [], d.revisions)[0],
    ).toMatchObject({ state: "pending", localRevisionCount: null });
    expect(
      measureNovelRevisionEffort(
        projectId,
        d.funnel,
        d.outcomes,
        d.revisions.slice(1),
      )[0],
    ).toMatchObject({
      state: "unknown",
      localRevisionCount: null,
      observedContentUpdates: 1,
    });
    expect(
      measureNovelRevisionEffort(
        projectId,
        d.funnel,
        d.outcomes,
        d.revisions.map((r, i) =>
          i === 0 ? { ...r, fact: { ...r.fact, coverage: "partial" } } : r,
        ),
      )[0],
    ).toMatchObject({ state: "unknown", localRevisionCount: null });
    const unchanged = d.revisions.map((r, i) =>
        i === 3
          ? { ...r, fact: { ...r.fact, afterFingerprint: hash("c") } }
          : r,
      ),
      adopt = [
        {
          ...d.outcomes[0]!,
          candidate: { id: rebased, contentFingerprint: hash("c") },
        },
      ];
    expect(
      measureNovelRevisionEffort(projectId, d.funnel, adopt, unchanged)[0],
    ).toMatchObject({
      state: "measured",
      localRevisionCount: 1,
      observedContentChangingRebases: 0,
    });
  });
  test("never skips an earlier unbound formal adoption in favor of a later measured success", () => {
    const d = fixture(),
      old = {
        ...d.outcomes[0]!,
        workflowId: undefined,
        candidate: undefined,
        eventId: crypto.randomUUID(),
        cursor: 1,
        formalVersions: [{ kind: "chapter", id: chapterId, version: 0 }],
      };
    const shift = <T extends { cursor: number }>(r: T) => ({
      ...r,
      cursor: r.cursor + 1,
    });
    const value = measureNovelRevisionEffort(
      projectId,
      d.funnel.map(shift),
      [old, ...d.outcomes.map(shift)],
      d.revisions.map(shift),
    );
    expect(value[0]).toMatchObject({
      state: "unknown",
      localRevisionCount: null,
      observedContentUpdates: 0,
      adoption: { eventId: old.eventId, version: 0 },
    });
    expect(value[0]!.adoption?.workflowId).toBeUndefined();
  });
  test("rejects broken original sequences, duplicate revisions, foreign scope, private fields and false measured arithmetic", () => {
    const d = fixture();
    expect(() =>
      measureNovelRevisionEffort(projectId, d.funnel, d.outcomes, [
        ...d.revisions,
        d.revisions[1],
      ]),
    ).toThrow();
    expect(() =>
      measureNovelRevisionEffort(
        projectId,
        d.funnel,
        d.outcomes,
        d.revisions.map((r, i) =>
          i === 1 ? { ...r, fact: { ...r.fact, sequence: 3 } } : r,
        ),
      ),
    ).toThrow();
    expect(() =>
      measureNovelRevisionEffort(
        crypto.randomUUID(),
        d.funnel,
        d.outcomes,
        d.revisions,
      ),
    ).toThrow();
    expect(() =>
      measureNovelRevisionEffort(
        projectId,
        d.funnel,
        d.outcomes,
        d.revisions.map((r, i) =>
          i === 1 ? { ...r, fact: { ...r.fact, targetKey: hash("f") } } : r,
        ),
      ),
    ).toThrow();
    expect(
      NovelRevisionFactSchema.safeParse({
        ...d.revisions[0]!.fact,
        body: "PRIVATE",
      }).success,
    ).toBe(false);
    expect(
      NovelRevisionEffortPageSchema.safeParse({
        ...page(),
        items: [{ ...page().items[0], localRevisionCount: 3 }],
      }).success,
    ).toBe(false);
  });
  test("SDK validates complete pagination, checkpoint, project, order and cancellation without returning partial history", async () => {
    let responses: unknown[] = [page()],
      calls: { path: string; init?: RequestInit }[] = [];
    const sdk = createNovelRevisionEffortClient(
      async <T,>(path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return responses.shift() as T;
      },
    );
    const signal = new AbortController().signal;
    expect((await sdk.read(projectId, signal)).items).toHaveLength(1);
    expect(calls[0]).toEqual({
      path: `/api/v2/projects/${projectId}/creative-outcomes/revision-effort?limit=100`,
      init: { signal },
    });
    const row = page().items[0]!,
      secondFlow = crypto.randomUUID(),
      secondRow = {
        ...row,
        targetKey: hash("a"),
        workflowIds: [secondFlow],
        adoption: { ...row.adoption!, workflowId: secondFlow },
      };
    responses = [
      { ...page(), totalTargets: 2, nextCursor: "opaque", items: [row] },
      { ...page(), totalTargets: 2, items: [secondRow] },
    ];
    expect((await sdk.read(projectId)).items).toHaveLength(2);
    for (const bad of [
      [{ ...page(), projectId: crypto.randomUUID() }],
      [{ ...page(), totalTargets: 2 }],
      [
        { ...page(), totalTargets: 2, nextCursor: "opaque" },
        {
          ...page(),
          totalTargets: 2,
          items: [secondRow],
          projection: { state: "healthy", checkpoint: 21 },
        },
      ],
      [
        { ...page(), totalTargets: 2, nextCursor: "opaque" },
        { ...page(), totalTargets: 2, items: [row] },
      ],
    ]) {
      responses = bad;
      await expect(sdk.read(projectId)).rejects.toThrow();
    }
    const cancelled = new AbortController();
    cancelled.abort();
    calls = [];
    await expect(sdk.read(projectId, cancelled.signal)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("ordinary result view keeps adopted unknown and pending separate, with model stages and later changes excluded", () => {
    const value = {
      ...page(),
      format: "novel-revision-effort-result-v1" as const,
    };
    const html = renderToStaticMarkup(
      <NovelRevisionEffortView value={value} />,
    );
    expect(html).toContain("局部正文修订 2 次");
    expect(html).toContain("放弃、失败及重试 AI 草稿");
    expect(html).toContain("模型修订阶段");
    expect(html).not.toContain("PRIVATE");
    expect(
      renderToStaticMarkup(
        <NovelRevisionEffortView
          value={{
            ...value,
            items: [
              {
                ...value.items[0]!,
                state: "unknown",
                localRevisionCount: null,
              },
            ],
          }}
        />,
      ),
    ).toContain("历史不完整；总数未知");
  });
});
