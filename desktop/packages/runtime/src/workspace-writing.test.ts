import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
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
  close(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function fixture(host?: DesktopHostClient): Promise<Fixture> {
  const database = openDatabase(":memory:");
  const plugins: readonly FirstPartyPlugin[] = [
    foundationPlugin,
    createSystemPlugin(),
    createWorkspacePlugin(host),
    automationPlugin,
    writingPlugin,
    knowledgePlugin,
    createAgentsPlugin(),
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
      runtimeKind: "bun",
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
    expireSourceImport: (id) =>
      database.uow.execute((transaction) => {
        transaction.run(
          "UPDATE workspace_source_imports SET expires_at = ? WHERE id = ?",
          "2000-01-01T00:00:00.000Z",
          id,
        );
      }),
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
