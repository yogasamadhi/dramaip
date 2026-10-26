import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  NovelRevisionEffortResultSchema,
  NovelRevisionConfigurationSchema,
  measureCreativeConfigurationFunnel,
  measureNovelRevisionConfigurations,
  type CreativeWorkflowExecution,
} from "@dramaip/contracts/insights";
import { createNovelRevisionEffortClient } from "../../client/src/novel-revision-effort";
import { creativeExecutionLedgerFixture } from "../../../tests/fixtures/creative-execution-ledger";
import { NovelRevisionConfigurationView } from "./features/insights/NovelRevisionEffort";

function dataset() {
  const projectId = crypto.randomUUID();
  const ledgers = Array.from({ length: 3 }, (_, i) => {
    const value = creativeExecutionLedgerFixture(projectId),
      key = (15 - i).toString(16).repeat(64);
    value.projection = { state: "healthy", checkpoint: 100 };
    value.request.record.cursor += i * 10;
    if (
      value.request.family === "creative" &&
      value.request.record.fact.kind === "request"
    )
      value.request.record.fact.targetKey = key;
    for (const fact of value.facts.items) {
      fact.record.cursor += i * 10;
      if (
        fact.family === "creative" &&
        fact.record.fact.kind !== "owner-rejection"
      )
        fact.record.fact.targetKey = key;
    }
    return CreativeWorkflowExecutionSchema.parse(value);
  });
  const revision = NovelRevisionEffortResultSchema.parse({
    format: "novel-revision-effort-result-v1",
    projectId,
    projection: { state: "healthy", checkpoint: 100 },
    totalTargets: 3,
    items: ledgers.map((l, i) => {
      const adopt = l.facts.items.find((f) => f.family === "outcome");
      if (
        !adopt ||
        adopt.family !== "outcome" ||
        l.request.family !== "creative" ||
        l.request.record.fact.kind !== "request"
      )
        throw Error("Fixture scope");
      return {
        targetKey: l.request.record.fact.targetKey,
        workflowIds: [l.workflowId],
        state: "measured",
        localRevisionCount: i + 1,
        observedContentUpdates: i + 1,
        observedRebases: 0,
        observedContentChangingRebases: 0,
        adoption: {
          eventId: adopt.record.eventId,
          cursor: adopt.record.cursor,
          workflowId: l.workflowId,
          previewId: adopt.record.candidate!.id,
          chapterId: adopt.record.objectId,
          version: 1,
        },
      };
    }),
    policy: "saved-content-changes-before-first-recorded-formal-adoption",
    modelRevisions: "excluded",
    qualityState: "unverified",
  });
  const input = () => ({
    requestPages: [
      CreativeExecutionRequestPageSchema.parse({
        projectId,
        projection: revision.projection,
        historyPolicy: "recorded-original-requests-only",
        items: ledgers.map((l) => l.request).reverse(),
      }),
    ],
    workflowPages: ledgers.map((l) => ({
      workflowId: l.workflowId,
      pages: [l],
    })),
  });
  return {
    projectId,
    ledgers,
    revision,
    input,
    configuration: () => ({
      funnel: measureCreativeConfigurationFunnel(projectId, input()),
      requestPages: input().requestPages,
    }),
  };
}
function model(l: CreativeWorkflowExecution, id: string) {
  if (l.execution.state !== "recorded") throw Error("Fixture execution");
  for (const r of l.execution.receipt.runs)
    if (r.state === "recorded")
      r.execution.model = {
        status: "recorded",
        modelId: id,
        providerId: "original-provider",
      };
}

test("novel revisions stay in the first-target original configuration when retries change models, without double-counting the target", () => {
  const d = dataset(),
    [first, retry, independent] = d.ledgers;
  model(first!, "A");
  model(retry!, "B");
  model(independent!, "B");
  const key = d.revision.items[0]!.targetKey;
  if (
    retry!.request.family !== "creative" ||
    retry!.request.record.fact.kind !== "request" ||
    retry!.execution.state !== "recorded"
  )
    throw Error("Fixture retry");
  Object.assign(retry!.request.record.fact, {
    targetKey: key,
    targetAttempt: 2,
    requestKind: "retry",
    parentWorkflowId: first!.workflowId,
  });
  retry!.execution.receipt.sourceWorkflowId = first!.workflowId;
  for (const f of retry!.facts.items)
    if (f.family === "creative" && f.record.fact.kind !== "owner-rejection") {
      f.record.fact.targetKey = key;
      if (f.record.fact.kind === "request")
        Object.assign(f.record.fact, retry!.request.record.fact);
    }
  first!.facts.items = first!.facts.items.filter((f) => f.family !== "outcome");
  const row = d.revision.items[0]!,
    final = d.revision.items[1]!;
  Object.assign(row, {
    workflowIds: [first!.workflowId, retry!.workflowId],
    localRevisionCount: 3,
    observedContentUpdates: 3,
    adoption: final.adoption,
  });
  d.revision.items.splice(1, 1);
  d.revision.totalTargets = 2;
  const before = structuredClone(d.revision),
    config = d.configuration(),
    value = measureNovelRevisionConfigurations(d.projectId, d.revision, config);
  expect(d.revision).toEqual(before);
  expect(value.groups).toHaveLength(2);
  expect(value).toMatchObject({
    recordedTargets: 2,
    recordedWorkflows: 3,
    modelEvidence: "unknown",
  });
  const original = value.groups.find((g) =>
    g.anchorWorkflowIds.includes(first!.workflowId),
  )!;
  expect(original.configuration).toMatchObject({
    state: "recorded",
    model: { modelId: "A" },
  });
  expect(original.items[0]!.workflowIds).toEqual([
    first!.workflowId,
    retry!.workflowId,
  ]);
  expect(original.summary).toMatchObject({
    measuredTargets: 1,
    mean: { numerator: "3", denominator: 1 },
  });
  const reversed = structuredClone(d.revision);
  reversed.items[0]!.workflowIds.reverse();
  expect(() =>
    measureNovelRevisionConfigurations(d.projectId, reversed, config),
  ).toThrow();
});

test("novel revision averages preserve actual zero, unknown adopted history and unadopted targets separately, including unknown model groups", () => {
  const d = dataset(),
    [zero, unknown, pending] = d.revision.items;
  Object.assign(zero!, { localRevisionCount: 0, observedContentUpdates: 0 });
  Object.assign(unknown!, { state: "unknown", localRevisionCount: null });
  Object.assign(pending!, {
    state: "pending",
    localRevisionCount: null,
    adoption: null,
  });
  d.ledgers[2]!.facts.items = d.ledgers[2]!.facts.items.filter(
    (f) => f.family !== "outcome",
  );
  const value = measureNovelRevisionConfigurations(
    d.projectId,
    d.revision,
    d.configuration(),
  );
  expect(value.groups[0]!.summary).toEqual({
    targets: 3,
    measuredTargets: 1,
    unknownAdoptedTargets: 1,
    pendingTargets: 1,
    minimum: 0,
    maximum: 0,
    mean: { numerator: "0", denominator: 1 },
  });
  for (const state of ["missing", "unavailable", "read-failed"] as const) {
    d.ledgers[0]!.execution = { state };
    const result = measureNovelRevisionConfigurations(
      d.projectId,
      d.revision,
      d.configuration(),
    );
    expect(
      result.groups.find((g) => g.configuration.state === state)?.summary
        .measuredTargets,
    ).toBe(1);
  }
  Object.assign(zero!, { state: "unknown", localRevisionCount: null });
  expect(
    measureNovelRevisionConfigurations(
      d.projectId,
      d.revision,
      d.configuration(),
    ).groups.every((g) => g.summary.mean === null),
  ).toBe(true);
});

test("novel revision means use exact BigInt numerators beyond safe sums and reject invented arithmetic", () => {
  const d = dataset();
  for (const row of d.revision.items)
    Object.assign(row, {
      localRevisionCount: Number.MAX_SAFE_INTEGER,
      observedContentUpdates: Number.MAX_SAFE_INTEGER,
    });
  const value = measureNovelRevisionConfigurations(
    d.projectId,
    d.revision,
    d.configuration(),
  );
  expect(value.groups[0]!.summary.mean).toEqual({
    numerator: (3n * BigInt(Number.MAX_SAFE_INTEGER)).toString(),
    denominator: 3,
  });
  const bad = structuredClone(value);
  bad.groups[0]!.summary.mean!.denominator = 4;
  expect(NovelRevisionConfigurationSchema.safeParse(bad).success).toBe(false);
});

test("novel revision configuration joins reject foreign scope, changed checkpoints, incomplete attempts and mismatched target counts", () => {
  const d = dataset(),
    config = d.configuration();
  expect(() =>
    measureNovelRevisionConfigurations(crypto.randomUUID(), d.revision, config),
  ).toThrow();
  expect(() =>
    measureNovelRevisionConfigurations(d.projectId, d.revision, {
      ...config,
      funnel: {
        ...config.funnel,
        projection: { ...config.funnel.projection, checkpoint: 101 },
      },
    }),
  ).toThrow();
  expect(() =>
    measureNovelRevisionConfigurations(
      d.projectId,
      { ...d.revision, items: d.revision.items.slice(1), totalTargets: 2 },
      config,
    ),
  ).toThrow();
  const duplicate = structuredClone(d.revision);
  duplicate.items[1]!.workflowIds = duplicate.items[0]!.workflowIds;
  expect(NovelRevisionEffortResultSchema.safeParse(duplicate).success).toBe(
    false,
  );
  const wrongTarget = structuredClone(d.revision);
  wrongTarget.items[0]!.targetKey = "f".repeat(63) + "e";
  expect(() =>
    measureNovelRevisionConfigurations(d.projectId, wrongTarget, config),
  ).toThrow();
  const incomplete = structuredClone(config);
  incomplete.requestPages[0]!.nextCursor = 1;
  expect(() =>
    measureNovelRevisionConfigurations(d.projectId, d.revision, incomplete),
  ).toThrow();
  const unbound = structuredClone(d.revision);
  unbound.items[0]!.workflowIds[0] = crypto.randomUUID();
  unbound.items[0]!.adoption!.workflowId = unbound.items[0]!.workflowIds[0];
  expect(() =>
    measureNovelRevisionConfigurations(d.projectId, unbound, config),
  ).toThrow();
});

test("novel configuration SDK reads all original pages using GET and the same signal, fences the final history and refuses changed, failed or cancelled reads", async () => {
  const d = dataset(),
    requests: { path: string; init?: RequestInit }[] = [];
  let revisionReads = 0,
    changed = false,
    fail = false,
    abortLate: AbortController | undefined;
  const sdk = createNovelRevisionEffortClient(
    async <T,>(path: string, init?: RequestInit) => {
      requests.push({ path, init });
      const url = new URL(path, "http://local.test");
      if (path.includes("/revision-effort")) {
        revisionReads++;
        const { format: _format, items, ...fields } = d.revision;
        return {
          ...fields,
          format: "novel-revision-effort-page-v1",
          projection:
            changed && revisionReads > 2
              ? { ...fields.projection, checkpoint: 101 }
              : fields.projection,
          items: url.searchParams.has("cursor")
            ? items.slice(1)
            : items.slice(0, 1),
          ...(url.searchParams.has("cursor")
            ? {}
            : { nextCursor: "opaque-original-target" }),
        } as T;
      }
      if (url.pathname.endsWith("/executions"))
        return d.input().requestPages[0] as T;
      if (fail) throw Error("Original owner failed");
      const value = d.ledgers.find((l) => url.pathname.endsWith(l.workflowId));
      if (!value) throw Error("Unexpected GET");
      abortLate?.abort();
      return value as T;
    },
  );
  const signal = new AbortController().signal;
  expect(
    (await sdk.configurationGroups(d.projectId, signal)).groups[0]!.summary
      .mean,
  ).toEqual({ numerator: "6", denominator: 3 });
  expect(revisionReads).toBe(4);
  expect(
    requests.every((r) => !r.init?.method || r.init.method === "GET"),
  ).toBe(true);
  expect(requests.every((r) => r.init?.signal === signal)).toBe(true);
  changed = true;
  revisionReads = 0;
  await expect(sdk.configurationGroups(d.projectId)).rejects.toThrow();
  changed = false;
  fail = true;
  await expect(sdk.configurationGroups(d.projectId)).rejects.toThrow(
    "Original owner failed",
  );
  fail = false;
  abortLate = new AbortController();
  await expect(
    sdk.configurationGroups(d.projectId, abortLate.signal),
  ).rejects.toThrow();
  const before = requests.length;
  await expect(
    sdk.configurationGroups(d.projectId, abortLate.signal),
  ).rejects.toThrow();
  expect(requests).toHaveLength(before);
});

test("novel configuration view shows measured-only denominator, exact fractions, missing data and no model quality claim", () => {
  const d = dataset();
  const v = measureNovelRevisionConfigurations(
    d.projectId,
    d.revision,
    d.configuration(),
  );
  const html = renderToStaticMarkup(
    <NovelRevisionConfigurationView value={v} />,
  );
  expect(html).toContain("原配置章节修订结果");
  expect(html).toContain("已可核采用 3 / 目标 3");
  expect(html).toContain("均值 6/3 次（精确分数）");
  expect(html).toContain("不表示所有尝试均使用本组模型");
  expect(html).toContain("不是模型质量");
  expect(html).not.toContain("PRIVATE");
});
