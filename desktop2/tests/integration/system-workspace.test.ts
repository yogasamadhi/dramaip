import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFoundationModule } from "@dramaip/foundation";
import { bootServerKernel } from "@dramaip/kernel";
import type { DramaPluginExports, PluginProfile } from "@dramaip/plugin-api";
import { createSystemModule } from "@dramaip/system";
import { workspaceModule } from "@dramaip/workspace";

test("system + workspace vertical slice boots through Cordis Loader and serves /api/v2", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-next-integration-"));
  const username = "launch";
  const password = "integration-secret";
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const profile: PluginProfile = {
    name: "test",
    plugins: [{ id: "foundation" }, { id: "system" }, { id: "workspace" }],
  };
  const systemModule = createSystemModule({
    backupDirectory: join(directory, "backups"),
    profileName: profile.name,
    pluginIds: profile.plugins.map((entry) => entry.id),
  });
  const migrations = [
    ...(systemModule.migrations ?? []),
    ...(workspaceModule.migrations ?? []),
  ];
  const foundationModule = createFoundationModule({
    databaseFile: join(directory, "dramaip.db"),
    migrations,
    http: { username, password, allowedOrigins: ["dramaip://app"] },
  });
  const builtins = new Map<string, DramaPluginExports<unknown>>([
    ["foundation", foundationModule],
    ["system", systemModule],
    ["workspace", workspaceModule],
  ]);

  const kernel = await bootServerKernel({ profile, builtins });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", authorization);
    headers.set("origin", "dramaip://app");
    if (init.body) headers.set("content-type", "application/json");
    return kernel.context.http.fetch(
      new Request(`http://127.0.0.1${path}`, { ...init, headers }),
    );
  };

  try {
    const health = await request("/api/v2/system/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).apiVersion, "2");

    const createdResponse = await request("/api/v2/workspace/projects", {
      method: "POST",
      body: JSON.stringify({ name: "星河计划", description: "垂直切片验收" }),
    });
    assert.equal(createdResponse.status, 201);
    assert.equal(createdResponse.headers.get("etag"), '"v1"');
    const created = (await createdResponse.json()) as {
      id: string;
      name: string;
      version: number;
    };

    const missingPrecondition = await request(
      `/api/v2/workspace/projects/${created.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "不会写入" }),
      },
    );
    assert.equal(missingPrecondition.status, 428);

    const updatedResponse = await request(
      `/api/v2/workspace/projects/${created.id}`,
      {
        method: "PATCH",
        headers: { "if-match": '"v1"' },
        body: JSON.stringify({ name: "星河计划·第二版" }),
      },
    );
    assert.equal(updatedResponse.status, 200);
    assert.equal(updatedResponse.headers.get("etag"), '"v2"');

    const trashResponse = await request(
      `/api/v2/workspace/projects/${created.id}`,
      { method: "DELETE", headers: { "if-match": '"v2"' } },
    );
    assert.equal(trashResponse.status, 204);
    const hiddenProjects = (await (
      await request("/api/v2/workspace/projects")
    ).json()) as { items: Array<{ id: string }> };
    assert.equal(
      hiddenProjects.items.some((project) => project.id === created.id),
      false,
    );
    const restoreResponse = await request(
      `/api/v2/workspace/projects/${created.id}/actions/restore`,
      {
        method: "POST",
        headers: {
          "if-match": '"v3"',
          "idempotency-key": "restore-project-one",
        },
      },
    );
    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreResponse.headers.get("etag"), '"v4"');

    await kernel.context.eventRuntime.drain();
    const searchResponse = await request(
      "/api/v2/system/search?q=%E6%98%9F%E6%B2%B3",
    );
    assert.equal(searchResponse.status, 200);
    const search = (await searchResponse.json()) as {
      items: Array<{ aggregateId: string }>;
    };
    assert.equal(search.items[0]?.aggregateId, created.id);

    const document = kernel.context.http.openapiDocument();
    const paths = document.paths as Record<string, unknown>;
    assert.ok(paths["/api/v2/system/health"]);
    assert.ok(paths["/api/v2/workspace/projects/{id}"]);
    assert.equal(
      Object.keys(paths).some((path) => path.startsWith("/api/v1")),
      false,
    );
  } finally {
    await kernel.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
