import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EpisodeDevelopmentImpactSchema,
  type EpisodeDevelopmentImpact,
} from "@dramaip/contracts/production";
import {
  CreationInputSchema,
  CreationWorkflowSchema,
} from "@dramaip/contracts/creation";
import { createStudioClient } from "@dramaip/client";
import { creationWorkbenchScopeKey } from "./creation-workbench-owner";
import {
  currentStoryboardSourceReviewFrame,
  freezeStoryboardSourceReviewFrame,
  matchesStoryboardSourceReviewObservation,
  sourceReviewConfirmations,
  type SourceReviewDraft,
} from "./storyboard-source-review-state";
import { StoryboardSourceReviewComposer } from "./features/production/StoryboardSourceReviewComposer";
import {
  freezeStoryboardRedoStartRequest,
  parseStoryboardRedoStartRequest,
  saveStoryboardRedoStartRequest,
  clearExactStoryboardRedoStartRequest,
  resendStoryboardRedoStart,
  storyboardRedoStartStorageKey,
} from "./storyboard-redo-start-recovery";

// Strict, body-free contract samples only; not real owner/manuscript or quality evidence.
const id = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64),
  ref = { id: id(1), version: 1 },
  attribution = { id: id(2), version: 1 };
const reference = { ...ref, projectId: id(3), episodeId: id(4) };
const frozenRecord = (n: number) => ({
  id: id(n),
  version: 0,
  contentHash: hash,
});
const record = (n: number) => ({
  frozen: frozenRecord(n),
  current: { ...frozenRecord(n), retired: false },
  readState: "available",
  change: "same-reference",
});
const block = { id: id(7), index: 0, type: "action", contentHash: hash };
function report(): EpisodeDevelopmentImpact {
  return EpisodeDevelopmentImpactSchema.parse({
    result: ref,
    projectId: reference.projectId,
    episodeId: reference.episodeId,
    isCurrent: true,
    sourceState: "current",
    staleReasons: [],
    script: {
      id: id(8),
      result: { id: id(9), version: 1 },
      frozenDocumentVersion: 0,
      currentDocumentVersion: 0,
    },
    blockChanges: [],
    shots: [5, 6].map((n, index) => ({
      sceneId: "scene",
      shotId: `shot-${index}`,
      record: { id: id(n), frozenVersion: 0, currentVersion: 0 },
      associationImpact: "no-observed-change",
      changedBlockIds: [],
      reasonCodes: [],
    })),
    globalReviewReasons: [],
    comparison: "frozen-script-to-actual-document-and-record-versions-v1",
    semanticVerification: "unverified",
    automaticRedo: false,
    snapshotHash: hash,
    attributionImpact: {
      format: "exact-shot-attribution-impact-v1",
      projectId: reference.projectId,
      episodeId: reference.episodeId,
      attribution,
      storyboard: ref,
      isCurrent: true,
      sourceFingerprint: hash,
      associationFingerprint: hash,
      coverage: {
        totalShots: 2,
        associatedShots: 1,
        nodeAssociatedShots: 0,
        associatedBlockCount: 1,
        unassociatedShotIds: ["shot-1"],
      },
      links: [
        {
          index: 0,
          original: {
            sceneId: "scene",
            shotId: "shot-0",
            blockIds: [block.id],
            evidenceId: "evidence",
            matchIndex: 0,
            evidence: {
              sceneId: "scene",
              evidenceId: "evidence",
              source: {
                sourceKind: "chapter",
                sourceId: id(10),
                sourceVersion: 0,
                fieldPath: `/chapters/${id(10)}`,
                contentHash: hash,
              },
              valuePath: "/content",
              quoteHash: hash,
              quoteCharacters: 1,
              offsetUnit: "utf16-code-unit",
              match: { start: 0, end: 1 },
              attribution: "model-declared",
              matchVerification: "rule",
              semanticVerification: "unverified",
            },
            attribution: "human-declared",
            matchVerification: "rule",
            semanticVerification: "unverified",
          },
          quote: {
            frozenVerified: true,
            readState: "available",
            currentSourceVersion: 0,
            expressionHash: hash,
            currentSliceHash: hash,
            comparison: "same-position-match",
            sourceBlock: null,
            paragraph: null,
          },
          blocks: [
            {
              id: block.id,
              frozen: block,
              current: block,
              readState: "available",
              change: "same-reference",
            },
          ],
          records: { scene: record(11), shot: record(5) },
          node: null,
          reasonCodes: [],
          associationImpact: "no-observed-change",
        },
      ],
      textIncluded: false,
      semanticVerification: "unverified",
      automaticRedo: false,
    },
  });
}
const draft = (): SourceReviewDraft => ({
  decisions: { "shot-0": "redo", "shot-1": "retain" },
  confirmation: Object.fromEntries(
    Object.keys(sourceReviewConfirmations).map((key) => [key, true]),
  ),
});
const freeze = (value = report(), choice = draft(), selected = ["shot-0"]) =>
  freezeStoryboardSourceReviewFrame(
    reference,
    attribution,
    value,
    selected,
    choice,
    "original-scope",
  );
test("完整来源审阅保持原关联、当前全部镜头顺序、未关联状态和五声明；相同SHA不能代替全部本次观察", () => {
  const frame = freeze();
  expect(
    frame.review.shots.map((shot) => [
      shot.shotId,
      shot.observedState,
      shot.decision,
    ]),
  ).toEqual([
    ["shot-0", "no-observed-change", "redo"],
    ["shot-1", "unassociated", "retain"],
  ]);
  expect(
    currentStoryboardSourceReviewFrame(
      frame,
      reference,
      ["shot-0"],
      "original-scope",
    ),
  ).toBe(frame);
  expect(matchesStoryboardSourceReviewObservation(frame, report())).toBe(true);
  const changed = report();
  changed.globalReviewReasons.push("another actual whole-scope observation");
  expect(matchesStoryboardSourceReviewObservation(frame, changed)).toBe(false);
  for (const [scope, chosen] of [
    ["new-mode", ["shot-0"]],
    ["original-scope", ["shot-1"]],
  ] as const)
    expect(
      currentStoryboardSourceReviewFrame(frame, reference, chosen, scope),
    ).toBeUndefined();
  expect(
    currentStoryboardSourceReviewFrame(
      frame,
      { ...reference, version: 2 },
      ["shot-0"],
      "original-scope",
    ),
  ).toBeUndefined();
});
test("每项独立审阅缺失或false均拒绝，不从完整选择推定五声明", () => {
  for (const key of Object.keys(
    sourceReviewConfirmations,
  ) as (keyof typeof sourceReviewConfirmations)[]) {
    const missing = draft();
    delete missing.confirmation[key];
    expect(() => freeze(report(), missing)).toThrow();
    const unchecked = draft();
    unchecked.confirmation[key] = false;
    expect(() => freeze(report(), unchecked)).toThrow();
  }
});
test("漏未选镜头、外来／重复选择、漏决定、额外决定、错误决定或原关联均拒绝", () => {
  for (const selected of [[], ["foreign"], ["shot-0", "shot-0"], ["shot-1"]])
    expect(() => freeze(report(), draft(), selected)).toThrow();
  for (const decisions of [
    { "shot-0": "redo" },
    { ...draft().decisions, foreign: "retain" },
    { "shot-0": "retain", "shot-1": "redo" },
  ])
    expect(() =>
      freeze(report(), {
        ...draft(),
        decisions: decisions as SourceReviewDraft["decisions"],
      }),
    ).toThrow();
  expect(() =>
    freezeStoryboardSourceReviewFrame(
      reference,
      { ...attribution, version: 2 },
      report(),
      ["shot-0"],
      draft(),
      "original-scope",
    ),
  ).toThrow();
});
test("未知全选仍拒绝，来源变化未关联保留仍拒绝，缺失实际记录和非当前关联不放行", () => {
  for (const modify of [
    (value: EpisodeDevelopmentImpact) => {
      value.shots[1]!.associationImpact = "unresolved";
    },
    (value: EpisodeDevelopmentImpact) => {
      value.shots[1]!.record = null;
    },
    (value: EpisodeDevelopmentImpact) => {
      value.attributionImpact!.isCurrent = false;
    },
    (value: EpisodeDevelopmentImpact) => {
      value.isCurrent = false;
    },
  ]) {
    const value = report();
    modify(value);
    expect(() =>
      freeze(
        value,
        { ...draft(), decisions: { "shot-0": "redo", "shot-1": "redo" } },
        ["shot-0", "shot-1"],
      ),
    ).toThrow();
  }
  const stale = report();
  stale.sourceState = "stale";
  expect(() => freeze(stale)).toThrow();
  expect(
    freeze(
      stale,
      { ...draft(), decisions: { "shot-0": "redo", "shot-1": "redo" } },
      ["shot-0", "shot-1"],
    ).review.shots,
  ).toHaveLength(2);
  const affected = report();
  affected.shots[1]!.associationImpact = "affected";
  expect(() => freeze(affected)).toThrow();
});
test("普通审阅不预填决定、不预勾确认，明确呈现未关联与语义未认证", () => {
  const html = renderToStaticMarkup(
    <StoryboardSourceReviewComposer
      reference={reference}
      attribution={attribution}
      report={report()}
      selectedShotIds={["shot-0"]}
      scopeKey="original-scope"
      onFreeze={() => {}}
      onInvalidate={() => {}}
    />,
  );
  expect(html).toContain("未关联，不等于未变化");
  expect(html).toContain("不证明语义安全");
  expect(html.match(/selected=""/gu)).toHaveLength(2);
  expect(html).not.toContain("checked=");
  expect(html).toContain("disabled=");
  for (const label of Object.values(sourceReviewConfirmations))
    expect(html).toContain(label);
});
function input() {
  const frame = freeze();
  return CreationInputSchema.parse({
    projectId: reference.projectId,
    operation: "storyboard-package",
    instruction: "Explicit original author instruction",
    engineKind: "langgraph",
    sourceIds: [],
    episodeDevelopmentRequest: {
      episodeId: reference.episodeId,
      direct: {
        entryPath: "inspiration",
        project: { id: reference.projectId, version: 1 },
        authorIntent: { id: id(12), version: 1 },
        episode: { id: reference.episodeId, version: 0 },
        durationSeconds: 90,
      },
      outline: { id: id(13), version: 1 },
      script: { id: id(9), version: 1 },
      baseStoryboardId: ref.id,
      baseScriptDocumentVersion: 0,
      redoShots: [{ shotId: "shot-0", recordId: id(5), version: 0 }],
      redoSourceReview: frame.review,
    },
  });
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("创建前完整输入／原键持久化，重新读取保持原指令／选择，脏恢复数据与跨项目拒绝", () => {
  const original = freezeStoryboardRedoStartRequest(input()),
    store = storage();
  saveStoryboardRedoStartRequest(store, original);
  const key = storyboardRedoStartStorageKey(
    reference.projectId,
    reference.episodeId,
  );
  expect(
    parseStoryboardRedoStartRequest(
      store.getItem(key),
      reference.projectId,
      reference.episodeId,
    ),
  ).toEqual(original);
  expect(() =>
    saveStoryboardRedoStartRequest(
      store,
      freezeStoryboardRedoStartRequest(input()),
    ),
  ).toThrow();
  for (const raw of [
    "{bad",
    JSON.stringify({ ...original, extra: "private" }),
    " ".repeat(2 * 1024 * 1024 + 1),
    JSON.stringify({
      ...original,
      input: { ...original.input, projectId: id(30) },
    }),
  ])
    expect(() =>
      parseStoryboardRedoStartRequest(
        raw,
        reference.projectId,
        reference.episodeId,
      ),
    ).toThrow();
  expect(store.getItem(key)).toBe(JSON.stringify(original));
  expect(
    clearExactStoryboardRedoStartRequest(store, { ...original, key: id(31) }),
  ).toBe(false);
  expect(clearExactStoryboardRedoStartRequest(store, original)).toBe(true);
});
test("保存拒绝和回读不一致不开放创建；完整审阅差异进入工作台精确scope", () => {
  const original = freezeStoryboardRedoStartRequest(input());
  expect(() =>
    saveStoryboardRedoStartRequest(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("本机存储拒绝");
        },
      },
      original,
    ),
  ).toThrow();
  expect(() =>
    saveStoryboardRedoStartRequest(
      { getItem: () => null, setItem: () => {} },
      original,
    ),
  ).toThrow();
  const changed = structuredClone(original.input);
  changed.episodeDevelopmentRequest!.redoSourceReview!.impactHash = "b".repeat(
    64,
  );
  expect(creationWorkbenchScopeKey(original.input)).not.toBe(
    creationWorkbenchScopeKey(changed),
  );
});
test("原创建重发只发送完整原body与key，丢回复保留恢复；不接受缺来源回执或错body候选", async () => {
  const original = freezeStoryboardRedoStartRequest(input());
  const calls: { key: string | null; input: unknown }[] = [];
  let response: unknown;
  const client = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: reference.projectId,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async (url, init) => {
      const request = new Request(url, init);
      calls.push({
        key: request.headers.get("Idempotency-Key"),
        input: await request.json(),
      });
      if (!response) throw new Error("原回复丢失");
      return Response.json(response);
    },
  });
  await expect(
    resendStoryboardRedoStart(client.creation, original),
  ).rejects.toThrow();
  response = CreationWorkflowSchema.parse({
    id: id(40),
    taskId: id(41),
    input: original.input,
    stage: "preparing",
    version: 0,
    runIds: [],
    contextSnapshotIds: [],
    sources: [],
    preparedPrompt: "",
    issues: [],
    createdAt: "2026-10-05T09:00:00.000Z",
    updatedAt: "2026-10-05T09:00:00.000Z",
  });
  await expect(
    resendStoryboardRedoStart(client.creation, original),
  ).rejects.toThrow();
  expect(calls).toHaveLength(2);
  for (const call of calls)
    expect(call).toEqual({ key: original.key, input: original.input });
  const base = response as ReturnType<typeof CreationWorkflowSchema.parse>;
  const request = original.input.episodeDevelopmentRequest!;
  const sourceReview = {
    format: "frozen-storyboard-source-review-v1",
    projectId: reference.projectId,
    episodeId: reference.episodeId,
    storyboard: ref,
    review: request.redoSourceReview,
    sourceFingerprint: hash,
    associationFingerprint: hash,
    impactContentHash: hash,
    scopeHash: hash,
    semanticVerification: "unverified",
  };
  response = CreationWorkflowSchema.parse({
    ...base,
    creationRequestReceipt: {
      format: "creation-request-receipt-v1",
      key: original.key,
      requestHash: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify({ input: original.input })),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
    },
    episodeDevelopmentBasis: {
      request,
      authorIntent: request.direct!.authorIntent,
      episode: {
        sourcePath: "direct-script",
        ...request.direct!.episode,
        title: "Contract-only episode",
        orderIndex: 0,
        durationSeconds: 90,
      },
      chapters: [],
      references: [5, 6, 7, 8].map((n) => ({
        sourceKind: "production",
        sourceId: id(n),
        sourceVersion: 0,
        fieldPath: `/production/${id(n)}`,
        contentHash: hash,
      })),
      storyboardRedo: {
        base: ref,
        baseContentHash: hash,
        shots: request.redoShots,
        previousScript: request.script,
        scope: "stable-mapping-fixed-duration-existing-assets-v1",
        semanticVerification: "unverified",
        sourceReview,
      },
    },
  });
  expect((await resendStoryboardRedoStart(client.creation, original)).id).toBe(
    base.id,
  );
  expect(calls[2]).toEqual({ key: original.key, input: original.input });
  const actualReceipt = response as ReturnType<
    typeof CreationWorkflowSchema.parse
  >;
  response = {
    ...actualReceipt,
    input: {
      ...actualReceipt.input,
      model: { modelId: "server-frozen-default" },
    },
  };
  expect((await resendStoryboardRedoStart(client.creation, original)).id).toBe(
    base.id,
  );
  for (const creationRequestReceipt of [
    undefined,
    { ...actualReceipt.creationRequestReceipt!, key: id(70) },
    { ...actualReceipt.creationRequestReceipt!, requestHash: "0".repeat(64) },
  ]) {
    response = { ...actualReceipt, creationRequestReceipt };
    await expect(
      resendStoryboardRedoStart(client.creation, original),
    ).rejects.toThrow("原输入哈希与幂等键");
  }
  response = actualReceipt;
  await expect(
    resendStoryboardRedoStart(
      client.creation,
      freezeStoryboardRedoStartRequest(
        { ...original.input, model: { modelId: "different-explicit-model" } },
        original.key,
      ),
    ),
  ).rejects.toThrow("原输入哈希与幂等键");
  response = {
    ...(response as object),
    input: { ...original.input, instruction: "different request" },
  };
  await expect(
    resendStoryboardRedoStart(client.creation, original),
  ).rejects.toThrow();
});
