import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { automationPlugin } from "@dramaip/automation";
import { workspacePlugin } from "@dramaip/workspace";
import {
  AUTOMATION_PREVIEW_SERVICE,
  AUTOMATION_TASK_SERVICE,
  PROVIDER_ACTION_EXECUTOR_SERVICE,
  type AutomationPreviewService,
  type AutomationTaskService,
  type ProviderActionPreview,
  type Task,
} from "@dramaip/contracts/automation";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import type { RouteContribution } from "@dramaip/plugin-api/internal";
import { mountTestPlugin } from "./plugin-test-fixture.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProject = "10000000-0000-4000-8000-000000000002";
const providerId = "40000000-0000-4000-8000-000000000001";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database.sqlite, [
    ...(foundationPlugin.migrations ?? []),
    ...(workspacePlugin.migrations ?? []),
    ...(automationPlugin.migrations ?? []),
  ]);
  const now = new Date().toISOString();
  for (const id of [projectId, otherProject])
    database.sqlite
      .prepare(
        "INSERT INTO projects(id, title, short_drama_type, created_at, updated_at) VALUES (?, 'Controlled fixture', 'local', ?, ?)",
      )
      .run(id, now, now);
  const routes: RouteContribution[] = [];
  let executorCalls = 0;
  let projectExists = true;
  const context: Context = await mountTestPlugin(
    automationPlugin,
    {
      uow: database.uow,
      http: {
        routeIds: [],
        register: (route) => {
          routes.push(route);
          return () => undefined;
        },
      },
    },
    {
      [WORKSPACE_PROJECT_SERVICE.id]: {
        get: (id: string) =>
          projectExists
            ? database.sqlite
                .prepare("SELECT id FROM projects WHERE id = ?")
                .get(id)
            : undefined,
      },
      [PROVIDER_ACTION_EXECUTOR_SERVICE.id]: {
        execute: () => {
          executorCalls++;
          return { taskId: crypto.randomUUID() };
        },
      },
    },
  );
  cleanups.push(async () => {
    await context.fiber.dispose();
    database.close();
  });
  const app = new OpenAPIHono();
  for (const route of routes) {
    const register = app.openapi as unknown as (
      declaration: unknown,
      handler: (...args: never[]) => unknown,
    ) => void;
    register.call(app, route.declaration, route.handler);
  }
  const previews = context.get(
    AUTOMATION_PREVIEW_SERVICE.id,
  ) as AutomationPreviewService;
  const tasks = context.get(
    AUTOMATION_TASK_SERVICE.id,
  ) as AutomationTaskService;
  const create = (
    patch: Partial<
      Parameters<AutomationPreviewService["createProviderAction"]>[0]
    > = {},
  ) =>
    previews.createProviderAction({
      projectId,
      providerId,
      kind: "image",
      parameters: {
        prompt: "controlled local fixture, never sent to a provider",
      },
      estimatedCost: 0,
      currency: "CNY",
      ...patch,
    });
  const action = (id: string, mode = "execute") =>
    app.request(`/api/v2/provider-action-previews/${id}/${mode}`, {
      method: "POST",
      headers: { "Idempotency-Key": "controlled-test-key" },
    });
  const list = async () =>
    (await (await app.request("/api/v2/tasks")).json()) as Task[];
  const writes = () =>
    database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM domain_events")
      .get() as { count: number };
  return {
    database,
    app,
    create,
    previews,
    tasks,
    action,
    list,
    writes,
    calls: () => executorCalls,
    removeProject: () => {
      projectExists = false;
    },
  };
}

describe("actual provider execution gates and project-owned task projection", () => {
  it("lists exact project-owned body-free fee previews through every page, including taskless previews and real zero", async () => {
    const f = await fixture();
    const zero = f.create({
      parameters: {
        prompt: "PRIVATE FEE PROMPT",
        privateNote: "PRIVATE AUTHOR NOTE",
      },
    });
    const unknown = f.create({ estimatedCost: undefined, currency: undefined });
    const historical = f.create();
    await f.action(historical.id, "discard");
    const foreign = f.create({ projectId: otherProject });
    const before = f.writes();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await f.app.request(
        `/api/v2/projects/${projectId}/provider-action-preview-summaries?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const secret of [
        "parameters",
        "PRIVATE FEE PROMPT",
        "PRIVATE AUTHOR NOTE",
        foreign.id,
      ])
        expect(text).not.toContain(secret);
      const page = JSON.parse(text);
      expect(page.projectId).toBe(projectId);
      expect(page.items).toHaveLength(1);
      if (page.items[0].id === zero.id)
        expect(page.items[0]).toMatchObject({
          estimatedCost: 0,
          currency: "CNY",
          status: "pending",
        });
      if (page.items[0].id === unknown.id) {
        expect(page.items[0].estimatedCost).toBeUndefined();
        expect(page.items[0].currency).toBeUndefined();
      }
      ids.push(page.items[0].id);
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.sort()).toEqual([zero.id, unknown.id, historical.id].sort());
    expect(new Set(ids).size).toBe(3);
    expect(f.calls()).toBe(0);
    expect(await f.list()).toEqual([]);
    expect(f.writes()).toEqual(before);
    expect(
      (
        await f.app.request(
          `/api/v2/projects/${projectId}/provider-action-preview-summaries?cursor=${foreign.id}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request(
          `/api/v2/projects/${projectId}/provider-action-preview-summaries?limit=101`,
        )
      ).status,
    ).toBe(400);
    f.removeProject();
    expect(
      (
        await f.app.request(
          `/api/v2/projects/${projectId}/provider-action-preview-summaries`,
        )
      ).status,
    ).toBe(404);
    expect(f.writes()).toEqual(before);
    expect(f.calls()).toBe(0);
  });
  it("fails closed on corrupt owner fee metadata without leaking parameters or returning empty success", async () => {
    const f = await fixture();
    const value = f.create({
      parameters: { prompt: "PRIVATE CORRUPT PROMPT" },
    });
    f.database.sqlite
      .prepare(
        "UPDATE automation_provider_action_previews SET kind = 'corrupt' WHERE id = ?",
      )
      .run(value.id);
    const before = f.writes();
    const response = await f.app.request(
      `/api/v2/projects/${projectId}/provider-action-preview-summaries`,
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("PRIVATE CORRUPT PROMPT");
    expect(JSON.parse(text)).toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(f.writes()).toEqual(before);
    expect(f.calls()).toBe(0);
  });
  it.each([-1, Infinity])(
    "rolls back invalid creation amount %s without any execution",
    async (amount) => {
      const f = await fixture();
      const before = f.writes();
      expect(() => f.create({ estimatedCost: amount })).toThrow();
      expect(f.writes()).toEqual(before);
      expect(f.calls()).toBe(0);
      expect(
        f.database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM automation_provider_action_previews",
          )
          .get(),
      ).toMatchObject({ count: 0 });
    },
  );
  it.each([
    { estimatedCost: undefined },
    { currency: undefined },
    { currency: "" },
    { currency: "  " },
    { estimatedCost: Number.NaN },
  ])(
    "rejects unknown or invalid financial record before executor: %j",
    async (patch) => {
      const f = await fixture();
      const value = f.create(patch);
      const eventsBefore = f.writes();
      const response = await f.action(value.id);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "COST_UNKNOWN",
        status: 409,
      });
      expect(f.calls()).toBe(0);
      expect(await f.list()).toHaveLength(0);
      expect(f.writes()).toEqual(eventsBefore);
      const actual = (await (
        await f.app.request(`/api/v2/provider-action-previews/${value.id}`)
      ).json()) as ProviderActionPreview;
      expect(actual.status).toBe("pending");
    },
  );
  it("checks actual project before executor even when the estimate is known", async () => {
    const f = await fixture();
    const value = f.create();
    f.removeProject();
    const before = f.writes();
    const response = await f.action(value.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PROJECT_UNVERIFIED" });
    expect(f.calls()).toBe(0);
    expect(f.writes()).toEqual(before);
  });
  it("allows an explicit zero estimate with a currency, creates one task and keeps original pointer valid", async () => {
    const f = await fixture();
    const original = f.tasks.complete({
      kind: "controlled-suggestion",
      title: "Original suggestion",
      projectId,
    });
    const value = f.create({ taskId: original.id });
    f.tasks.update(original.id, { result: { providerActionPreview: value } });
    expect(
      (await f.list()).find((item) => item.id === original.id)?.resultStatus,
    ).toBe("pending");
    const response = await f.action(value.id);
    expect(response.status).toBe(202);
    const accepted = (await response.json()) as Task;
    expect(f.calls()).toBe(1);
    expect(accepted.projectId).toBe(projectId);
    const actual = (await (
      await f.app.request(`/api/v2/provider-action-previews/${value.id}`)
    ).json()) as ProviderActionPreview;
    expect(actual.status).toBe("executed");
    expect(actual.taskId).toBe(accepted.id);
    expect(actual.taskId).not.toBe(original.id);
    const originalAfter = (await f.list()).find(
      (item) => item.id === original.id,
    )!;
    expect(originalAfter.resultStatus).toBe("applied");
    // The list result remains a historical snapshot; the App must read the
    // authoritative preview. Only the separately projected resultStatus is current.
    expect(originalAfter.result).toMatchObject({
      providerActionPreview: { status: "pending" },
    });
    const attention = await f.app.request(
      `/api/v2/tasks/${original.id}/attention`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged" }),
      },
    );
    expect(attention.status).toBe(200);
    expect(await attention.json()).toMatchObject({
      resultStatus: "applied",
      result: { providerActionPreview: { status: "executed" } },
    });
    expect((await f.action(value.id)).status).toBe(409);
    expect(f.calls()).toBe(1);
    expect(await f.list()).toHaveLength(2);
  });
  it("can discard an unknown estimate without executing or claiming a bill", async () => {
    const f = await fixture();
    const value = f.create({ currency: undefined, estimatedCost: undefined });
    const response = await f.action(value.id, "discard");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "discarded" });
    expect(f.calls()).toBe(0);
    expect((await f.action(value.id)).status).toBe(409);
    expect(await f.list()).toHaveLength(0);
  });
  it.each(["providerActionPreviewId", "providerActionPreview", "taskId"])(
    "does not project a foreign provider into task status through %s",
    async (binding) => {
      const f = await fixture();
      const original = f.tasks.complete({
        kind: "controlled-suggestion",
        title: "Original",
        projectId,
      });
      const foreign = f.create({
        projectId: otherProject,
        ...(binding === "taskId" ? { taskId: original.id } : {}),
      });
      if (binding !== "taskId")
        f.tasks.update(original.id, {
          result:
            binding === "providerActionPreviewId"
              ? { providerActionPreviewId: foreign.id }
              : { providerActionPreview: foreign },
        });
      expect(
        (await f.list()).find((item) => item.id === original.id)?.resultStatus,
      ).toBe("none");
      const response = await f.app.request(
        `/api/v2/tasks/${original.id}/attention`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "acknowledged" }),
        },
      );
      expect(await response.json()).toMatchObject({ resultStatus: "none" });
      const worklist = (await (
        await f.app.request(
          `/api/v2/task-worklist?category=pending-result&projectId=${projectId}`,
        )
      ).json()) as { items: Task[] };
      expect(worklist.items).toHaveLength(0);
    },
  );
  it("does not project a foreign change preview through an otherwise matching taskId", async () => {
    const f = await fixture();
    const original = f.tasks.complete({
      kind: "controlled-suggestion",
      title: "Original",
      projectId,
    });
    const foreign = f.previews.createChange({
      projectId: otherProject,
      taskId: original.id,
      rationale: "test only",
      targets: [
        {
          kind: "chapter",
          id: crypto.randomUUID(),
          baseVersion: 1,
          patch: { content: "foreign" },
        },
      ],
    });
    f.tasks.update(original.id, { result: { changePreview: foreign } });
    expect(
      (await f.list()).find((item) => item.id === original.id)?.resultStatus,
    ).toBe("none");
    const response = await f.app.request(
      `/api/v2/tasks/${original.id}/attention`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged" }),
      },
    );
    expect(await response.json()).toMatchObject({ resultStatus: "none" });
  });
});
