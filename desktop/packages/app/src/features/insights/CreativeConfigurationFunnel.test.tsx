import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  measureCreativeConfigurationFunnel,
  type CreativeWorkflowExecution,
} from "@dramaip/contracts/insights";
import { createCreativeOutcomeClient } from "../../../../client/src/creative-outcomes";
import { creativeExecutionLedgerFixture } from "../../../../../tests/fixtures/creative-execution-ledger";
import { CreativeConfigurationFunnelView } from "./CreativeConfigurationFunnel";

function dataset(...values: CreativeWorkflowExecution[]) {
  const projectId = values[0]!.projectId,
    checkpoint = 10000;
  const ledgers = values.map((v, i) => {
    const value = structuredClone(v);
    value.projection = { state: "healthy", checkpoint };
    value.request.record.cursor += i * 10;
    if (
      value.request.family === "creative" &&
      value.request.record.fact.kind === "request"
    )
      value.request.record.fact.targetKey = i.toString(16).padStart(64, "0");
    for (const f of value.facts.items) {
      f.record.cursor += i * 10;
      if (f.family === "creative" && f.record.fact.kind !== "owner-rejection")
        f.record.fact.targetKey = i.toString(16).padStart(64, "0");
    }
    return CreativeWorkflowExecutionSchema.parse(value);
  });
  return {
    projectId,
    ledgers,
    input: {
      requestPages: [
        CreativeExecutionRequestPageSchema.parse({
          projectId,
          projection: { state: "healthy", checkpoint },
          historyPolicy: "recorded-original-requests-only",
          items: ledgers.map((v) => v.request).reverse(),
        }),
      ],
      workflowPages: ledgers.map((v) => ({
        workflowId: v.workflowId,
        pages: [v],
      })),
    },
  };
}
function model(value: CreativeWorkflowExecution, modelId: string) {
  if (value.execution.state !== "recorded") throw Error("receipt absent");
  for (const r of value.execution.receipt.runs)
    if (r.state === "recorded")
      r.execution.model = {
        status: "recorded",
        modelId,
        providerId: "original-provider",
      };
}
function syncRequests(set: ReturnType<typeof dataset>) {
  set.input.requestPages[0]!.items = set.ledgers
    .map((v) => v.request)
    .reverse();
  return set.input;
}
test("A07 complete original configuration funnel keeps changed-model retries in their first-target group without resetting first candidate denominators", () => {
  const projectId = crypto.randomUUID();
  const set = dataset(
    ...Array.from({ length: 3 }, () =>
      creativeExecutionLedgerFixture(projectId),
    ),
  );
  const [original, retry, independent] = set.ledgers;
  model(original!, "original-A");
  model(retry!, "retry-B");
  model(independent!, "retry-B");
  const key =
    original!.request.family === "creative" &&
    original!.request.record.fact.kind === "request"
      ? original!.request.record.fact.targetKey
      : "";
  const fact = retry!.request.record.fact;
  if (fact.kind !== "request" || retry!.execution.state !== "recorded")
    throw Error("request absent");
  fact.targetKey = key;
  fact.targetAttempt = 2;
  fact.requestKind = "retry";
  fact.parentWorkflowId = original!.workflowId;
  retry!.execution.receipt.sourceWorkflowId = original!.workflowId;
  for (const f of retry!.facts.items)
    if (f.family === "creative" && f.record.fact.kind !== "owner-rejection") {
      f.record.fact.targetKey = key;
      if (f.record.fact.kind === "request") Object.assign(f.record.fact, fact);
    }
  original!.facts.items = original!.facts.items.filter(
    (f) => f.family !== "outcome",
  );
  const candidate = original!.facts.items.find(
    (f) => f.family === "creative" && f.record.fact.kind === "candidate-ready",
  );
  if (!candidate || candidate.family !== "creative")
    throw Error("candidate absent");
  if (candidate.record.fact.kind !== "candidate-ready")
    throw Error("candidate fact absent");
  const { candidate: _candidate, ...common } = candidate.record.fact;
  original!.facts.items.unshift({
    family: "creative",
    record: {
      ...candidate.record,
      eventId: crypto.randomUUID(),
      cursor: 4,
      occurredAt: "2026-10-07T00:00:04.000Z",
      fact: {
        ...common,
        kind: "state",
        workflowVersion: 9,
        state: "discarded",
      },
    },
  } as any);
  syncRequests(set);
  const before = structuredClone(set.input),
    result = measureCreativeConfigurationFunnel(projectId, set.input);
  expect(set.input).toEqual(before);
  expect(result).toMatchObject({
    recordedWorkflows: 3,
    recordedTargets: 2,
    modelEvidence: "unknown",
    qualityState: "unverified",
    billingStatus: "unknown",
  });
  expect(result.groups).toHaveLength(2);
  const first = result.groups.find((g) =>
    g.workflowIds.includes(original!.workflowId),
  )!;
  expect(first.workflowIds).toEqual([original!.workflowId, retry!.workflowId]);
  expect(first.configuration).toMatchObject({
    state: "recorded",
    model: { modelId: "original-A" },
  });
  expect(first.summary.measures[0]).toMatchObject({
    recordedRequests: 2,
    requestedTargets: 1,
    firstCandidates: 1,
    firstAdopted: 0,
    closedWithoutFirstAdoption: 1,
    retryCandidates: 1,
    firstCandidateAdoptionRatio: 0,
  });
  expect(
    result.groups.find((g) => g.workflowIds.includes(independent!.workflowId))!
      .summary.measures[0],
  ).toMatchObject({ firstCandidates: 1, firstAdopted: 1 });
  expect(
    renderToStaticMarkup(<CreativeConfigurationFunnelView value={result} />),
  ).toContain("包含重试，不表示全部使用本组配置");
});
test("A07 configuration funnel preserves unobserved-first, missing generation and owner failure groups without fabricated model or zero denominator", () => {
  for (const state of ["missing", "unavailable", "read-failed"] as const) {
    const set = dataset(creativeExecutionLedgerFixture());
    set.ledgers[0]!.execution = { state };
    const result = measureCreativeConfigurationFunnel(set.projectId, set.input);
    expect(result.groups[0]!.configuration).toEqual({ state });
    expect(result.groups[0]!.summary.measures[0]).toMatchObject({
      firstCandidates: 1,
      firstAdopted: 1,
    });
  }
  const set = dataset(creativeExecutionLedgerFixture()),
    value = set.ledgers[0]!;
  if (
    value.execution.state !== "recorded" ||
    value.request.record.fact.kind !== "request"
  )
    throw Error("receipt absent");
  value.execution.receipt.runs = [];
  value.execution.usage = [];
  expect(
    measureCreativeConfigurationFunnel(set.projectId, set.input).groups[0]!
      .configuration,
  ).toEqual({ state: "missing-generating-run" });
  const fact = value.request.record.fact;
  fact.targetAttempt = 2;
  fact.requestKind = "retry";
  fact.parentWorkflowId = crypto.randomUUID();
  value.execution.receipt.sourceWorkflowId = fact.parentWorkflowId;
  for (const item of value.facts.items)
    if (item.family === "creative" && item.record.fact.kind === "request")
      Object.assign(item.record.fact, fact);
  syncRequests(set);
  const result = measureCreativeConfigurationFunnel(set.projectId, set.input);
  expect(result.groups[0]!.configuration).toEqual({
    state: "unobserved-first-request",
  });
  expect(result.groups[0]!.summary.measures[0]).toMatchObject({
    unobservedFirstTargets: 1,
    firstCandidates: 0,
    firstCandidateAdoptionRatio: null,
  });
});
test("A07 configuration aggregation refuses partial, duplicate, changed checkpoint, altered original request and changed receipt pages without leaked metadata", () => {
  for (const change of [
    (v: any) => {
      v.requestPages[0].nextCursor = 1;
    },
    (v: any) => {
      v.workflowPages = [];
    },
    (v: any) => {
      v.workflowPages.push(v.workflowPages[0]);
    },
    (v: any) => {
      v.workflowPages[0].pages[0].projection.checkpoint++;
    },
    (v: any) => {
      v.workflowPages[0].pages[0].request.record.fact.requestedAt =
        "2020-01-01T00:00:00.000Z";
    },
    (v: any) => {
      v.workflowPages[0].pages[0].facts.nextCursor = 1;
    },
    (v: any) => {
      v.workflowPages[0].pages[0].execution.receipt.runs[0].execution.model.apiKey =
        "PRIVATE";
    },
  ]) {
    const set = dataset(creativeExecutionLedgerFixture()),
      input = structuredClone(set.input);
    change(input);
    expect(() =>
      measureCreativeConfigurationFunnel(set.projectId, input),
    ).toThrow("原配置漏斗读取不完整");
  }
});
test("A07 configuration funnel preserves pending, edited adoption and inconsistent clocks instead of turning them into direct adoption or quality", () => {
  const set = dataset(creativeExecutionLedgerFixture()),
    value = set.ledgers[0]!;
  const adoption = value.facts.items.find((f) => f.family === "outcome");
  if (!adoption || adoption.family !== "outcome" || !adoption.record.candidate)
    throw Error("adoption absent");
  value.facts.items = value.facts.items.filter((f) => f.family !== "outcome");
  let result = measureCreativeConfigurationFunnel(set.projectId, set.input);
  expect(result.groups[0]!.summary.measures[0]).toMatchObject({
    firstCandidates: 1,
    pendingDecision: 1,
    firstAdopted: 0,
    firstCandidateAdoptionRatio: 0,
  });
  adoption.record.candidate.contentFingerprint = "e".repeat(64);
  adoption.record.occurredAt = "2025-01-01T00:00:00.000Z";
  value.facts.items.unshift(adoption);
  result = measureCreativeConfigurationFunnel(set.projectId, set.input);
  expect(result.groups[0]!.summary.measures[0]).toMatchObject({
    revisedAdoption: 1,
    firstAdopted: 0,
    pendingDecision: 0,
    firstAccepted: {
      adoptionMode: "edited-candidate",
      clockState: "inconsistent",
      requestToAdoptMs: null,
    },
  });
  expect(result.qualityState).toBe("unverified");
});
test("A07 complete configuration page chains reject valid-shaped receipts that change between pages and empty manufactured terminal pages", () => {
  for (const mode of ["receipt", "checkpoint", "empty"] as const) {
    const set = dataset(creativeExecutionLedgerFixture()),
      value = set.ledgers[0]!;
    const tail = structuredClone(value);
    value.facts = { items: value.facts.items.slice(0, 2), nextCursor: 2 };
    tail.facts = { items: [tail.request] };
    if (mode === "receipt") model(tail, "changed-original");
    else if (mode === "checkpoint") tail.projection.checkpoint++;
    else tail.facts.items = [];
    set.input.workflowPages[0]!.pages.push(tail);
    expect(() =>
      measureCreativeConfigurationFunnel(set.projectId, set.input),
    ).toThrow("原配置漏斗读取不完整");
  }
});
test("A07 SDK reads original request/workflow pagination with one signal and a final checkpoint fence, never posts, retries or returns partial failures", async () => {
  const set = dataset(creativeExecutionLedgerFixture()),
    value = set.ledgers[0]!,
    controller = new AbortController();
  const calls: string[] = [];
  let mode: "normal" | "changed" | "fail" | "abort" = "normal",
    heads = 0;
  const sdk = createCreativeOutcomeClient(
    async <T,>(path: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      expect(init?.method).toBeUndefined();
      calls.push(path);
      if (path.endsWith("/executions?limit=25")) {
        heads++;
        const page = structuredClone(set.input.requestPages[0]!);
        if (mode === "changed" && heads > 1) page.projection.checkpoint++;
        return page as T;
      }
      if (mode === "fail") throw Error("controlled failure");
      if (mode === "abort") controller.abort();
      const detail = structuredClone(value);
      detail.facts = path.includes("cursor=")
        ? { items: [detail.request] }
        : { items: detail.facts.items.slice(0, 2), nextCursor: 2 };
      return detail as T;
    },
  );
  const result = await sdk.configurationFunnel(
    set.projectId,
    controller.signal,
  );
  expect(result.recordedWorkflows).toBe(1);
  expect(calls).toHaveLength(4);
  for (const state of ["changed", "fail", "abort"] as const) {
    mode = state;
    heads = 0;
    await expect(
      sdk.configurationFunnel(set.projectId, controller.signal),
    ).rejects.toThrow();
  }
});
