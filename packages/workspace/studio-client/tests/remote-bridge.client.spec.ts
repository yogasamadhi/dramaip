// @vitest-environment jsdom
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import {
  bridgeLegacyRequest,
  compileLegacyTables,
  LEGACY_TABLES,
} from "../src/client/remote-bridge.ts";
import { inject } from "../src/client/index.ts";

const ORIGIN = "http://studio.test";
const ROUTES = compileLegacyTables(LEGACY_TABLES);

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (code: string, message: string, details?: unknown) =>
  Promise.resolve({ ok: false as const, error: { code, message, details } });

/** An `insights` namespace whose methods the test fills in. */
function remoteWith(insights: Record<string, unknown>): Context["remote"] {
  return { insights } as unknown as Context["remote"];
}

const call = (
  remote: Context["remote"],
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const response = bridgeLegacyRequest(
    remote,
    ROUTES,
    `${ORIGIN}${path}`,
    init,
    ORIGIN,
  );
  if (response === undefined) throw new Error(`${path} was not bridged`);
  return response;
};

describe("the domain Remote bridge", () => {
  it("is injected with the namespace of every table it answers from", () => {
    for (const { namespace } of LEGACY_TABLES)
      expect(inject).toContain(`remote.${namespace}`);
  });

  it("passes path parameters and the body positionally, answering the route's status", async () => {
    const feedbackCommit = vi.fn(() => ok({ id: "batch-1" }));
    const response = await call(
      remoteWith({ feedbackCommit }),
      "/api/v2/feedback/import%201/commit",
      { method: "POST", body: JSON.stringify({ projectId: "p-1" }) },
    );
    expect(feedbackCommit).toHaveBeenCalledWith(
      "import 1",
      { projectId: "p-1" },
      undefined,
      undefined,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "batch-1" });
  });

  it("passes the write's If-Match and Idempotency-Key, keeping the method's arity", async () => {
    const generationUpdate = vi.fn(() => ok({ id: "r-1" }));
    await call(
      remoteWith({ generationUpdate }),
      "/api/v2/generation-ledger/r-1",
      {
        method: "PATCH",
        headers: { "If-Match": '"v1"' },
        body: JSON.stringify({ actualCost: 0 }),
      },
    );
    expect(generationUpdate).toHaveBeenCalledWith(
      "r-1",
      { actualCost: 0 },
      '"v1"',
      undefined,
    );
  });

  it("reads the query as one object, numbering the fields the table names", async () => {
    const generationCostObservations = vi.fn(() => ok({ items: [] }));
    const outcomes = vi.fn(() => ok({ items: [] }));
    const remote = remoteWith({ generationCostObservations, outcomes });
    await call(
      remote,
      "/api/v2/generation-ledger/r-1/cost-observations?projectId=p-1&cursor=40&limit=20",
    );
    await call(remote, "/api/v2/projects/p-1/creative-outcomes?cursor=40");
    expect(generationCostObservations).toHaveBeenCalledWith("r-1", {
      projectId: "p-1",
      cursor: 40,
      limit: 20,
    });
    expect(outcomes).toHaveBeenCalledWith("p-1", { cursor: "40" });
  });

  it("matches the most specific path of a shared prefix", async () => {
    const execution = vi.fn(() => ok({ workflowId: "w-1" }));
    const executions = vi.fn(() => ok({ items: [] }));
    await call(
      remoteWith({ execution, executions }),
      "/api/v2/projects/p-1/creative-outcomes/executions/w-1?limit=5",
    );
    expect(execution).toHaveBeenCalledWith("p-1", "w-1", { limit: 5 });
    expect(executions).not.toHaveBeenCalled();
  });

  it("takes a literal segment over a template it also fits, as the replaced router did", async () => {
    const storyboardAttributionGet = vi.fn(() => ok({}));
    const storyboardAttributionSummaries = vi.fn(() => ok({ items: [] }));
    const response = bridgeLegacyRequest(
      {
        production: {
          storyboardAttributionGet,
          storyboardAttributionSummaries,
        },
      } as unknown as Context["remote"],
      ROUTES,
      `${ORIGIN}/api/v2/projects/p-1/storyboard-attributions/summaries?limit=5`,
      undefined,
      ORIGIN,
    );
    expect((await response)?.status).toBe(200);
    expect(storyboardAttributionSummaries).toHaveBeenCalledWith("p-1", {
      limit: 5,
    });
    expect(storyboardAttributionGet).not.toHaveBeenCalled();
  });

  it("passes a nullable integer query parameter as a number", async () => {
    const playbackPlan = vi.fn(() => ok({}));
    const response = bridgeLegacyRequest(
      { timeline: { playbackPlan } } as unknown as Context["remote"],
      ROUTES,
      `${ORIGIN}/api/v2/timelines/t-1/playback-plan?projectId=p-1&timelineVersion=3`,
      undefined,
      ORIGIN,
    );
    expect((await response)?.status).toBe(200);
    expect(playbackPlan).toHaveBeenCalledWith("t-1", {
      projectId: "p-1",
      timelineVersion: 3,
    });
  });

  it("answers a handler problem with its status, code and field errors", async () => {
    const generationUpdate = vi.fn(() =>
      failed("compat/problem", "Generation record not found", {
        status: 404,
        code: "NOT_FOUND",
        errors: { id: ["unknown"] },
      }),
    );
    const response = await call(
      remoteWith({ generationUpdate }),
      "/api/v2/generation-ledger/r-1",
      { method: "PATCH", body: JSON.stringify({ actualCost: 1 }) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      title: "Generation record not found",
      status: 404,
      code: "NOT_FOUND",
      errors: { id: ["unknown"] },
    });
  });

  it("answers a Remote boundary rejection as the route's validation problem", async () => {
    const feedbackPreview = vi.fn(() =>
      failed("gateway/input-invalid", "projectId must be a string"),
    );
    const response = await call(
      remoteWith({ feedbackPreview }),
      "/api/v2/feedback/preview",
      { method: "POST", body: JSON.stringify({ projectId: 1 }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("answers a file value with its type and download name", async () => {
    const outcomeSummary = vi.fn(() =>
      ok({ contentType: "text/csv", fileName: "结果.csv", text: "a\n" }),
    );
    const response = await call(
      remoteWith({ outcomeSummary }),
      "/api/v2/projects/p-1/creative-outcomes/summary",
    );
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("结果.csv")}`,
    );
    await expect(response.text()).resolves.toBe("a\n");
  });

  it("leaves other paths, other methods and unselected namespaces to the page", () => {
    const remote = remoteWith({ feedbackDashboard: vi.fn() });
    for (const [path, init, target] of [
      ["/api/v2/projects/p-1/chapters", undefined, remote],
      ["/api/v2/projects/p-1/feedback", { method: "DELETE" }, remote],
      ["/api/insights/feedbackDashboard", { method: "POST" }, remote],
      ["/api/v2/projects/p-1/feedback", undefined, {} as Context["remote"]],
    ] as const)
      expect(
        bridgeLegacyRequest(target, ROUTES, `${ORIGIN}${path}`, init, ORIGIN),
      ).toBeUndefined();
  });
});
