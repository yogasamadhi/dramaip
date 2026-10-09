import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import type {
  StoryDeclarationSource,
  StoryDeclaration,
  StoryAssertion,
} from "@dramaip/contracts/knowledge";

test("来源声明全局完整分页／原 ID 独立审阅／后台重启／源变与失败缓存保护，聚合只读元数据", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-story-pending-"));
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    page: Page,
    client: StudioClient,
    monitoring = false,
    dialogs = 0;
  const requests: Array<{ method: string; path: string; query: string }> = [];
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    page.on("dialog", async (dialog) => {
      dialogs++;
      await dialog.dismiss();
    });
    page.on("request", (request) => {
      if (!monitoring || !request.url().includes("/api/v2/")) return;
      const url = new URL(request.url());
      requests.push({
        method: request.method(),
        path: url.pathname,
        query: url.search,
      });
    });
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  const hidden = async () =>
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  const navigate = async (path: string) => {
    await page.evaluate((value) => {
      window.location.hash = `#${value}`;
    }, path);
  };
  const refresh = async () => {
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  };
  const row = (kind: "story-declaration" | "story-assertion", id: string) =>
    page.locator(`[data-confirmation-key="${kind}:${id}"]`);
  const readOnlyScan = () => {
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(
      requests.filter((request) =>
        /\/(story-declarations|story-assertions)\/[^/]+$/.test(request.path),
      ),
    ).toEqual([]);
    expect(
      requests.filter((request) =>
        /\/chapters\/[^/]+$|\/screenplay-sources\/[^/]+$|\/screenplay$/.test(
          request.path,
        ),
      ),
    ).toEqual([]);
  };
  try {
    await launch();
    await hidden();
    const { project } = await client.projects.create({
        title: "小说与剧本来源待确认",
      }),
      { project: other } = await client.projects.create({
        title: "隔离的另一作品",
      });
    const chapter = await client.chapters.create({
      projectId: project.id,
      title: "实际小说原章",
      content:
        "PRIVATE NOVEL SELECTED 原文证据。\n\nPRIVATE NOVEL UNSELECTED 未选正文。",
    });
    const detail = await client.narrativeIndex.chapter(project.id, chapter.id);
    const novel: StoryDeclarationSource = {
      kind: "paragraphs",
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      chapterContentHash: detail.chapter.contentHash,
      paragraphIds: [detail.paragraphs[0]!.id],
    };
    const nodes: StoryDeclaration[] = [];
    // More than the requested 100: this is actual owner pagination, not a fake cursor.
    for (let index = 0; index < 101; index++)
      nodes.push(
        await client.storyDeclarations.create(
          project.id,
          {
            kind: "event",
            title: `原文节点候选 ${index + 1}`,
            statement: "PRIVATE 作者解释不进入聚合",
            sources: [novel],
          },
          crypto.randomUUID(),
        ),
      );
    const originalNode = nodes[0]!,
      newerNode = nodes.at(-1)!;
    let adoptedNode = await client.storyDeclarations.create(
      project.id,
      {
        kind: "secret",
        title: "已采用节点",
        statement: "PRIVATE 仅在原详情审阅",
        sources: [novel],
      },
      crypto.randomUUID(),
    );
    adoptedNode = await client.storyDeclarations.adopt(
      project.id,
      adoptedNode,
      {
        sourceFingerprint: adoptedNode.basis.fingerprint,
        confirmedSourceReview: true,
        confirmedInterpretationReview: true,
      },
      crypto.randomUUID(),
    );
    const discarded = await client.storyDeclarations.create(
      project.id,
      {
        kind: "event",
        title: "已放弃节点",
        statement: "PRIVATE 已放弃解释",
        sources: [novel],
      },
      crypto.randomUUID(),
    );
    await client.storyDeclarations.discard(
      project.id,
      discarded,
      crypto.randomUUID(),
    );
    const character = await client.storyIntelligence.createNode(project.id, {
      kind: "character",
      title: "实际角色",
      summary: "人工确认节点",
      sourceType: "manual",
      sourceId: project.id,
      sourceVersion: 0,
      confirmed: true,
    });
    const script = await client.resources.create("scripts", {
      projectId: project.id,
      title: "已保存剧本",
      payload: {
        剧本内容:
          "INT. SOURCE ROOM - DAY\n\nPRIVATE SCRIPT SELECTED 角色揭示秘密。\n\nPRIVATE SCRIPT UNSELECTED 后文。",
      },
    });
    const saved = await client.screenplaySources.get(project.id, script.id);
    expect(saved.source.state).toBe("available");
    if (saved.source.state !== "available") throw new Error("实际保存剧本缺失");
    const screenplay: StoryDeclarationSource = {
      kind: "screenplay-blocks",
      scriptId: script.id,
      scriptVersion: script.version,
      documentId: saved.source.document.id,
      documentVersion: saved.source.document.version,
      documentContentHash: saved.source.contentHash,
      blockIds: [saved.source.document.blocks[1]!.id],
    };
    const relationInput = {
      kind: "relationship" as const,
      title: "保存剧本关系候选",
      statement: "PRIVATE 独立关系解释",
      interpretation: "author-inferred" as const,
      sources: [screenplay],
      from: { id: character.id, version: character.version },
      to: {
        id: adoptedNode.adoptedNode!.id,
        version: adoptedNode.adoptedNode!.version,
      },
      relation: "reveals" as const,
      confidence: 0.7,
    };
    const relation = await client.storyAssertions.create(
        project.id,
        relationInput,
        crypto.randomUUID(),
      ),
      newerRelation = await client.storyAssertions.create(
        project.id,
        { ...relationInput, title: "较新关系不能替代旧关系" },
        crypto.randomUUID(),
      ),
      cognition = await client.storyAssertions.create(
        project.id,
        {
          kind: "cognition",
          title: "实际小说认知候选",
          statement: "PRIVATE 独立认知解释",
          interpretation: "author-inferred",
          sources: [novel],
          target: relationInput.to,
          subject: { kind: "character", node: relationInput.from },
          storyOrder: 1,
          state: "suspects",
        },
        crypto.randomUUID(),
      );
    let adoptedRelation: StoryAssertion = await client.storyAssertions.create(
      project.id,
      {
        ...relationInput,
        title: "已采用独立关系",
        relation: "causes",
      },
      crypto.randomUUID(),
    );
    adoptedRelation = await client.storyAssertions.adopt(
      project.id,
      adoptedRelation,
      {
        sourceFingerprint: adoptedRelation.basis.fingerprint,
        confirmedSourceReview: true,
        confirmedInterpretationReview: true,
      },
      crypto.randomUUID(),
    );
    const otherChapter = await client.chapters.create({
        projectId: other.id,
        title: "另一原章",
        content: "PRIVATE OTHER 原文。",
      }),
      otherIndex = await client.narrativeIndex.chapter(
        other.id,
        otherChapter.id,
      ),
      otherCandidate = await client.storyDeclarations.create(
        other.id,
        {
          kind: "event",
          title: "另一作品候选",
          statement: "PRIVATE OTHER 解释",
          sources: [
            {
              kind: "paragraphs",
              chapterId: otherChapter.id,
              chapterVersion: otherChapter.version,
              chapterContentHash: otherIndex.chapter.contentHash,
              paragraphIds: [otherIndex.paragraphs[0]!.id],
            },
          ],
        },
        crypto.randomUUID(),
      );
    const tasks = await client.tasks.list(),
      graph = await client.storyIntelligence.graph(project.id),
      originalChapter = await client.chapters.get(chapter.id),
      originalScript = await client.resources.get("scripts", script.id);
    monitoring = true;
    await navigate(`/pending?projectId=${project.id}`);
    await expect(
      page.getByRole("tab", { name: "待确认 · 104", exact: true }),
    ).toBeVisible();
    await expect(row("story-declaration", originalNode.id)).toBeVisible();
    await expect(row("story-declaration", newerNode.id)).toBeVisible();
    await expect(row("story-assertion", relation.id)).toBeVisible();
    await expect(row("story-assertion", cognition.id)).toBeVisible();
    await expect(row("story-declaration", adoptedNode.id)).toHaveCount(0);
    await expect(row("story-assertion", adoptedRelation.id)).toHaveCount(0);
    await expect(row("story-declaration", discarded.id)).toHaveCount(0);
    await expect(row("story-declaration", otherCandidate.id)).toHaveCount(0);
    await expect(
      page.getByRole("tabpanel", { name: "待确认项目列表", exact: true }),
    ).not.toContainText("PRIVATE");
    expect(
      requests.filter(
        (request) =>
          request.path.endsWith("/story-declarations") &&
          request.query.includes("cursor="),
      ),
    ).toHaveLength(1);
    readOnlyScan();
    await row("story-assertion", relation.id).screenshot({
      path: info.outputPath("story-pending-original-row.png"),
    });

    monitoring = false;
    await row("story-assertion", relation.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    let review = page.getByLabel("原关系认知来源审阅", { exact: true });
    await expect(review).toContainText(relation.id);
    await expect(review).not.toContainText(newerRelation.id);
    await expect(review).toContainText("PRIVATE SCRIPT SELECTED");
    await expect(
      review.getByLabel("已核对关系认知原文与节点版本", { exact: true }),
    ).not.toBeChecked();
    await expect(
      review.getByLabel("已审阅关系认知解释与不确定性", { exact: true }),
    ).not.toBeChecked();
    await expect(
      review.getByRole("button", {
        name: "明确采用该原关系认知声明",
        exact: true,
      }),
    ).toBeDisabled();
    await review
      .getByLabel("已核对关系认知原文与节点版本", { exact: true })
      .check();
    await review
      .getByLabel("已审阅关系认知解释与不确定性", { exact: true })
      .check();
    await hidden();
    manager?.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate(
      `/create?projectId=${project.id}&storyAssertionId=${relation.id}`,
    );
    review = page.getByLabel("原关系认知来源审阅", { exact: true });
    await expect(review).toContainText(relation.id);
    await expect(
      review.getByLabel("已核对关系认知原文与节点版本", { exact: true }),
    ).not.toBeChecked();
    await expect(
      review.getByLabel("已审阅关系认知解释与不确定性", { exact: true }),
    ).not.toBeChecked();

    requests.length = 0;
    monitoring = true;
    await navigate("/pending");
    await expect(
      page.getByRole("tab", { name: "待确认 · 105", exact: true }),
    ).toBeVisible();
    await expect(row("story-declaration", otherCandidate.id)).toBeVisible();
    await page
      .getByLabel("待确认项目范围", { exact: true })
      .selectOption(project.id);
    await expect(
      page.getByRole("tab", { name: "待确认 · 104", exact: true }),
    ).toBeVisible();
    await expect(row("story-declaration", otherCandidate.id)).toHaveCount(0);

    // Warm-cache failure: neither old cards nor their exact-return links remain actionable.
    let projectFailures = 0;
    const projectRoute = "**/api/v2/projects";
    await page.route(projectRoute, async (route) => {
      projectFailures++;
      await route.fulfill({
        status: 503,
        json: { title: "controlled project list failure" },
      });
    });
    await refresh();
    await expect(page.getByRole("alert")).toContainText(
      "已隐藏旧缓存中的对象入口",
    );
    await expect(page.locator("[data-confirmation-key]")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "返回对应对象", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "待确认 · 未核全", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("待确认项目范围", { exact: true }),
    ).toHaveValue(project.id);
    await expect(
      page.getByLabel("待确认项目范围", { exact: true }),
    ).toContainText("当前链接项目（状态未核对）");
    expect(projectFailures).toBeGreaterThan(0);
    await page.locator("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath("story-pending-failed-cache.png"),
    });
    await page.unroute(projectRoute);
    await refresh();
    await expect(
      page.getByRole("tab", { name: "待确认 · 104", exact: true }),
    ).toBeVisible();

    // Actual page two fails. Discard all first-page nodes, retain unrelated complete assertions.
    let laterFailures = 0;
    const declarationRoute = `**/api/v2/projects/${project.id}/story-declarations**`;
    await page.route(declarationRoute, async (route) => {
      if (new URL(route.request().url()).searchParams.has("cursor")) {
        laterFailures++;
        await route.fulfill({
          status: 503,
          json: { title: "PRIVATE later page error" },
        });
      } else await route.continue();
    });
    await refresh();
    await expect(page.getByRole("alert")).toContainText("原文来源节点声明");
    await expect(
      page.locator('[data-confirmation-key^="story-declaration:"]'),
    ).toHaveCount(0);
    await expect(row("story-assertion", relation.id)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(
      "PRIVATE later page error",
    );
    expect(laterFailures).toBeGreaterThan(0);
    await page.unroute(declarationRoute);
    await refresh();
    await expect(
      page.getByRole("tab", { name: "待确认 · 104", exact: true }),
    ).toBeVisible();

    let foreignPages = 0;
    await page.route(declarationRoute, async (route) => {
      foreignPages++;
      const response = await route.fetch(),
        raw = await response.json();
      await route.fulfill({ json: { ...raw, projectId: other.id } });
    });
    await refresh();
    await expect(page.getByRole("alert")).toContainText("原文来源节点声明");
    await expect(
      page.locator('[data-confirmation-key^="story-declaration:"]'),
    ).toHaveCount(0);
    expect(foreignPages).toBeGreaterThan(0);
    await page.unroute(declarationRoute);
    await refresh();
    await expect(
      page.getByRole("tab", { name: "待确认 · 104", exact: true }),
    ).toBeVisible();

    // A readable owner list with a live unavailable source is attention, not
    // an empty list or an available candidate. Controlled metadata only.
    let unavailableMetadata = 0;
    const assertionRoute = `**/api/v2/projects/${project.id}/story-assertions**`;
    await page.route(assertionRoute, async (route) => {
      const response = await route.fetch(),
        raw = await response.json();
      unavailableMetadata++;
      await route.fulfill({
        json: {
          ...raw,
          items: raw.items.map((item: { id: string }) =>
            item.id === relation.id
              ? {
                  ...item,
                  sourceStatus: {
                    state: "unavailable",
                    reasons: ["PRIVATE unavailable reason"],
                  },
                }
              : item,
          ),
        },
      });
    });
    await refresh();
    await expect(
      page.getByRole("tab", { name: "需要处理 · 1", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "需要处理 · 1", exact: true }).click();
    await expect(row("story-assertion", relation.id)).toContainText(
      "原来源无法核对",
    );
    await expect(page.locator("main")).not.toContainText(
      "PRIVATE unavailable reason",
    );
    expect(unavailableMetadata).toBeGreaterThan(0);
    await page.unroute(assertionRoute);
    await refresh();
    await page.getByRole("tab", { name: "待确认 · 104", exact: true }).click();

    // Owner live metadata reclassifies original candidates and actual adopted bindings.
    await client.resources.update("scripts", script.id, {
      version: script.version,
      payload: {
        剧本内容: "INT. CHANGED ROOM - DAY\n\nNEW 剧本不替代原声明。",
      },
    });
    await expect(
      page.getByRole("tab", { name: "需要处理 · 3", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "需要处理 · 3", exact: true }).click();
    await expect(row("story-assertion", relation.id)).toContainText(
      "原来源已变化",
    );
    await expect(row("story-assertion", adoptedRelation.id)).toContainText(
      "已采用来源关系复核",
    );
    await row("story-assertion", adoptedRelation.id).screenshot({
      path: info.outputPath("story-pending-adopted-stale.png"),
    });
    await client.chapters.update(chapter.id, {
      version: chapter.version,
      content: "NEW 小说不能替换原冻结段落。",
    });
    await expect(
      page.getByRole("tab", { name: "需要处理 · 106", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(row("story-declaration", adoptedNode.id)).toContainText(
      "已采用来源节点复核",
    );
    await expect(row("story-assertion", cognition.id)).toContainText(
      "原来源已变化",
    );
    await expect(row("story-declaration", discarded.id)).toHaveCount(0);
    readOnlyScan();
    expect(await client.storyIntelligence.graph(project.id)).toEqual(graph);
    expect(await client.tasks.list()).toEqual(tasks);
    expect(
      (await client.storyDeclarations.get(project.id, originalNode.id)).basis,
    ).toEqual(originalNode.basis);
    expect(
      (await client.storyAssertions.get(project.id, relation.id)).basis,
    ).toEqual(relation.basis);
    expect((await client.chapters.get(chapter.id)).content).not.toBe(
      originalChapter.content,
    );
    expect((await client.resources.get("scripts", script.id)).version).toBe(
      originalScript.version + 1,
    );
    monitoring = false;
    await row("story-declaration", originalNode.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const originalReview = page.getByLabel("原正式来源声明审阅", {
      exact: true,
    });
    await expect(originalReview).toContainText(originalNode.id);
    await expect(originalReview).toContainText("PRIVATE NOVEL SELECTED");
    await expect(originalReview).toContainText("来源 stale");
    await expect(
      originalReview.getByRole("button", {
        name: "明确采用该原声明",
        exact: true,
      }),
    ).toBeDisabled();
    await hidden();
    expect(dialogs).toBe(0);
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
