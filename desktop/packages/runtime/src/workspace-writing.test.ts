import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { PersistentEventRuntime } from "@dramaip/events";
import { createRuntimeHttp } from "@dramaip/http";
import { bootKernel, type RunningKernel } from "@dramaip/kernel";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import { automationPlugin } from "@dramaip/automation";
import { creativeQualityPlugin } from "@dramaip/creative-quality";
import { deliveryPlugin } from "@dramaip/delivery";
import { foundationPlugin } from "@dramaip/foundation";
import { knowledgePlugin } from "@dramaip/knowledge";
import { mediaPlugin } from "@dramaip/media";
import { productionPlugin } from "@dramaip/production";
import { reviewPlugin } from "@dramaip/review";
import { createSystemPlugin } from "@dramaip/system";
import { timelinePlugin } from "@dramaip/timeline";
import { workspacePlugin } from "@dramaip/workspace";
import { writingPlugin } from "@dramaip/writing";

interface Fixture {
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function fixture(): Promise<Fixture> {
  const database = openDatabase(":memory:");
  const plugins: readonly FirstPartyPlugin[] = [
    foundationPlugin,
    createSystemPlugin(),
    workspacePlugin,
    automationPlugin,
    writingPlugin,
    knowledgePlugin,
    creativeQualityPlugin,
    productionPlugin,
    mediaPlugin,
    timelinePlugin,
    reviewPlugin,
    deliveryPlugin,
  ];
  const profile: PluginProfile = {
    name: "test",
    bundles: ["core", "automation-suite", "writing-suite"],
    plugins: plugins.map((plugin) => ({ id: plugin.descriptor.id })),
  };
  applyMigrations(
    database.sqlite,
    plugins.flatMap((plugin) => [...(plugin.migrations ?? [])]),
  );
  const events = new PersistentEventRuntime(database.uow);
  const http = createRuntimeHttp({
    accessToken: "workspace-writing-test-token",
    allowedOrigins: [],
    events,
    version: "3.0.0-alpha.3",
    runtimeInfo: () => ({
      runtimeId: "f47fa85e-0191-42fd-b89b-134cfbabbb09",
      runtimeGeneration: 1,
      graphRevision: "a".repeat(64),
      startedAt: "2026-08-23T00:00:00.000Z",
      runtimeVersion: "3.0.0-alpha.3",
      apiVersion: "2",
      pluginApiVersion: "1",
      runtimeKind: "bun",
      mode: "headless",
      profile: "test",
      bundles: [...profile.bundles],
      plugins: [],
      capabilities: {},
      engineStatus: {},
      uiContributions: [],
    }),
    onDiagnostics: () => ({}),
  });
  let kernel: RunningKernel | undefined;
  try {
    kernel = await bootKernel({
      graphRevision: "test-graph",
      profile,
      plugins: new Map(
        plugins.map((plugin) => [plugin.descriptor.id, plugin] as const),
      ),
      context: { http: http.registry, events, uow: database.uow },
    });
    http.registry.publish();
  } catch (error) {
    database.close();
    throw error;
  }
  const result: Fixture = {
    request: (path, init) =>
      http.fetch(
        new Request(`http://runtime.test${path}`, {
          ...init,
          headers: {
            Authorization: "Bearer workspace-writing-test-token",
            "Content-Type": "application/json",
            ...init?.headers,
          },
        }),
      ),
    close: async () => {
      await kernel!.dispose();
      database.close();
    },
  };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.close();
});

describe("workspace and writing vertical slice", () => {
  it("creates all four project modes with replay-safe initialization and immutable modes", async () => {
    const runtime = await fixture();
    const modes = [
      {
        mode: "series_longform",
        modeConfig: {
          mode: "series_longform",
          targetChapterCount: 300,
          targetSeasonCount: 5,
        },
      },
      {
        mode: "single_season",
        modeConfig: {
          mode: "single_season",
          entryPath: "script",
          targetEpisodeCount: 80,
        },
      },
      {
        mode: "personal_theater",
        modeConfig: {
          mode: "personal_theater",
          storyMethod: "template",
          episodeCount: 1,
          episodeDurationMinutes: 5,
        },
      },
      {
        mode: "creator_channel",
        modeConfig: {
          mode: "creator_channel",
          topic: "财经",
          riskDomain: "finance",
        },
      },
    ] as const;
    for (const item of modes) {
      const key = crypto.randomUUID();
      const response = await runtime.request("/api/v2/projects", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ title: `${item.mode} 项目`, ...item }),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const created = (await response.json()) as {
        project: { id: string; mode: string; version: number };
        initialization: { steps: unknown[] };
      };
      expect(created.project.mode).toBe(item.mode);
      expect(created.initialization.steps.length).toBeGreaterThan(1);
      const replay = await runtime.request("/api/v2/projects", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ title: `${item.mode} 项目`, ...item }),
      });
      expect(replay.status, await replay.clone().text()).toBe(201);
      await expect(replay.json()).resolves.toMatchObject({
        project: { id: created.project.id },
      });
      const immutable = await runtime.request(
        `/api/v2/projects/${created.project.id}`,
        {
          method: "PATCH",
          headers: { "If-Match": `"${created.project.version}"` },
          body: JSON.stringify({
            version: created.project.version,
            mode: "creator_channel",
          }),
        },
      );
      expect(immutable.status).toBe(409);
    }
  });

  it("supports owned CRUD for migrated writing, knowledge, quality and automation resources", async () => {
    const runtime = await fixture();
    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: "领域资料测试", shortDramaType: "悬疑" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };

    for (const domain of [
      "characters",
      "story",
      "beats",
      "project-skills",
      "templates",
    ]) {
      const createdResponse = await runtime.request(`/api/v2/${domain}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.project.id,
          title: `${domain} 初稿`,
          payload: { 内容: "第一版" },
        }),
      });
      expect(
        createdResponse.status,
        `${domain}: ${await createdResponse.clone().text()}`,
      ).toBe(201);
      const created = (await createdResponse.json()) as {
        id: string;
        version: number;
      };
      const updatedResponse = await runtime.request(
        `/api/v2/${domain}/${created.id}`,
        {
          method: "PATCH",
          headers: { "If-Match": `"${created.version}"` },
          body: JSON.stringify({
            version: created.version,
            title: `${domain} 定稿`,
            payload: { 内容: "第二版" },
          }),
        },
      );
      expect(updatedResponse.status).toBe(200);
      await expect(updatedResponse.json()).resolves.toMatchObject({
        title: `${domain} 定稿`,
        version: 1,
      });
      const listedResponse = await runtime.request(
        `/api/v2/${domain}?projectId=${project.project.id}`,
      );
      expect(listedResponse.status).toBe(200);
      await expect(listedResponse.json()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: created.id })]),
      );
      const removedResponse = await runtime.request(
        `/api/v2/${domain}/${created.id}`,
        { method: "DELETE" },
      );
      expect(removedResponse.status).toBe(204);
    }
  });

  it("creates the demo project through workspace, writing, production and media owners", async () => {
    const runtime = await fixture();
    const response = await runtime.request("/api/v2/demo/projects", {
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const project = (await response.json()) as { id: string };
    const [chapters, shots, stills, center, graph] = await Promise.all([
      runtime.request(`/api/v2/projects/${project.id}/chapters`),
      runtime.request(`/api/v2/shots?projectId=${project.id}`),
      runtime.request(`/api/v2/shot-stills?projectId=${project.id}`),
      runtime.request(`/api/v2/projects/${project.id}/asset-center`),
      runtime.request(`/api/v2/projects/${project.id}/production-graph`),
    ]);
    expect(chapters.status).toBe(200);
    expect(shots.status).toBe(200);
    expect(stills.status).toBe(200);
    expect(center.status).toBe(200);
    expect(graph.status).toBe(200);
    await expect(chapters.json()).resolves.toHaveLength(3);
    await expect(shots.json()).resolves.toHaveLength(2);
    await expect(stills.json()).resolves.toHaveLength(1);
    const assetCenter = (await center.json()) as {
      projectId: string;
      assets: Array<{ title: string }>;
    };
    expect(assetCenter.projectId).toBe(project.id);
    expect(assetCenter.assets.map((asset) => asset.title)).toContain(
      "林晚·雨夜服装设定",
    );
    await expect(graph.json()).resolves.toMatchObject({
      coverage: { assets: 2, stills: 1, adoptedStills: 1 },
    });
    for (const domain of [
      "characters",
      "character-states",
      "story-bible",
      "outlines",
      "story-events",
      "foreshadowings",
      "visual-assets",
      "visual-settings",
      "assets",
      "chapter-memories",
      "story-bible-sidecar-preferences",
    ]) {
      const response = await runtime.request(
        `/api/v2/${domain}?projectId=${project.id}`,
      );
      expect(
        response.status,
        `${domain}: ${await response.clone().text()}`,
      ).toBe(200);
    }
  });

  it("persists projects, chapters, versions and events with optimistic locking", async () => {
    const runtime = await fixture();
    const createdProject = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: "迁移测试", shortDramaType: "悬疑" }),
    });
    expect(createdProject.status).toBe(201);
    const project = (await createdProject.json()) as {
      project: { id: string; version: number };
    };

    const createdChapter = await runtime.request("/api/v2/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.id,
        title: "第一章",
        content: "旧正文",
      }),
    });
    expect(createdChapter.status).toBe(201);
    const chapter = (await createdChapter.json()) as {
      id: string;
      version: number;
    };
    const updated = await runtime.request(`/api/v2/chapters/${chapter.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: chapter.version, content: "新正文" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      content: "新正文",
      version: 1,
    });
    const stale = await runtime.request(`/api/v2/chapters/${chapter.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: chapter.version, content: "陈旧覆盖" }),
    });
    expect(stale.status).toBe(409);

    const previewResponse = await runtime.request("/api/v2/revisions", {
      method: "POST",
      headers: { "Idempotency-Key": "revision-create-1" },
      body: JSON.stringify({
        chapterId: chapter.id,
        proposedContent: "确认后的正文",
        rationale: "纵向迁移测试",
      }),
    });
    expect(previewResponse.status).toBe(201);
    const preview = (await previewResponse.json()) as {
      id: string;
      baseVersion: number;
    };
    const replay = await runtime.request("/api/v2/revisions", {
      method: "POST",
      headers: { "Idempotency-Key": "revision-create-1" },
      body: JSON.stringify({
        chapterId: chapter.id,
        proposedContent: "确认后的正文",
        rationale: "纵向迁移测试",
      }),
    });
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ id: preview.id });
    const committed = await runtime.request(
      `/api/v2/revisions/${preview.id}/commit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "revision-commit-1" },
        body: JSON.stringify({ version: preview.baseVersion }),
      },
    );
    expect(committed.status).toBe(200);
    const queuedStoryBible = await runtime.request(
      "/api/v2/story-bible/change-sets",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.project.id,
          chapterId: chapter.id,
        }),
      },
    );
    expect(queuedStoryBible.status).toBe(201);
    const changeSet = (await queuedStoryBible.json()) as { id: string };
    const appliedStoryBible = await runtime.request(
      `/api/v2/story-bible/change-sets/${changeSet.id}/apply`,
      { method: "POST", body: JSON.stringify({ fields: ["章节摘要"] }) },
    );
    expect(appliedStoryBible.status).toBe(200);
    await expect(appliedStoryBible.json()).resolves.toMatchObject({
      id: changeSet.id,
      status: "applied",
    });

    const workspace = await runtime.request(
      `/api/v2/projects/${project.project.id}/novel-workspace`,
    );
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      project: { id: project.project.id },
      chapters: [{ id: chapter.id, content: "确认后的正文" }],
      statuses: [{ chapterId: chapter.id, words: 6 }],
    });

    const events = await runtime.request("/api/v2/events?cursor=0");
    expect(events.status).toBe(200);
    await events.body?.cancel();
  });

  it("persists a pilot plan and creates production episodes after source confirmation", async () => {
    const runtime = await fixture();
    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: "试制测试", shortDramaType: "悬疑" }),
    });
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };
    const chapterResponse = await runtime.request("/api/v2/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.id,
        title: "第一章",
        content: "雨夜来信",
      }),
    });
    const chapter = (await chapterResponse.json()) as { id: string };
    const created = await runtime.request("/api/v2/pilot-plans", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.id,
        chapterIds: [chapter.id],
        episodeCount: 1,
      }),
    });
    expect(created.status, await created.text()).toBe(201);
    const plan = (await runtime
      .request(`/api/v2/projects/${project.project.id}/pilot-plans`)
      .then((response) => response.json())) as Array<{ id: string }>;
    expect(plan).toHaveLength(1);
    const confirmed = await runtime.request(
      `/api/v2/pilot-plans/${plan[0]!.id}/action`,
      {
        method: "POST",
        body: JSON.stringify({ action: "confirm-source" }),
      },
    );
    expect(confirmed.status, await confirmed.text()).toBe(200);
  });
});
