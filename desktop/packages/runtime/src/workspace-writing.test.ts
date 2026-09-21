import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { PersistentEventRuntime } from "@dramaip/events";
import { createRuntimeHttp } from "@dramaip/http";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { bootKernel, type RunningKernel } from "@dramaip/kernel";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import { automationPlugin } from "@dramaip/automation";
import { createAgentsPlugin } from "@dramaip/agents";
import { creativeQualityPlugin } from "@dramaip/creative-quality";
import { deliveryPlugin } from "@dramaip/delivery";
import { foundationPlugin } from "@dramaip/foundation";
import { knowledgePlugin } from "@dramaip/knowledge";
import { mediaPlugin } from "@dramaip/media";
import { createProductionPlugin } from "@dramaip/production";
import { reviewPlugin } from "@dramaip/review";
import { createSystemPlugin } from "@dramaip/system";
import { timelinePlugin } from "@dramaip/timeline";
import { createWorkspacePlugin } from "@dramaip/workspace";
import { writingPlugin } from "@dramaip/writing";

interface Fixture {
  request(path: string, init?: RequestInit): Promise<Response>;
  expireSourceImport(id: string): void;
  seedTask(input: {
    status: "succeeded" | "failed" | "canceled";
    projectId?: string;
    attentionStatus?: "open" | "acknowledged";
  }): string;
  seedChangePreview(input: {
    projectId: string;
    chapterId: string;
    baseVersion: number;
    proposedContent: string;
  }): string;
  close(): Promise<void>;
}

const fixtures: Fixture[] = [];
const temporaryDirectories: string[] = [];

async function fixture(
  host?: DesktopHostClient,
  engineHost?: DesktopHostClient,
  databasePath = ":memory:",
): Promise<Fixture> {
  const database = openDatabase(databasePath);
  let closed = false;
  const plugins: readonly FirstPartyPlugin[] = [
    foundationPlugin,
    createSystemPlugin(),
    createWorkspacePlugin(host),
    automationPlugin,
    writingPlugin,
    knowledgePlugin,
    createAgentsPlugin(engineHost),
    creativeQualityPlugin,
    createProductionPlugin(host),
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
      runtimeKind: "node",
      mode: "headless",
      profile: "test",
      bundles: [...profile.bundles],
      plugins: [],
      capabilities: {},
      capabilityDescriptors: {},
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
      context: { http: http.registry, domainEvents: events, uow: database.uow },
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
    expireSourceImport: (id) =>
      database.uow.execute((transaction) => {
        transaction.run(
          "UPDATE workspace_source_imports SET expires_at = ? WHERE id = ?",
          "2000-01-01T00:00:00.000Z",
          id,
        );
      }),
    seedTask: (input) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      database.uow.execute((transaction) =>
        transaction.run(
          `INSERT INTO automation_tasks(
            id, kind, status, title, progress, project_id, parent_task_id,
            payload_json, result_json, error, created_at, updated_at,
            attention_status
          ) VALUES (?, 'test-task', ?, '测试任务', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
          id,
          input.status,
          input.status === "succeeded" ? 1 : 0,
          input.projectId ?? null,
          input.status === "failed" ? "可恢复的测试失败" : null,
          now,
          now,
          input.attentionStatus ?? "open",
        ),
      );
      return id;
    },
    seedChangePreview: (input) => {
      const id = crypto.randomUUID();
      database.uow.execute((transaction) =>
        transaction.run(
          `INSERT INTO automation_change_previews(
            id, project_id, session_id, run_id, task_id, engine_kind,
            task_type, targets_json, rationale, status, content_hash,
            created_at, committed_at
          ) VALUES (?, ?, NULL, NULL, NULL, 'pi', 'revise_chapter', ?,
            '测试并发合并', 'pending', 'test-hash', ?, NULL)`,
          id,
          input.projectId,
          JSON.stringify([
            {
              kind: "chapter",
              id: input.chapterId,
              baseVersion: input.baseVersion,
              patch: { content: input.proposedContent },
            },
          ]),
          new Date().toISOString(),
        ),
      );
      return id;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await kernel!.dispose();
      database.close();
    },
  };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.close();
  while (temporaryDirectories.length)
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("workspace and writing vertical slice", () => {
  it("previews, overrides and freezes an immutable AI context manifest", async () => {
    const runtime = await fixture();
    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        title: "上下文清单项目",
        mode: "single_season",
        modeConfig: {
          mode: "single_season",
          entryPath: "novel",
          targetEpisodeCount: 3,
        },
        synopsis: "一个测试用的短剧故事。",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };
    const chapterResponse = await runtime.request("/api/v2/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.id,
        title: "第一章",
        content: "主角发现了被隐藏的证据。",
      }),
    });
    expect(chapterResponse.status).toBe(201);
    const chapter = (await chapterResponse.json()) as { id: string };

    const policies = await runtime.request(
      `/api/v2/projects/${project.project.id}/agent-context-policies`,
      {
        method: "PUT",
        headers: { "If-Match": '"0"' },
        body: JSON.stringify({
          version: 0,
          policies: [{ fieldPath: "/project", mode: "never" }],
        }),
      },
    );
    expect(policies.status, await policies.clone().text()).toBe(200);

    const previewResponse = await runtime.request(
      "/api/v2/agent-context-previews",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.project.id,
          chapterId: chapter.id,
          runIntent: "续写本章",
          basePrompt: "请续写，并保持人物动机一致。",
          selection: { text: "隐藏的证据" },
          tokenBudget: 4_096,
          destination: { kind: "cloud", provider: "test-provider" },
        }),
      },
    );
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      201,
    );
    expect(previewResponse.headers.get("ETag")).toBe('"0"');
    const preview = (await previewResponse.json()) as {
      id: string;
      version: number;
      entries: Array<{
        fieldPath: string;
        mode: string;
        included: boolean;
      }>;
      manifestSha256: string;
    };
    expect(preview.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "/project",
          mode: "never",
          included: false,
        }),
        expect.objectContaining({
          fieldPath: `/chapters/${chapter.id}`,
          included: true,
        }),
      ]),
    );

    const override = await runtime.request(
      `/api/v2/agent-context-previews/${preview.id}`,
      {
        method: "PATCH",
        headers: { "If-Match": '"0"' },
        body: JSON.stringify({
          temporaryOverrides: [{ fieldPath: "/project", mode: "always" }],
        }),
      },
    );
    expect(override.status, await override.clone().text()).toBe(200);
    const overridden = (await override.json()) as {
      version: number;
      entries: Array<{
        fieldPath: string;
        mode: string;
        included: boolean;
      }>;
    };
    expect(overridden.entries).toContainEqual(
      expect.objectContaining({
        fieldPath: "/project",
        mode: "always",
        included: true,
      }),
    );

    const snapshotResponse = await runtime.request(
      `/api/v2/agent-context-previews/${preview.id}/snapshots`,
      { method: "POST", headers: { "If-Match": '"1"' }, body: "{}" },
    );
    expect(snapshotResponse.status, await snapshotResponse.clone().text()).toBe(
      201,
    );
    await expect(snapshotResponse.json()).resolves.toMatchObject({
      projectId: project.project.id,
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      finalPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      destination: { kind: "cloud", provider: "test-provider" },
    });
  });

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
    const progress = await runtime.request(
      `/api/v2/projects/${project.id}/progress`,
    );
    expect(progress.status, await progress.clone().text()).toBe(200);
    await expect(progress.json()).resolves.toMatchObject({
      projectId: project.id,
      steps: expect.arrayContaining([
        expect.objectContaining({
          id: "assets",
          current: 1,
          required: 2,
          complete: false,
        }),
      ]),
      blockers: [expect.objectContaining({ code: expect.any(String) })],
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

  it("rebases a stale chapter candidate without overwriting the newer draft", async () => {
    const runtime = await fixture();
    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: "并发修订测试" }),
    });
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };
    const chapterResponse = await runtime.request("/api/v2/chapters", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.project.id,
        title: "第一章",
        content: "生成开始时的正文",
      }),
    });
    const chapter = (await chapterResponse.json()) as {
      id: string;
      version: number;
    };
    const previewId = runtime.seedChangePreview({
      projectId: project.project.id,
      chapterId: chapter.id,
      baseVersion: chapter.version,
      proposedContent: "AI 候选正文",
    });
    const newer = await runtime.request(`/api/v2/chapters/${chapter.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version: chapter.version,
        content: "用户在生成期间新增的正文",
      }),
    });
    expect(newer.status).toBe(200);
    const rebased = await runtime.request(
      `/api/v2/change-previews/${previewId}/rebase`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          baseVersion: 1,
          content: "用户在生成期间新增的正文\n\n经确认采用的候选段落",
        }),
      },
    );
    expect(rebased.status, await rebased.clone().text()).toBe(201);
    const candidate = (await rebased.json()) as {
      id: string;
      status: string;
      targets: Array<{ baseVersion: number; displayDiff?: unknown }>;
    };
    expect(candidate).toMatchObject({
      status: "pending",
      targets: [
        {
          baseVersion: 1,
          displayDiff: expect.objectContaining({ sourcePreviewId: previewId }),
        },
      ],
    });
    const original = await runtime.request(
      `/api/v2/change-previews/${previewId}`,
    );
    await expect(original.json()).resolves.toMatchObject({
      status: "conflicted",
    });
    const committed = await runtime.request(
      `/api/v2/change-previews/${candidate.id}/commit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      },
    );
    expect(committed.status, await committed.clone().text()).toBe(200);
    const saved = await runtime.request(
      `/api/v2/projects/${project.project.id}/chapters`,
    );
    await expect(saved.json()).resolves.toEqual([
      expect.objectContaining({
        id: chapter.id,
        content: "用户在生成期间新增的正文\n\n经确认采用的候选段落",
        version: 2,
      }),
    ]);
  });

  it("keeps execution state separate from persistent task attention", async () => {
    const runtime = await fixture();
    const failedId = runtime.seedTask({ status: "failed" });
    runtime.seedTask({ status: "canceled" });
    const attention = await runtime.request(
      "/api/v2/task-worklist?category=attention&limit=25",
    );
    expect(attention.status, await attention.clone().text()).toBe(200);
    await expect(attention.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: failedId,
          status: "failed",
          attentionStatus: "open",
        }),
      ],
      counts: { attention: 1, history: 1 },
    });
    const acknowledged = await runtime.request(
      `/api/v2/tasks/${failedId}/attention`,
      {
        method: "POST",
        body: JSON.stringify({ status: "acknowledged" }),
      },
    );
    expect(acknowledged.status).toBe(200);
    const after = await runtime.request(
      "/api/v2/task-worklist?category=attention&limit=25",
    );
    await expect(after.json()).resolves.toMatchObject({
      items: [],
      counts: { attention: 0, history: 2 },
    });
    const fakeRetry = await runtime.request(`/api/v2/tasks/${failedId}/retry`, {
      method: "POST",
      body: JSON.stringify({ engineKind: "pi" }),
    });
    expect(fakeRetry.status).toBe(409);
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

  it("previews outside a project, binds once and imports a novel after confirmation", async () => {
    const runtime = await fixture({
      readGrantedDocument: async () => ({
        name: "雨夜来信.md",
        format: "markdown",
        size: 45,
        content: "# 雨夜来信\n\n## 第一章\n\n一封没有署名的信。",
      }),
    } as unknown as DesktopHostClient);
    const before = await runtime.request("/api/v2/projects");
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toHaveLength(0);

    const previewResponse = await runtime.request(
      "/api/v2/source-imports/preview",
      {
        method: "POST",
        body: JSON.stringify({ capabilityToken: crypto.randomUUID() }),
      },
    );
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      201,
    );
    const result = (await previewResponse.json()) as {
      importId: string;
      preview: {
        sourceType: string;
        title: string;
        chapters: Array<{ title: string; content: string }>;
      };
    };
    expect(result.preview).toMatchObject({
      sourceType: "markdown",
      title: "雨夜来信",
      chapters: [{ title: "第一章" }],
    });
    const afterPreview = await runtime.request("/api/v2/projects");
    await expect(afterPreview.json()).resolves.toHaveLength(0);

    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        title: result.preview.title,
        mode: "single_season",
        modeConfig: {
          mode: "single_season",
          entryPath: "source-import",
          targetEpisodeCount: 80,
        },
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };
    const commitBody = {
      projectId: project.project.id,
      strategy: "append",
      rightsConfirmed: true,
      destructiveConfirmed: false,
      preview: result.preview,
    };
    const committed = await runtime.request(
      `/api/v2/source-imports/${result.importId}/commit`,
      { method: "POST", body: JSON.stringify(commitBody) },
    );
    expect(committed.status, await committed.clone().text()).toBe(201);
    await expect(committed.json()).resolves.toMatchObject({
      createdChapters: 1,
    });
    const chapters = await runtime.request(
      `/api/v2/projects/${project.project.id}/chapters`,
    );
    await expect(chapters.json()).resolves.toEqual([
      expect.objectContaining({ title: "第一章" }),
    ]);
    const duplicate = await runtime.request(
      `/api/v2/source-imports/${result.importId}/commit`,
      { method: "POST", body: JSON.stringify(commitBody) },
    );
    expect(duplicate.status).toBe(404);
  });

  it("previews, commits and exports a Fountain screenplay through Production", async () => {
    const runtime = await fixture({
      readGrantedDocument: async () => ({
        name: "试播集.fountain",
        format: "fountain",
        size: 104,
        content: [
          "INT. 旧车站 - 夜 #1#",
          "",
          "雨水沿着站牌落下。",
          "",
          "林晚",
          "(压低声音)",
          "信不是寄给我的。",
          "",
          "CUT TO:",
        ].join("\n"),
      }),
    } as unknown as DesktopHostClient);
    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Fountain 导入测试" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };

    const previewResponse = await runtime.request(
      "/api/v2/screenplay-import-previews",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.project.id,
          title: "试播集",
          grantId: crypto.randomUUID(),
        }),
      },
    );
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      201,
    );
    const preview = (await previewResponse.json()) as {
      previewId: string;
      etag: string;
      blocks: Array<{ type: string; text?: string }>;
    };
    expect(preview.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "scene_heading" }),
        expect.objectContaining({ type: "dialogue" }),
      ]),
    );

    const staleCommit = await runtime.request(
      `/api/v2/screenplay-import-previews/${preview.previewId}/commit`,
      {
        method: "POST",
        headers: { "If-Match": '"stale"' },
        body: JSON.stringify({ previewId: preview.previewId }),
      },
    );
    expect(staleCommit.status).toBe(409);
    const commitResponse = await runtime.request(
      `/api/v2/screenplay-import-previews/${preview.previewId}/commit`,
      {
        method: "POST",
        headers: { "If-Match": preview.etag },
        body: JSON.stringify({ previewId: preview.previewId }),
      },
    );
    expect(commitResponse.status, await commitResponse.clone().text()).toBe(
      201,
    );
    const document = (await commitResponse.json()) as {
      scriptId: string;
      sourceFormat: string;
      version: number;
      blocks: Array<Record<string, unknown>>;
    };
    expect(document.sourceFormat).toBe("fountain");

    const current = await runtime.request(
      `/api/v2/scripts/${document.scriptId}/screenplay`,
    );
    expect(current.headers.get("ETag")).toBe('"0"');
    const updated = await runtime.request(
      `/api/v2/scripts/${document.scriptId}/screenplay`,
      {
        method: "PATCH",
        headers: { "If-Match": '"0"' },
        body: JSON.stringify({
          version: document.version,
          blocks: [
            ...document.blocks,
            {
              id: crypto.randomUUID(),
              type: "action",
              text: "站台尽头亮起一盏灯。",
            },
          ],
        }),
      },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(updated.headers.get("ETag")).toBe('"1"');

    const exported = await runtime.request(
      `/api/v2/scripts/${document.scriptId}/screenplay/export/fdx`,
    );
    expect(exported.status, await exported.clone().text()).toBe(200);
    await expect(exported.json()).resolves.toMatchObject({
      fileName: "试播集.fdx",
      mimeType: "application/xml",
      content: expect.stringContaining("FinalDraft"),
    });
  });

  it("imports structured script JSON into production records", async () => {
    const runtime = await fixture({
      readGrantedDocument: async () => ({
        name: "首集.json",
        format: "script-json",
        size: 200,
        content: JSON.stringify({
          title: "雨夜来信",
          episodes: [
            {
              episodeNumber: 1,
              scenes: [
                {
                  location: "旧车站",
                  time: "夜",
                  characters: ["林晚"],
                  content: "林晚拆开信封。",
                },
              ],
            },
          ],
        }),
      }),
    } as unknown as DesktopHostClient);
    const previewResponse = await runtime.request(
      "/api/v2/source-imports/preview",
      {
        method: "POST",
        body: JSON.stringify({ capabilityToken: crypto.randomUUID() }),
      },
    );
    const result = (await previewResponse.json()) as {
      importId: string;
      preview: {
        title: string;
        sourceType: string;
        contentKind: string;
        episodes: unknown[];
      };
    };
    expect(previewResponse.status).toBe(201);
    expect(result.preview).toMatchObject({
      title: "雨夜来信",
      sourceType: "script-json",
      contentKind: "script",
    });

    const projectResponse = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ title: result.preview.title }),
    });
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };
    const committed = await runtime.request(
      `/api/v2/source-imports/${result.importId}/commit`,
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.project.id,
          strategy: "append",
          rightsConfirmed: true,
          destructiveConfirmed: false,
          preview: result.preview,
        }),
      },
    );
    expect(committed.status, await committed.clone().text()).toBe(201);
    await expect(committed.json()).resolves.toMatchObject({
      createdEpisodes: 1,
      createdScripts: 1,
      createdScenes: 1,
    });
    const graph = await runtime.request(
      `/api/v2/projects/${project.project.id}/production-graph`,
    );
    await expect(graph.json()).resolves.toMatchObject({
      coverage: { episodes: 1, scripts: 1, scenes: 1 },
      nodes: expect.arrayContaining([
        expect.objectContaining({ kind: "adaptations" }),
      ]),
    });
    const refreshedProject = await runtime.request(
      `/api/v2/projects/${project.project.id}`,
    );
    await expect(refreshedProject.json()).resolves.toMatchObject({
      currentAdaptationId: expect.any(String),
    });
  });

  it("previews and imports a schema v4 projectless brief with creative intelligence", async () => {
    const corpusId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const packageDocument = {
      format: "dramaip-project-package",
      schemaVersion: 4,
      exportedAt: "2026-08-27T00:00:00.000Z",
      project: {
        title: "海上梦城",
        mode: "single_season",
        modeConfig: {
          mode: "single_season",
          entryPath: "novel",
          targetEpisodeCount: 12,
        },
      },
      chapters: [],
      resources: [
        {
          id: crypto.randomUUID(),
          owner: "automation",
          kind: "inspirations",
          title: "城市回应梦境",
          payload: {
            类型: "premise",
            内容: "一座漂流城市会把居民的梦变成真实街区。",
          },
        },
      ],
      structure: {
        volumes: [],
        seasons: [],
        creatorContent: [],
        researchTopics: [],
      },
      creativeIntelligence: {
        corpusItems: [
          {
            id: corpusId,
            kind: "meme",
            title: "梦境具象化",
            trigger: "欲望被城市听见",
            mechanism: "把人物无法说出口的愿望转换为空间笑点和剧情障碍。",
            emotionalEffect: "惊喜",
            contexts: ["奇幻城市"],
            riskTags: [],
            tags: ["梦境"],
            freshness: "emerging",
            rightsStatus: "allowed",
            locale: "zh-CN",
          },
        ],
        causalNodes: [
          {
            id: nodeId,
            kind: "rule",
            title: "城市回应梦境",
            summary: "被压抑的梦会变成街区。",
            sourceType: "corpus_item",
            sourceId: corpusId,
            sourceVersion: 1,
            confirmed: true,
            version: 0,
            createdAt: "2026-08-27T00:00:00.000Z",
            updatedAt: "2026-08-27T00:00:00.000Z",
          },
        ],
        causalEdges: [],
        audienceStates: [],
        provenance: [
          {
            id: crypto.randomUUID(),
            fromType: "story_rule",
            fromId: nodeId,
            relation: "inspired_by",
            toType: "corpus_item",
            toId: corpusId,
            version: 0,
            createdAt: "2026-08-27T00:00:00.000Z",
          },
        ],
      },
      warnings: [],
    };
    const runtime = await fixture({
      readGrantedText: async () => ({
        name: "海上梦城.dramaip.json",
        content: JSON.stringify(packageDocument),
      }),
    } as unknown as DesktopHostClient);

    const previewResponse = await runtime.request(
      "/api/v2/project-packages/preview",
      {
        method: "POST",
        body: JSON.stringify({ capabilityToken: crypto.randomUUID() }),
      },
    );
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      201,
    );
    const preview = (await previewResponse.json()) as {
      id: string;
      projectTitle: string;
      chapterCount: number;
      resourceCount: number;
    };
    expect(preview).toMatchObject({
      projectTitle: "海上梦城",
      chapterCount: 0,
      resourceCount: 1,
    });
    const beforeCommit = await runtime.request("/api/v2/projects");
    await expect(beforeCommit.json()).resolves.toHaveLength(0);

    const committed = await runtime.request(
      `/api/v2/project-packages/${preview.id}/commit`,
      {
        method: "POST",
        body: JSON.stringify({ title: "海上梦城（已确认）" }),
      },
    );
    expect(committed.status, await committed.clone().text()).toBe(201);
    const result = (await committed.json()) as {
      project: { id: string; title: string };
      chaptersCreated: number;
      resourcesCreated: number;
    };
    expect(result).toMatchObject({
      project: { title: "海上梦城（已确认）" },
      chaptersCreated: 0,
      resourcesCreated: 4,
    });
    const inspirations = await runtime.request(
      `/api/v2/inspirations?projectId=${result.project.id}`,
    );
    await expect(inspirations.json()).resolves.toEqual([
      expect.objectContaining({
        title: "城市回应梦境",
        payload: expect.objectContaining({ 类型: "premise" }),
      }),
    ]);

    const invalidRuntime = await fixture({
      readGrantedText: async () => ({
        name: "invalid.dramaip.json",
        content: JSON.stringify({ ...packageDocument, schemaVersion: 5 }),
      }),
    } as unknown as DesktopHostClient);
    const invalid = await invalidRuntime.request(
      "/api/v2/project-packages/preview",
      {
        method: "POST",
        body: JSON.stringify({ capabilityToken: crypto.randomUUID() }),
      },
    );
    expect(invalid.status).toBe(400);
  });

  it("learns a creative fingerprint only after separate consent and an explicit experiment choice", async () => {
    const runtime = await fixture();
    const createExperiment = async (prompt: string) => {
      const response = await runtime.request("/api/v2/creative-experiments", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ originType: "inspiration", prompt }),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as {
        id: string;
        version: number;
        variants: { id: string; lane: string }[];
      };
    };
    const review = async (
      experiment: Awaited<ReturnType<typeof createExperiment>>,
    ) => {
      const selected = experiment.variants.find(
        (value) => value.lane === "balanced",
      )!;
      const response = await runtime.request(
        `/api/v2/creative-experiments/${experiment.id}/review`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            version: experiment.version,
            selectedVariantId: selected.id,
            rejected: false,
          }),
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);
    };

    const beforeConsent = await createExperiment("让一场家庭晚餐产生意外反转");
    expect(beforeConsent.variants.map((value) => value.lane)).toEqual([
      "conservative",
      "balanced",
      "wild",
    ]);
    await review(beforeConsent);
    const disabled = await runtime.request("/api/v2/creative-fingerprint");
    const disabledFingerprint = (await disabled.json()) as {
      enabled: boolean;
      dimensions: { confidence: number; evidenceIds: string[] }[];
    };
    expect(disabledFingerprint.enabled).toBe(false);
    expect(
      disabledFingerprint.dimensions.every((value) => value.confidence === 0),
    ).toBe(true);

    const consent = await runtime.request(
      "/api/v2/creative-fingerprint/settings",
      {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(consent.status).toBe(200);
    const afterConsent = await createExperiment("把职场误会改造成一场喜剧冲突");
    await review(afterConsent);
    const learned = await runtime.request("/api/v2/creative-fingerprint");
    const learnedFingerprint = (await learned.json()) as {
      enabled: boolean;
      dimensions: { confidence: number; evidenceIds: string[] }[];
    };
    expect(learnedFingerprint.enabled).toBe(true);
    expect(
      learnedFingerprint.dimensions.some(
        (value) =>
          value.confidence > 0 && value.evidenceIds.includes(afterConsent.id),
      ),
    ).toBe(true);
  });

  it("accepts only signed corpus snapshots and preserves private notes after a public tombstone", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const previousKey = process.env.DRAMAIP_CORPUS_SNAPSHOT_PUBLIC_KEY_PEM;
    process.env.DRAMAIP_CORPUS_SNAPSHOT_PUBLIC_KEY_PEM = publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    try {
      const runtime = await fixture();
      const sourceId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const now = "2026-08-27T00:00:00.000Z";
      const unsigned = {
        format: "dramaip-creative-corpus-snapshot" as const,
        schemaVersion: 1 as const,
        version: "2026.08.27",
        sources: [
          {
            id: sourceId,
            url: "https://example.com/public-story",
            domain: "example.com",
            title: "公开创意来源",
            excerpt: "一段用于验证的短摘录",
            contentHash: "a".repeat(64),
            status: "allowed" as const,
            rightsStatus: "allowed" as const,
            locale: "zh-CN",
            retrievedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ],
        items: [
          {
            id: itemId,
            sourceId,
            visibility: "public" as const,
            kind: "comic_device" as const,
            title: "误会升级",
            trigger: "双方都隐藏同一件事",
            mechanism: "让双方基于相反假设采取相同动作。",
            emotionalEffect: "喜剧紧张",
            contexts: ["关系喜剧"],
            riskTags: [],
            tags: ["误会"],
            freshness: "stable" as const,
            rightsStatus: "allowed" as const,
            locale: "zh-CN",
            createdAt: now,
            updatedAt: now,
          },
        ],
        tombstones: [] as string[],
      };
      const importSnapshot = async (payload: typeof unsigned, key: string) => {
        const signature = sign(
          null,
          Buffer.from(JSON.stringify(payload)),
          privateKey,
        ).toString("base64");
        return runtime.request("/api/v2/creative-corpus/snapshots/import", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ ...payload, signature }),
        });
      };
      const imported = await importSnapshot(unsigned, crypto.randomUUID());
      expect(imported.status, await imported.clone().text()).toBe(200);
      const collection = await runtime.request(
        "/api/v2/creative-corpus/collections",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            corpusItemId: itemId,
            title: "我的误会机制",
            mechanism: "保留机制，但换成人物自己的秘密。",
            notes: "用于家庭场景，避免照搬表达。",
            tags: ["私人备注"],
          }),
        },
      );
      expect(collection.status, await collection.clone().text()).toBe(201);

      const tombstone = {
        ...unsigned,
        version: "2026.08.28",
        sources: [],
        items: [],
        tombstones: [itemId],
      };
      const removed = await importSnapshot(tombstone, crypto.randomUUID());
      expect(removed.status, await removed.clone().text()).toBe(200);
      const publicItems = await runtime.request(
        "/api/v2/creative-corpus/items?visibility=public",
      );
      await expect(publicItems.json()).resolves.toEqual({ items: [] });
      const collections = await runtime.request(
        "/api/v2/creative-corpus/collections",
      );
      await expect(collections.json()).resolves.toEqual({
        items: [
          expect.objectContaining({
            corpusItemId: itemId,
            notes: "用于家庭场景，避免照搬表达。",
          }),
        ],
      });

      const invalid = await runtime.request(
        "/api/v2/creative-corpus/snapshots/import",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ ...unsigned, signature: "invalid" }),
        },
      );
      expect(invalid.status).toBe(400);
    } finally {
      if (previousKey === undefined)
        delete process.env.DRAMAIP_CORPUS_SNAPSHOT_PUBLIC_KEY_PEM;
      else process.env.DRAMAIP_CORPUS_SNAPSHOT_PUBLIC_KEY_PEM = previousKey;
    }
  });

  it("rejects the wrong bound project and expired previews, and discards without creating data", async () => {
    const runtime = await fixture({
      readGrantedDocument: async () => ({
        name: "story.txt",
        format: "txt",
        size: 20,
        content: "第一章\n正文",
      }),
    } as unknown as DesktopHostClient);
    const createProject = async (title: string) => {
      const response = await runtime.request("/api/v2/projects", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title }),
      });
      return (await response.json()) as { project: { id: string } };
    };
    const first = await createProject("绑定项目");
    const second = await createProject("错误项目");
    const previewFor = async (projectId?: string) => {
      const response = await runtime.request("/api/v2/source-imports/preview", {
        method: "POST",
        body: JSON.stringify({
          ...(projectId ? { projectId } : {}),
          capabilityToken: crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        importId: string;
        preview: Record<string, unknown>;
      };
    };
    const commitBody = (
      projectId: string,
      preview: Record<string, unknown>,
    ) => ({
      projectId,
      strategy: "append",
      rightsConfirmed: true,
      destructiveConfirmed: false,
      preview,
    });

    const bound = await previewFor(first.project.id);
    const wrongProject = await runtime.request(
      `/api/v2/source-imports/${bound.importId}/commit`,
      {
        method: "POST",
        body: JSON.stringify(commitBody(second.project.id, bound.preview)),
      },
    );
    expect(wrongProject.status).toBe(400);
    runtime.expireSourceImport(bound.importId);
    const expired = await runtime.request(
      `/api/v2/source-imports/${bound.importId}/commit`,
      {
        method: "POST",
        body: JSON.stringify(commitBody(first.project.id, bound.preview)),
      },
    );
    expect(expired.status).toBe(400);

    const disposable = await previewFor();
    const discarded = await runtime.request(
      `/api/v2/source-imports/${disposable.importId}`,
      { method: "DELETE" },
    );
    expect(discarded.status).toBe(204);
    const afterDiscard = await runtime.request(
      `/api/v2/source-imports/${disposable.importId}/commit`,
      {
        method: "POST",
        body: JSON.stringify(commitBody(first.project.id, disposable.preview)),
      },
    );
    expect(afterDiscard.status).toBe(404);
    const chapters = await runtime.request(
      `/api/v2/projects/${first.project.id}/chapters`,
    );
    await expect(chapters.json()).resolves.toHaveLength(0);
  });
});

describe("persistent AI creation workflow", () => {
  const prompts: string[] = [];
  function host(
    output: (prompt: string) => string | Promise<string>,
  ): DesktopHostClient {
    return {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        authenticated: true,
        generation: 1,
      }),
      engineOperation: async (_kind: string, operation: string) =>
        operation === "create" ? { id: crypto.randomUUID() } : { ok: true },
      async *engineStream(_kind: string, payload: { prompt: string }) {
        prompts.push(payload.prompt);
        const text = await output(payload.prompt);
        yield { type: "result" as const, result: { text } };
      },
    } as unknown as DesktopHostClient;
  }
  async function seed(runtime: Fixture) {
    const response = await runtime.request("/api/v2/projects", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        title: "冻结目标项目",
        mode: "series_longform",
        modeConfig: { mode: "series_longform" },
        synopsis: "秘密方向不得发送",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const { project } = (await response.json()) as { project: { id: string } };
    const chapter = (await (
      await runtime.request("/api/v2/chapters", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "第一章",
          content: "原正文保留。",
        }),
      })
    ).json()) as { id: string; version: number };
    return { project, chapter };
  }
  async function start(
    runtime: Fixture,
    input: Record<string, unknown>,
    key = crypto.randomUUID(),
  ) {
    const response = await runtime.request("/api/v2/workflows/creation", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        operation: "chapter",
        engineKind: "codex",
        model: { modelId: "test-fixed-model" },
        instruction: "保留林晚的动机，使用第三人称，约 12 字。",
        wordGoal: 12,
        ...input,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as import("@dramaip/contracts/creation").CreationWorkflow;
  }
  async function until(runtime: Fixture, id: string, stages: string[]) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const value = (await (
        await runtime.request(`/api/v2/workflows/creation/${id}`)
      ).json()) as import("@dramaip/contracts/creation").CreationWorkflow;
      if (stages.includes(value.stage)) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("创作工作流未在期限内推进");
  }
  it("persists live creation text and tool progress, then completes the same candidate item", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const content = "林晚推开门，终于看清来人。";
    const engineHost = host(() => "");
    engineHost.engineStream = async function* (_kind, payload) {
      if (String(payload?.prompt).includes("审阅候选与冻结")) {
        yield {
          type: "result",
          result: { text: JSON.stringify({ issues: [] }) },
        };
        return;
      }
      yield {
        type: "tool",
        tool: "context_read",
        status: "started",
        itemId: "read-1",
      };
      yield {
        type: "tool",
        tool: "context_read",
        status: "completed",
        itemId: "read-1",
      };
      yield {
        type: "content.delta",
        delta: '{"title":"第一章","content":"林晚推开门',
      };
      await gate;
      yield { type: "content.delta", delta: '，终于看清来人。","items":[]}' };
      yield {
        type: "result",
        result: {
          text: JSON.stringify({ title: "第一章", content, items: [] }),
        },
      };
    };
    const runtime = await fixture(undefined, engineHost);
    const { project, chapter } = await seed(runtime);
    const created = await start(runtime, {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    });
    try {
      const running = await until(runtime, created.id, ["generating"]);
      let items: Array<{
        id: string;
        type: string;
        status: string;
        content: string;
      }> = [];
      await expect
        .poll(async () => {
          items = await (
            await runtime.request(`/api/v2/agent-runs/${running.runId}/items`)
          ).json();
          return items.find((item) => item.type === "message")?.content;
        })
        .toContain("林晚推开门");
      const streamed = items.find((item) => item.type === "message")!;
      expect(streamed.status).toBe("streaming");
      expect(items.find((item) => item.type === "stage")).toMatchObject({
        status: "completed",
        content: "项目资料读取完成",
      });
      // The persisted snapshot recovers the same partial text for a newly opened panel.
      const reopened = await (
        await runtime.request(`/api/v2/agent-runs/${running.runId}/items`)
      ).json();
      expect(reopened).toEqual(items);
      release();
      const ready = await until(runtime, created.id, [
        "awaiting-review",
        "failed",
      ]);
      expect(ready.stage).toBe("awaiting-review");
      items = await (
        await runtime.request(`/api/v2/agent-runs/${running.runId}/items`)
      ).json();
      expect(items.filter((item) => item.type === "message")).toHaveLength(1);
      expect(items.find((item) => item.type === "message")).toMatchObject({
        id: streamed.id,
        status: "completed",
      });
      expect(ready.output?.content).toBe(content);
    } finally {
      release();
    }
  });
  it("freezes actual sources and chosen model, checks once, waits for adoption and then derives factual memory", async () => {
    prompts.length = 0;
    const content = "林晚推开门，终于看清来人。";
    const runtime = await fixture(
      undefined,
      host((prompt) =>
        prompt.includes("审阅候选与冻结")
          ? JSON.stringify({ issues: [] })
          : prompt.includes("仅提取正文明确")
            ? JSON.stringify({
                title: "记忆",
                content: "林晚开门",
                items: [
                  {
                    ref: "m",
                    kind: "chapter-memories",
                    title: "开门事件",
                    data: { evidence: content, 章节摘要: "林晚开门看清来人。" },
                  },
                ],
              })
            : JSON.stringify({ title: "第一章", content, items: [] }),
      ),
    );
    const { project, chapter } = await seed(runtime);
    await runtime.request(
      `/api/v2/projects/${project.id}/agent-context-policies`,
      {
        method: "PUT",
        headers: { "If-Match": '"0"' },
        body: JSON.stringify({
          version: 0,
          policies: [{ fieldPath: "/project", mode: "never" }],
        }),
      },
    );
    const input = {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    };
    const key = crypto.randomUUID();
    const created = await start(runtime, input, key);
    expect((await start(runtime, input, key)).id).toBe(created.id);
    const ready = await until(runtime, created.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    expect(ready.runIds).toHaveLength(2);
    expect(ready.input.model?.modelId).toBe("test-fixed-model");
    expect(
      prompts.every((prompt) => !prompt.includes("秘密方向不得发送")),
    ).toBe(true);
    expect(prompts[0]).toContain(chapter.id);
    expect(prompts[0]).toContain("第三人称");
    expect(prompts[0]).toContain("目标字数：12");
    expect(ready.contextEntries.some((entry) => !entry.included)).toBe(true);
    const before = (await (
      await runtime.request(`/api/v2/chapters/${chapter.id}`)
    ).json()) as { content: string };
    expect(before.content).toBe("原正文保留。");
    const commit = await runtime.request(
      `/api/v2/change-previews/${ready.previewId}/commit`,
      { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    expect(commit.status, await commit.clone().text()).toBe(200);
    expect(
      (
        await runtime.request(
          `/api/v2/change-previews/${ready.previewId}/commit`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
          },
        )
      ).status,
    ).toBe(200);
    const applied = await until(runtime, created.id, ["applied"]);
    expect(applied.stage).toBe("applied");
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = (await (
        await runtime.request(`/api/v2/workflows/creation/${created.id}`)
      ).json()) as import("@dramaip/contracts/creation").CreationWorkflow;
      if (current.memoryState === "synced") break;
      if (attempt === 99)
        throw new Error(`派生记忆未同步：${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const memories = (await (
      await runtime.request(`/api/v2/chapter-memories?projectId=${project.id}`)
    ).json()) as Array<{
      payload: { sourceVersion: number; sourceChapterId: string };
    }>;
    expect(
      memories.some(
        (item) =>
          item.payload.sourceChapterId === chapter.id &&
          item.payload.sourceVersion === chapter.version + 1,
      ),
    ).toBe(true);
  }, 15000);
  it("restores the exact pending candidate, model and context after a Runtime restart without generating again", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "dramaip-creation-restart-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const runtime = await fixture(
      undefined,
      host((prompt) =>
        prompt.includes("审阅候选与冻结")
          ? JSON.stringify({ issues: [] })
          : JSON.stringify({
              title: "重启候选",
              content: "林晚推开门，终于看清来人。",
              items: [],
            }),
      ),
      databasePath,
    );
    const { project, chapter } = await seed(runtime);
    const started = await start(runtime, {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    });
    const pending = await until(runtime, started.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(pending.stage, pending.error).toBe("awaiting-review");
    await runtime.close();
    let unexpectedCalls = 0;
    const reopened = await fixture(
      undefined,
      host(() => {
        unexpectedCalls++;
        return "不应重新调用";
      }),
      databasePath,
    );
    const restored = await until(reopened, started.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(restored).toEqual(pending);
    const candidate = await reopened.request(
      `/api/v2/change-previews/${pending.previewId}`,
    );
    expect(candidate.status).toBe(200);
    expect(await candidate.json()).toMatchObject({
      status: "pending",
      id: pending.previewId,
    });
    const chapterResponse = await reopened.request(
      `/api/v2/chapters/${chapter.id}`,
    );
    expect(await chapterResponse.json()).toMatchObject({
      content: "原正文保留。",
      version: chapter.version,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(unexpectedCalls).toBe(0);
  }, 15000);

  it("exports unaligned AI translation as a draft and preserves supplied subtitle times without inventing them", async () => {
    const runtime = await fixture();
    const { project } = await seed(runtime);
    const create = async (payload: Record<string, unknown>) => {
      const response = await runtime.request("/api/v2/localization", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "英文译文",
          payload,
        }),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as { id: string };
    };
    const draft = await create({
      字幕与译文: "Lin opens the door.",
      timingStatus: "unaligned",
    });
    for (const format of ["srt", "vtt"]) {
      const response = await runtime.request(
        `/api/v2/localization/${draft.id}/subtitles/${format}`,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "TIMING_REQUIRED" });
    }
    const text = await runtime.request(
      `/api/v2/localization/${draft.id}/subtitles/txt`,
    );
    expect(text.status).toBe(200);
    expect(await text.json()).toMatchObject({
      content: expect.stringContaining("待对齐译文草稿"),
    });
    const legacy = await create({
      字幕与译文: "An older untimed translation.",
    });
    expect(
      (await runtime.request(`/api/v2/localization/${legacy.id}/subtitles/srt`))
        .status,
    ).toBe(409);
    const timed = await create({
      字幕与译文: "1\n00:00:03,250 --> 00:00:05,750\nLin opens the door.",
    });
    const vtt = await runtime.request(
      `/api/v2/localization/${timed.id}/subtitles/vtt`,
    );
    expect(vtt.status).toBe(200);
    expect(await vtt.json()).toMatchObject({
      content: "WEBVTT\n\n00:00:03.250 --> 00:00:05.750\nLin opens the door.\n",
    });
  });

  it("routes a chapter assistant enhancement through the same durable candidate and rejects another chapter binding", async () => {
    const runtime = await fixture(
      undefined,
      host((prompt) =>
        prompt.includes("审阅候选与冻结")
          ? JSON.stringify({ issues: [] })
          : JSON.stringify({
              title: "增强冲突",
              content: "林晚推开门，终于看清来人。",
              items: [],
            }),
      ),
    );
    const { project, chapter } = await seed(runtime);
    const response = await runtime.request("/api/v2/assistant-conversations", {
      method: "POST",
      body: JSON.stringify({
        surface: "novel",
        projectId: project.id,
        chapterId: chapter.id,
        engineKind: "codex",
        model: { modelId: "test-fixed-model" },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const conversation = (await response.json()) as { id: string };
    const request = {
      message: "增强人物对抗，保留行动动机。",
      taskType: "enhance_conflict",
      chapterId: chapter.id,
      chapterBaseVersion: chapter.version,
    };
    const key = crypto.randomUUID();
    const send = () =>
      runtime.request(
        `/api/v2/assistant-conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(request),
        },
      );
    const sent = await send();
    expect(sent.status, await sent.clone().text()).toBe(200);
    const { turn } = (await sent.json()) as {
      turn: { route: { workflowId: string } };
    };
    expect(await (await send()).json()).toMatchObject({
      turn: { route: { workflowId: turn.route.workflowId } },
    });
    const ready = await until(runtime, turn.route.workflowId, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    expect(ready.input).toMatchObject({
      conversationId: conversation.id,
      targetId: chapter.id,
      instruction: request.message,
    });
    const mismatch = await runtime.request(
      `/api/v2/assistant-conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...request, chapterId: crypto.randomUUID() }),
      },
    );
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: "CONTEXT_MISMATCH" });
  }, 15000);

  it("performs at most one local revision and preserves unresolved model concerns", async () => {
    let generation = 0;
    const runtime = await fixture(
      undefined,
      host((prompt) => {
        if (prompt.includes("审阅候选与冻结"))
          return JSON.stringify({
            issues: [
              {
                severity: "warning",
                message: "人物动机待确认",
                evidence: "林晚",
                location: "首段",
                suggestion: "明确行动原因",
                source: "model",
              },
            ],
          });
        generation++;
        return JSON.stringify({
          title: "候选",
          content: "林晚推开门，终于看清来人。",
          items: [],
        });
      }),
    );
    const { project, chapter } = await seed(runtime);
    const created = await start(runtime, {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    });
    const ready = await until(runtime, created.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    expect(generation).toBe(2);
    expect(ready.runIds).toHaveLength(4);
    expect(ready.issues.length).toBeGreaterThan(0);
  }, 15000);
  it("never announces review readiness for malformed engine output", async () => {
    const runtime = await fixture(
      undefined,
      host(() => "这只是聊天回复，不是候选协议。"),
    );
    const { project, chapter } = await seed(runtime);
    const created = await start(runtime, {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    });
    const failed = await until(runtime, created.id, ["failed"]);
    expect(failed.previewId).toBeUndefined();
    const key = crypto.randomUUID();
    const retry = () =>
      runtime.request(`/api/v2/workflows/creation/${created.id}/actions`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ action: "retry" }),
      });
    const a = (await (await retry()).json()) as {
      id: string;
      sourceWorkflowId: string;
    };
    const b = (await (await retry()).json()) as { id: string };
    expect(a.id).toBe(b.id);
    expect(a.sourceWorkflowId).toBe(created.id);
  }, 15000);
  it("rejects a chapter from a different project before making any model request", async () => {
    let calls = 0;
    const runtime = await fixture(
      undefined,
      host(() => {
        calls++;
        return "{}";
      }),
    );
    const one = await seed(runtime);
    const two = await seed(runtime);
    const response = await runtime.request("/api/v2/workflows/creation", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        projectId: one.project.id,
        targetId: two.chapter.id,
        baseVersion: two.chapter.version,
        operation: "chapter",
        engineKind: "codex",
        model: { modelId: "test-fixed-model" },
        instruction: "生成",
      }),
    });
    expect(response.status).toBe(409);
    expect(calls).toBe(0);
  });
  it("cancels the real executor and ignores its delayed output before an idempotent task-centre retry", async () => {
    let release!: (value: string) => void;
    let calls = 0;
    let aborted = 0;
    const engine = host((prompt) => {
      calls++;
      if (calls === 1)
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      return JSON.stringify(
        prompt.includes("审阅候选与冻结")
          ? { issues: [] }
          : {
              title: "新运行",
              content: "林晚推开门，终于看清来人。",
              items: [],
            },
      );
    });
    const operation = engine.engineOperation.bind(engine);
    engine.engineOperation = async (
      ...args: Parameters<typeof engine.engineOperation>
    ) => {
      if (args[1] === "cancel") aborted++;
      return operation(...args);
    };
    const runtime = await fixture(undefined, engine);
    const { project, chapter } = await seed(runtime);
    const created = await start(runtime, {
      projectId: project.id,
      targetId: chapter.id,
      baseVersion: chapter.version,
    });
    for (let count = 0; count < 60 && !release; count++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(release).toBeDefined();
    const canceled = await runtime.request(
      `/api/v2/tasks/${created.taskId}/cancel`,
      { method: "POST" },
    );
    expect(canceled.status, await canceled.clone().text()).toBe(200);
    expect(aborted).toBeGreaterThan(0);
    release(
      JSON.stringify({
        title: "过期",
        content: "不应被采用的延迟结果",
        items: [],
      }),
    );
    const key = crypto.randomUUID();
    const retry = () =>
      runtime.request(`/api/v2/tasks/${created.taskId}/retry`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: "{}",
      });
    const retryResponse = await retry();
    expect(retryResponse.status, await retryResponse.clone().text()).toBe(200);
    const task = (await retryResponse.json()) as {
      id: string;
      result: { creationWorkflowId: string };
    };
    expect(((await (await retry()).json()) as { id: string }).id).toBe(task.id);
    const ready = await until(runtime, task.result.creationWorkflowId, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    expect(ready.output?.title).toBe("新运行");
    const old = await until(runtime, created.id, ["canceled"]);
    expect(old.previewId).toBeUndefined();
  }, 15000);

  it("adopts an AI episode package atomically with real parent links, then produces a delivery candidate", async () => {
    const content = "INT. 雨夜门厅 - NIGHT\n\n林晚推门。\n\n林晚\n你回来了。";
    const runtime = await fixture(
      undefined,
      host((prompt) =>
        JSON.stringify(
          prompt.includes("审阅候选与冻结")
            ? { issues: [] }
            : prompt.includes("生成标题、简介、标签")
              ? {
                  title: "交付方案",
                  content: "雨夜归来",
                  items: [
                    {
                      ref: "copy",
                      kind: "delivery-variant",
                      title: "主文案",
                      data: {
                        label: "主文案",
                        title: "雨夜归来",
                        description: "一扇门后的重逢。",
                        tags: ["悬疑"],
                        coverBrief: "雨夜门缝中的剪影",
                      },
                    },
                  ],
                }
              : {
                  title: "第一集",
                  content,
                  items: [
                    {
                      ref: "a",
                      kind: "adaptations",
                      title: "雨夜归来",
                      data: {},
                    },
                    {
                      ref: "e",
                      parentRef: "a",
                      kind: "episodes",
                      title: "第一集",
                      data: { 集数: 1 },
                    },
                    {
                      ref: "s",
                      parentRef: "e",
                      kind: "scripts",
                      title: "第一集剧本",
                      data: { 剧本内容: content },
                    },
                    {
                      ref: "c",
                      parentRef: "s",
                      kind: "scenes",
                      title: "门厅",
                      data: { 场景动作: "推门" },
                    },
                    {
                      ref: "h",
                      parentRef: "c",
                      kind: "shots",
                      title: "推门特写",
                      data: {
                        生成提示: "雨夜门厅，手推开木门，电影光影",
                        时长: "5",
                      },
                    },
                  ],
                },
        ),
      ),
    );
    const { project, chapter } = await seed(runtime);
    const created = await start(runtime, {
      projectId: project.id,
      operation: "episode",
      sourceIds: [chapter.id],
      instruction: "改编已采用正文，生成第一集。",
      wordGoal: undefined,
    });
    const ready = await until(runtime, created.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    const list = async (kind: string) =>
      (await (
        await runtime.request(`/api/v2/${kind}?projectId=${project.id}`)
      ).json()) as Array<{
        id: string;
        parentId?: string;
        version: number;
        payload: Record<string, unknown>;
      }>;
    expect(await list("episodes")).toHaveLength(0);
    const adopt = () =>
      runtime.request(`/api/v2/change-previews/${ready.previewId}/commit`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
    expect((await adopt()).status).toBe(200);
    expect((await adopt()).status).toBe(200);
    const [adaptation] = await list("adaptations"),
      [episode] = await list("episodes"),
      [script] = await list("scripts"),
      [scene] = await list("scenes"),
      [shot] = await list("shots");
    expect(episode!.parentId).toBe(adaptation!.id);
    expect(script!.parentId).toBe(episode!.id);
    expect(scene!.parentId).toBe(script!.id);
    expect(shot!.parentId).toBe(scene!.id);
    expect(await list("shots")).toHaveLength(1);
    const document = (await (
      await runtime.request(`/api/v2/scripts/${script!.id}/screenplay`)
    ).json()) as { blocks: Array<{ id: string; type: string }> };
    expect(document.blocks.some((block) => block.type === "dialogue")).toBe(
      true,
    );
    const delivery = await start(runtime, {
      projectId: project.id,
      operation: "delivery-copy",
      targetId: episode!.id,
      baseVersion: episode!.version,
      instruction: "生成交付文案",
      wordGoal: undefined,
    });
    const copy = await until(runtime, delivery.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(copy.stage, copy.error).toBe("awaiting-review");
    expect(copy.output?.items[0]?.data.title).toBe("雨夜归来");
  }, 15000);

  it("keeps stable screenplay blocks, resolves concurrent edits into a new checked candidate, and rechecks adopted review feedback", async () => {
    let blocks: Array<{ id: string; type: string; text: string }> = [];
    const sent: string[] = [];
    const runtime = await fixture(
      undefined,
      host((prompt) => {
        sent.push(prompt);
        return JSON.stringify(
          prompt.includes("审阅候选与冻结")
            ? { issues: [] }
            : {
                title: "返修剧本",
                content: blocks.map((block) => block.text).join("\n\n"),
                items: blocks.map((block) => ({
                  ref: block.id,
                  kind: "screenplay-block",
                  title: block.type,
                  data: block,
                })),
              },
        );
      }),
    );
    const { project } = await seed(runtime);
    const create = async (
      kind: string,
      title: string,
      parentId?: string,
      payload = {},
    ) => {
      const response = await runtime.request(`/api/v2/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title,
          parentId,
          payload,
        }),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as { id: string; version: number };
    };
    const adaptation = await create("adaptations", "首季");
    const episode = await create("episodes", "首集", adaptation.id);
    const script = await create("scripts", "首集剧本", episode.id, {
      剧本内容: "INT. ROOM - NIGHT\n\n林晚走进来。\n\nLIN\n你回来了。",
    });
    const scene = await create("scenes", "门厅", script.id);
    await create("shots", "首镜", scene.id, { 时长: "5" });
    const doc = (await (
      await runtime.request(`/api/v2/scripts/${script.id}/screenplay`)
    ).json()) as { version: number; blocks: typeof blocks };
    expect(doc.blocks.length).toBeGreaterThan(2);
    blocks = doc.blocks.map((block) => ({
      ...block,
      text: block.type === "action" ? "林晚为取回证据推门而入。" : block.text,
    }));
    const packageResponse = await runtime.request(
      `/api/v2/episodes/${episode.id}/review-packages`,
      { method: "POST" },
    );
    expect(packageResponse.status, await packageResponse.clone().text()).toBe(
      201,
    );
    const review = (await packageResponse.json()) as { id: string };
    const comment = await runtime.request(
      `/api/v2/review-packages/${review.id}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: "原审片问题：林晚入门动机不清晰。" }),
      },
    );
    expect(comment.status).toBe(201);
    const created = await start(runtime, {
      projectId: project.id,
      operation: "script-revision",
      targetId: script.id,
      baseVersion: script.version,
      reviewPackageId: review.id,
      instruction: "解决入门动机问题",
      wordGoal: undefined,
    });
    const ready = await until(runtime, created.id, [
      "awaiting-review",
      "failed",
    ]);
    expect(ready.stage, ready.error).toBe("awaiting-review");
    expect(sent.some((prompt) => prompt.includes("原审片问题"))).toBe(true);
    const changed = doc.blocks.map((block) => ({
      ...block,
      text:
        block.type === "action" ? "林晚为寻找失踪的姐姐走进门。" : block.text,
    }));
    const extra = {
      id: crypto.randomUUID(),
      type: "action",
      text: "窗外传来一声口哨。",
    };
    const patched = await runtime.request(
      `/api/v2/scripts/${script.id}/screenplay`,
      {
        method: "PATCH",
        headers: { "If-Match": `"${doc.version}"` },
        body: JSON.stringify({
          version: doc.version,
          blocks: [...changed, extra],
        }),
      },
    );
    expect(patched.status).toBe(200);
    const merge = (await (
      await runtime.request(`/api/v2/workflows/creation/${created.id}/merge`)
    ).json()) as import("@dramaip/contracts/creation").CreationMerge;
    expect(merge.units.some((unit) => unit.conflict)).toBe(true);
    const rebase = (choices: Record<string, string>) =>
      runtime.request(`/api/v2/workflows/creation/${created.id}/rebase`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ baseVersion: merge.currentVersion, choices }),
      });
    expect((await rebase({})).status).toBe(409);
    const mergedResponse = await rebase(
      Object.fromEntries(
        merge.units
          .filter((unit) => unit.conflict)
          .map((unit) => [unit.id, "main"]),
      ),
    );
    expect(mergedResponse.status, await mergedResponse.clone().text()).toBe(
      200,
    );
    const merged =
      (await mergedResponse.json()) as import("@dramaip/contracts/creation").CreationWorkflow;
    expect(merged.sourceWorkflowId).toBe(created.id);
    const next = await until(runtime, merged.id, ["awaiting-review", "failed"]);
    expect(next.stage, next.error).toBe("awaiting-review");
    expect(next.output?.content).toContain(extra.text);
    expect(next.output?.content).toContain("寻找失踪的姐姐");
    const adopt = await runtime.request(
      `/api/v2/change-previews/${next.previewId}/commit`,
      { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    expect(adopt.status, await adopt.clone().text()).toBe(200);
    const current = (await (
      await runtime.request(`/api/v2/scripts/${script.id}/screenplay`)
    ).json()) as { blocks: typeof blocks };
    expect(current.blocks.some((block) => block.id === extra.id)).toBe(true);
    for (let attempt = 0; attempt < 100; attempt++) {
      const parent = (await (
        await runtime.request(`/api/v2/workflows/creation/${next.id}`)
      ).json()) as import("@dramaip/contracts/creation").CreationWorkflow;
      if (parent.adoptionCheckId) {
        const check = await until(runtime, parent.adoptionCheckId, [
          "applied",
          "failed",
        ]);
        expect(check.stage, check.error).toBe("applied");
        expect(check.runIds).toHaveLength(1);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("采用后未复检原审片问题。");
  }, 20000);
});
