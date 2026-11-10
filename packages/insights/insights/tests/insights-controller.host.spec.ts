import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { OperationRegistry } from "@dramaip/infra-operations";
import {
  defineRoute,
  defineRouteContribution,
} from "@dramaip/plugin-api/internal";
import {
  remoteErrorOf,
  remoteMethods,
  type TypertRemoteInfo,
} from "@dramaip/infra-typert-protocol";
import InsightsController, { replacedOperations } from "../src/index.ts";
import { insightsLegacyRoutes } from "../src/legacy.ts";

const projectId = "30000000-0000-4000-8000-000000000001";
const recordId = "30000000-0000-4000-8000-000000000002";

type Seen = {
  method: string;
  path: string;
  search: string;
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
};

/** A route of the insights plugin, answering what it was asked. */
function route(
  operationId: string,
  method: "get" | "post" | "patch",
  path: `/api/v2/${string}`,
  seen: Seen[],
  answer: (request: Request) => Response | Promise<Response> = (request) =>
    Response.json({ echoed: new URL(request.url).pathname }),
) {
  return defineRouteContribution({
    id: `insights:${operationId}`,
    pluginId: "insights",
    method,
    path,
    operationId,
    declaration: defineRoute({
      method,
      path,
      operationId,
      responses: { 200: { description: "Answer" } },
    }),
    handler: async (c: { req: { raw: Request } }) => {
      const request = c.req.raw;
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        ...(request.method === "GET"
          ? {}
          : { body: (await request.clone().json()) as unknown }),
        ...(request.headers.has("if-match")
          ? { ifMatch: request.headers.get("if-match")! }
          : {}),
        ...(request.headers.has("idempotency-key")
          ? { idempotencyKey: request.headers.get("idempotency-key")! }
          : {}),
      });
      return answer(request);
    },
  });
}

async function boot() {
  const registry = new OperationRegistry();
  const seen: Seen[] = [];
  registry.register(
    route("feedback.dashboard", "get", "/api/v2/projects/{id}/feedback", seen),
  );
  registry.register(
    route("feedback.commit", "post", "/api/v2/feedback/{id}/commit", seen),
  );
  registry.register(
    route(
      "generation.costObservations",
      "get",
      "/api/v2/generation-ledger/{id}/cost-observations",
      seen,
    ),
  );
  registry.register(
    route(
      "generation.update",
      "patch",
      "/api/v2/generation-ledger/{id}",
      seen,
      () =>
        Response.json(
          {
            type: "about:blank",
            title: "Generation record not found",
            status: 404,
            code: "NOT_FOUND",
            errors: { id: ["unknown record"] },
          },
          { status: 404 },
        ),
    ),
  );
  registry.register(
    route(
      "creativeOutcomes.summary",
      "get",
      "/api/v2/projects/{projectId}/creative-outcomes/summary",
      seen,
      () =>
        new Response("a,b\n1,2\n", {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="outcomes.csv"',
          },
        }),
    ),
  );
  // An operation no controller replaces stays on the served surface.
  registry.register(
    route("insights.unrelated", "get", "/api/v2/insights/unrelated", seen),
  );
  const ctx = new Context();
  ctx.provide("operations", registry);
  const fiber = ctx.plugin(InsightsController);
  await fiber.await();
  registry.publish();
  return { fiber, registry, seen, controller: ctx.insightsController };
}

describe("insights Remote namespace", () => {
  it("names every replaced operation exactly once, beside the whole-ledger measures", async () => {
    const { controller } = await boot();
    const measures = [
      "configurationFunnel",
      "deliveryCoverage",
      "deliveryWindow",
      "executionDetail",
      "executionList",
      "revisionConfigurations",
      "revisionEffortResult",
    ];
    expect(new Set(replacedOperations).size).toBe(replacedOperations.length);
    expect(remoteMethods(controller).length).toBe(
      replacedOperations.length + measures.length,
    );
    const names = remoteMethods(controller).map((marker) => marker.method);
    for (const name of measures) expect(names).toContain(name);
  });

  it("maps exactly the insights operations of the frozen ledger, at their method and path", () => {
    const ledger = JSON.parse(
      readFileSync(
        new URL(
          "../../../../architecture/refactor-ledger.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      operations: {
        operationId: string;
        method: string;
        path: string;
        domain: string;
      }[];
    };
    const frozen = ledger.operations
      .filter((operation) => operation.domain === "insights")
      .map(({ operationId, method, path }) => ({
        operationId,
        method: method.toUpperCase(),
        path,
      }))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
    const table = insightsLegacyRoutes.routes
      .map(({ operationId, method, path }) => ({ operationId, method, path }))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
    expect(table).toEqual(frozen);
  });

  it("names each argument as the generated Remote descriptor does", async () => {
    // Loaded at run time: the generator reads this spec, and its program must
    // not depend on the artifact it writes.
    const artifact = new URL("../lib/typert.remote-client.js", import.meta.url);
    const { default: insightsRemote } = (await import(artifact.href)) as {
      default: TypertRemoteInfo;
    };
    const parameters = (method: string) =>
      insightsRemote.descriptors
        .find((descriptor) => descriptor.method === method)
        ?.parameters.map(({ name }) => name);
    for (const route of insightsLegacyRoutes.routes)
      expect(route.args.map(({ name }) => name)).toEqual(
        parameters(route.remote),
      );
  });

  it("takes its operations off the served /api/v2 surface and gives them back on dispose", async () => {
    const { fiber, registry } = await boot();
    const served = await registry.fetch(
      new Request(`http://local/api/v2/projects/${projectId}/feedback`),
    );
    expect(served.status).toBe(404);
    const unrelated = await registry.fetch(
      new Request("http://local/api/v2/insights/unrelated"),
    );
    expect(unrelated.status).toBe(200);

    await fiber.dispose();
    const restored = await registry.fetch(
      new Request(`http://local/api/v2/projects/${projectId}/feedback`),
    );
    expect(restored.status).toBe(200);
  });

  it("maps path parameters, query and body onto the existing handler", async () => {
    const { controller, seen } = await boot();
    await expect(controller.feedbackDashboard(projectId)).resolves.toEqual({
      echoed: `/api/v2/projects/${projectId}/feedback`,
    });
    await controller.feedbackCommit(recordId, { projectId });
    await controller.generationCostObservations(recordId, {
      projectId,
      limit: 5,
    });
    expect(seen).toEqual([
      {
        method: "GET",
        path: `/api/v2/projects/${projectId}/feedback`,
        search: "",
      },
      {
        method: "POST",
        path: `/api/v2/feedback/${recordId}/commit`,
        search: "",
        body: { projectId },
      },
      {
        method: "GET",
        path: `/api/v2/generation-ledger/${recordId}/cost-observations`,
        search: `?projectId=${projectId}&limit=5`,
      },
    ]);
  });

  it("takes the original If-Match and Idempotency-Key on every write", async () => {
    for (const route of insightsLegacyRoutes.routes)
      expect(
        route.args
          .filter(
            (arg) => arg.from === "ifMatch" || arg.from === "idempotencyKey",
          )
          .map((arg) => arg.from),
      ).toEqual(route.method === "GET" ? [] : ["ifMatch", "idempotencyKey"]);
    const { controller, seen } = await boot();
    await controller.feedbackCommit(
      recordId,
      { projectId },
      '"v1"',
      "30000000-0000-4000-8000-000000000009",
    );
    expect(seen).toMatchObject([
      {
        path: `/api/v2/feedback/${recordId}/commit`,
        ifMatch: '"v1"',
        idempotencyKey: "30000000-0000-4000-8000-000000000009",
      },
    ]);
  });

  it("answers a handler's problem as the compat/problem RemoteError", async () => {
    const { controller } = await boot();
    const failure = await controller
      .generationUpdate(recordId, { actualCost: 1 })
      .then(
        () => undefined,
        (error: unknown) => remoteErrorOf(error),
      );
    expect(failure).toMatchObject({
      code: "compat/problem",
      message: "Generation record not found",
      details: {
        status: 404,
        code: "NOT_FOUND",
        errors: { id: ["unknown record"] },
      },
    });
  });

  it("answers a non-JSON body as a named file", async () => {
    const { controller } = await boot();
    await expect(controller.outcomeSummary(projectId)).resolves.toEqual({
      contentType: "text/csv; charset=utf-8",
      fileName: "outcomes.csv",
      text: "a,b\n1,2\n",
    });
  });

  it("reports an operation whose plugin is not loaded as unavailable", async () => {
    const { controller } = await boot();
    const failure = await controller.continuationSummary().then(
      () => undefined,
      (error: unknown) => remoteErrorOf(error),
    );
    expect(failure).toMatchObject({
      code: "compat/problem",
      details: { status: 503, code: "CAPABILITY_UNAVAILABLE" },
    });
  });
});
