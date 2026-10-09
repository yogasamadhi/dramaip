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

test("三类媒体全局待确认返回指定旧预览，后台重启清空声明，新音轨另行采用，错误归属与后页失败不制造空列表或写入", async ({}, info) => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-media-pending-ui-"));
  let application: ElectronApplication | undefined;
  let page: Page;
  let client: StudioClient;
  let manager: ServerConnectionManager | undefined;
  const launch = async () => {
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
  };
  const navigate = (path: string) =>
    page!.evaluate((value) => {
      window.location.hash = value;
    }, path);
  const hidden = async () =>
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  try {
    await launch();
    await hidden();
    const { project } = await client!.projects.create({
      title: "媒体待确认实际作品",
    });
    const { project: other } = await client!.projects.create({
      title: "另一个实际项目",
    });
    const records = [];
    let parentId: string | undefined;
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ]) {
      const record = await client!.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `PRIVATE ${kind}`,
        payload: { 动作: "PRIVATE actual shot", 时长: 8 },
      });
      records.push(record);
      parentId = record.id;
    }
    const record = await client!.resources.create("shot-stills", {
      projectId: project.id,
      parentId: records[4]!.id,
      title: "PRIVATE exact media",
      payload: { 说明: "PRIVATE actual media payload" },
    });
    const source = await client!.mediaSources.preview(
      record.id,
      {
        recordVersion: record.version,
        shotId: records[4]!.id,
        shotVersion: records[4]!.version,
      },
      crypto.randomUUID(),
    );
    const newerSource = await client!.mediaSources.preview(
      record.id,
      {
        recordVersion: record.version,
        shotId: records[4]!.id,
        shotVersion: records[4]!.version,
      },
      crypto.randomUUID(),
    );
    const draft = await client!.episodeMedia.createAudioTrack({
      projectId: project.id,
      episodeId: records[1]!.id,
      kind: "narration",
      label: "PRIVATE original track",
      clips: [
        {
          shotId: records[4]!.id,
          startSeconds: 0,
          durationSeconds: 3,
          text: "PRIVATE ORIGINAL",
        },
      ],
    });
    const original = await client!.episodeMedia.adoptAudioTrack(
      draft.id,
      draft.version,
      crypto.randomUUID(),
    );
    const timeline = await client!.timeline.get(records[1]!.id);
    const assembly = await client!.timeline.audioAssemblyPreview(
      records[1]!.id,
    );
    const assembled = await client!.timeline.applyAudioAssembly(
      records[1]!.id,
      {
        timelineId: timeline.id,
        timelineVersion: assembly.timelineVersion,
        sourceFingerprint: assembly.sourceFingerprint,
        audioTrackIds: [original.id],
        includeSubtitles: true,
      },
      crypto.randomUUID(),
    );
    const revisionInput = (text: string) => ({
      sourceVersion: original.version,
      label: "PRIVATE candidate",
      kind: original.kind,
      clips: [
        {
          previousClipId: original.clips[0]!.id,
          shotId: records[4]!.id,
          startSeconds: 0,
          durationSeconds: 3,
          text,
        },
      ],
    });
    const revision = await client!.audioRevisions.preview(
      original.id,
      revisionInput("PRIVATE EXACT OLD CANDIDATE"),
      crypto.randomUUID(),
    );
    const newerRevision = await client!.audioRevisions.preview(
      original.id,
      revisionInput("PRIVATE NEWER NOT SELECTED"),
      crypto.randomUUID(),
    );
    const clip = assembled.tracks.find((track) => track.kind === "narration")!
      .clips[0]!;
    const resolutionInput = (reason: string) => ({
      timelineVersion: assembled.version,
      changes: [{ action: "remove" as const, clipId: clip.id, reason }],
    });
    const resolution = await client!.audioResolutions.preview(
      timeline.id,
      resolutionInput("PRIVATE EXACT OLD REMOVAL"),
      crypto.randomUUID(),
    );
    const newerResolution = await client!.audioResolutions.preview(
      timeline.id,
      resolutionInput("PRIVATE NEWER REMOVAL"),
      crypto.randomUUID(),
    );
    const tasks = await client!.tasks.list();
    const tracks = await client!.episodeMedia.listAudioTracks(records[1]!.id);
    const beforeSource = await client!.mediaSources.get(source.id);
    let timelineReads = 0;
    page!.on("request", (request) => {
      if (/\/episodes\/[^/]+\/timeline(?:\?|$)/u.test(request.url()))
        timelineReads++;
    });
    const center = async () => {
      await navigate(`/pending?projectId=${project.id}`);
      await expect(
        page!.getByRole("heading", { name: "待确认中心", exact: true }),
      ).toBeVisible();
      await page!
        .getByRole("button", { name: "刷新状态", exact: true })
        .click();
    };
    const item = (kind: string, id: string) =>
      page!.locator(`[data-confirmation-key="${kind}:${id}"]`);
    await center();
    for (const [kind, id] of [
      ["media-source-review", source.id],
      ["media-source-review", newerSource.id],
      ["audio-revision", revision.id],
      ["audio-revision", newerRevision.id],
      ["audio-resolution", resolution.id],
      ["audio-resolution", newerResolution.id],
    ])
      await expect(item(kind!, id!)).toBeVisible();
    await expect(
      page!.getByRole("tabpanel", { name: "待确认项目列表" }),
    ).not.toContainText("PRIVATE");
    await item("media-source-review", source.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(page!.getByLabel("对应媒体待确认对象")).toContainText(
      source.id,
    );
    await expect(page!.getByLabel("复核历史")).toHaveValue(source.id);
    for (const check of await page!
      .getByTestId("media-source-review-diff")
      .getByRole("checkbox")
      .all())
      await expect(check).not.toBeChecked();
    await page!
      .getByTestId("media-source-review-diff")
      .screenshot({ path: info.outputPath("exact-source.png") });
    await center();
    await item("audio-resolution", resolution.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(page!.getByTestId("audio-resolution-diff")).toContainText(
      resolution.id,
    );
    await expect(page!.getByTestId("audio-resolution-diff")).toContainText(
      "PRIVATE EXACT OLD REMOVAL",
    );
    await expect(page!.getByTestId("audio-resolution-diff")).not.toContainText(
      "PRIVATE NEWER REMOVAL",
    );
    await page!
      .getByTestId("audio-resolution-diff")
      .screenshot({ path: info.outputPath("exact-resolution.png") });
    await center();
    await item("audio-revision", revision.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const exactPath = `/produce?${new URLSearchParams({ projectId: project.id, episodeId: records[1]!.id, audioRevisionId: revision.id, sourceTrackId: original.id })}`;
    await expect(page!.getByTestId("audio-revision-diff")).toContainText(
      "PRIVATE EXACT OLD CANDIDATE",
    );
    await expect(page!.getByTestId("audio-revision-diff")).not.toContainText(
      "PRIVATE NEWER NOT SELECTED",
    );
    for (const check of await page!
      .getByTestId("audio-revision-diff")
      .getByRole("checkbox")
      .all())
      await check.check();
    expect(await client!.tasks.list()).toEqual(tasks);
    expect(await client!.episodeMedia.listAudioTracks(records[1]!.id)).toEqual(
      tracks,
    );
    expect(await client!.mediaSources.get(source.id)).toEqual(beforeSource);
    expect(await client!.timeline.get(records[1]!.id)).toEqual(assembled);
    expect(timelineReads).toBe(0);
    await hidden();
    manager!.disconnect();
    await application!.close();
    application = undefined;
    await launch();
    await navigate(exactPath);
    await expect(page!.getByTestId("audio-revision-diff")).toContainText(
      revision.id,
    );
    const checkboxes = page!
      .getByTestId("audio-revision-diff")
      .getByRole("checkbox");
    await expect(checkboxes).toHaveCount(3);
    for (const check of await checkboxes.all())
      await expect(check).not.toBeChecked();
    await expect(
      page!.getByRole("button", {
        name: "确认修订并生成新草稿",
        exact: true,
      }),
    ).toBeDisabled();
    await page!
      .getByTestId("audio-revision-diff")
      .screenshot({ path: info.outputPath("exact-revision-restarted.png") });
    for (const wrong of [
      `/produce?${new URLSearchParams({ projectId: other.id, audioRevisionId: revision.id })}`,
      `/produce?${new URLSearchParams({ projectId: project.id, mediaSourceReviewId: source.id, recordId: crypto.randomUUID() })}`,
      `/produce?${new URLSearchParams({ projectId: project.id, audioResolutionId: resolution.id, timelineId: crypto.randomUUID() })}`,
      `/produce?${new URLSearchParams({ projectId: project.id, audioRevisionId: revision.id, audioResolutionId: resolution.id })}`,
    ]) {
      await navigate(wrong);
      await expect(page!.getByRole("alert")).toBeVisible();
      await expect(page!.getByLabel("对应媒体待确认对象")).not.toContainText(
        "PRIVATE",
      );
      await expect(page!.getByRole("checkbox")).toHaveCount(0);
    }
    await navigate(exactPath);
    await expect(page!.getByTestId("audio-revision-diff")).toContainText(
      revision.id,
    );
    for (const check of await page!
      .getByTestId("audio-revision-diff")
      .getByRole("checkbox")
      .all())
      await check.check();
    await page!
      .getByRole("button", { name: "确认修订并生成新草稿", exact: true })
      .click();
    await expect(
      page!.getByRole("button", { name: "另行采用此新草稿", exact: true }),
    ).toBeEnabled();
    const confirmed = await client!.audioRevisions.get(revision.id);
    expect(confirmed.state).toBe("confirmed");
    expect(
      (await client!.episodeMedia.listAudioTracks(records[1]!.id)).find(
        (track) => track.id === confirmed.targetTrackId,
      )?.status,
    ).toBe("draft");
    await center();
    await expect(item("audio-revision", revision.id)).toContainText(
      "新草稿待采用",
    );
    await item("audio-revision", revision.id)
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await page!
      .getByRole("button", { name: "另行采用此新草稿", exact: true })
      .click();
    await expect(page!.getByRole("status")).toContainText("已另行采用");
    await center();
    await expect(item("audio-revision", revision.id)).toHaveCount(0);
    expect(await client!.timeline.get(records[1]!.id)).toEqual(assembled);
    expect(await client!.tasks.list()).toEqual(tasks);
    // Controlled second-page failure exercises honest partial counts; no writes or fake business result.
    await page!.route(
      `**/api/v2/projects/${project.id}/media-source-review-summaries**`,
      async (route) => {
        if (new URL(route.request().url()).searchParams.has("cursor"))
          await route.fulfill({
            status: 503,
            json: { title: "controlled second page unavailable" },
          });
        else
          await route.fulfill({
            json: {
              items: (
                await client!.mediaSources.summaries(project.id)
              ).items.slice(0, 1),
              nextCursor: "controlled-next",
            },
          });
      },
    );
    await page!.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect(page!.getByRole("alert")).toContainText("计数未核全");
    await expect(
      page!.getByRole("tab", { name: "待确认 · 未核全", exact: true }),
    ).toBeVisible();
    await page!.unrouteAll({ behavior: "wait" });
    await center();
    await client!.audioResolutions.discard(
      resolution.id,
      resolution.stateVersion,
      crypto.randomUUID(),
    );
    await client!.mediaSources.discard(
      source.id,
      source.stateVersion,
      crypto.randomUUID(),
    );
    await page!.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect(item("audio-resolution", resolution.id)).toHaveCount(0);
    await expect(item("media-source-review", source.id)).toHaveCount(0);
    await hidden();
  } finally {
    manager?.disconnect();
    if (application) await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("待确认中心隔离项目、定位真实 Story Bible 与全局任务，读取失败不冒充空列表", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-pending-confirmation-"),
  );
  let application: ElectronApplication | undefined;
  let page: Page;
  try {
    const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
    });
    page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const json = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
          ...(body === undefined
            ? {}
            : { "Idempotency-Key": crypto.randomUUID() }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok, await response.clone().text()).toBe(true);
      return (await response.json()) as T;
    };
    const first = await json<{ project: { id: string } }>("projects", {
      title: "第一份作品",
      mode: "series_longform",
    });
    const second = await json<{ project: { id: string } }>("projects", {
      title: "第二份作品",
      mode: "series_longform",
    });
    const firstChapter = await json<{ id: string; version: number }>(
      "chapters",
      {
        projectId: first.project.id,
        title: "原稿章节",
        content: "小禾打开旧书店的木门，母亲留下一枚铜钥匙。",
      },
    );
    const otherChapter = await json<{ id: string }>("chapters", {
      projectId: second.project.id,
      title: "另一份原稿",
      content: "林舟在河岸找到一封未寄出的信。",
    });
    const bible = await json<{ id: string; status: string; updatedAt: string }>(
      "story-bible/change-sets",
      { projectId: first.project.id, chapterId: firstChapter.id },
    );
    const otherBible = await json<{ id: string }>("story-bible/change-sets", {
      projectId: second.project.id,
      chapterId: otherChapter.id,
    });
    const revision = await json<{ id: string }>("revisions", {
      chapterId: firstChapter.id,
      proposedContent: "作者需确认的修订草案。",
      rationale: "兼容旧修订预览",
    });
    const newerRevision = await json<{ id: string }>("revisions", {
      chapterId: firstChapter.id,
      proposedContent: "另一份修订候选，不能代替指定旧候选。",
    });
    const tasksBefore = await json<unknown[]>("tasks");
    // Generic task creation is intentionally forbidden. These read-only task
    // fixtures test global/project routing, not task execution or recovery.
    const globalTask = {
      id: crypto.randomUUID(),
      kind: "routing-fixture",
      title: "全局待执行任务",
      status: "queued",
      attentionStatus: "open",
      resultStatus: "none",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const projectTask = {
      ...globalTask,
      id: crypto.randomUUID(),
      projectId: second.project.id,
      title: "第二份作品的待执行任务",
    };
    await page.route("**/api/v2/tasks", async (route) => {
      await route.fulfill({ json: [...tasksBefore, globalTask, projectTask] });
    });
    const open = async (path: string) => {
      await page.evaluate((route) => {
        window.location.hash = route;
      }, `#${path}`);
    };
    await open(`/pending?projectId=${first.project.id}`);
    await expect(
      page.getByRole("heading", { name: "待确认中心", exact: true }),
    ).toBeVisible();
    const firstItem = page.locator(
      `[data-confirmation-key="story-bible:${bible.id}"]`,
    );
    await expect(firstItem).toContainText("第一份作品");
    const revisionItem = page.locator(
      `[data-confirmation-key="revision:${revision.id}"]`,
    );
    await expect(revisionItem).toContainText("章节修订候选");
    await revisionItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(
      page.getByLabel("对应待确认对象", { exact: true }),
    ).toContainText("作者需确认的修订草案。");
    await expect(
      page.getByLabel("对应待确认对象", { exact: true }),
    ).not.toContainText("另一份修订候选");
    expect(
      (await json<{ status: string }>(`revisions/${revision.id}`)).status,
    ).toBe("pending");
    await open(
      `/tasks?projectId=${second.project.id}&revisionId=${revision.id}`,
    );
    const wrongRevision = page.getByLabel("对应待确认对象", { exact: true });
    await expect(wrongRevision.getByRole("alert")).toContainText(
      "指定修订与实际项目／任务绑定不符；未打开候选。",
    );
    await expect(wrongRevision).not.toContainText("作者需确认的修订草案。");
    expect(await page.evaluate(() => window.location.hash.slice(1))).toBe(
      `/tasks?projectId=${second.project.id}&revisionId=${revision.id}`,
    );
    await open(
      `/create?projectId=${first.project.id}&changeSetId=${otherBible.id}`,
    );
    await expect(page.getByRole("alert")).toContainText(
      "指定变更已删除或不属于此项目",
    );
    await expect(page.locator("[data-change-set-id]")).toHaveCount(0);
    await open(`/pending?projectId=${first.project.id}`);
    await expect(
      page.locator(`[data-confirmation-key="story-bible:${otherBible.id}"]`),
    ).toHaveCount(0);
    await firstItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(
      page.locator(`[data-change-set-id="${bible.id}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-change-set-id="${otherBible.id}"]`),
    ).toHaveCount(0);
    expect(
      (
        await json<Array<{ id: string; status: string }>>(
          `projects/${first.project.id}/story-bible/change-sets`,
        )
      ).find((item) => item.id === bible.id)?.status,
    ).toBe(bible.status);
    expect(
      (await json<{ version: number }>(`chapters/${firstChapter.id}`)).version,
    ).toBe(firstChapter.version);
    await open("/pending?category=running");
    await expect(
      page.getByRole("link", { name: "任务历史与配置", exact: true }),
    ).toHaveAttribute("href", "#/tasks?scope=all");
    const globalItem = page.locator(
      `[data-confirmation-key="task:${globalTask.id}"]`,
    );
    await expect(globalItem).toContainText("全局任务");
    await expect(
      page.locator(`[data-confirmation-key="task:${projectTask.id}"]`),
    ).toContainText("第二份作品");
    await globalItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const selected = page.getByLabel("对应待确认对象", { exact: true });
    await expect(
      selected.locator(`[data-task-id="${globalTask.id}"]`),
    ).toContainText("全局待执行任务");
    await expect(selected).not.toContainText("不属于当前项目");
    expect(await json<unknown[]>("tasks")).toEqual(tasksBefore);
    // Story Bible, revision and chapter writes use the actual Runtime. Only
    // the task routing fixtures and this unavailable-read case are controlled.
    await page.route(
      `**/api/v2/projects/${first.project.id}/story-bible/change-sets`,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: {
            type: "about:blank",
            title: "暂时不可用",
            status: 503,
            code: "SERVICE_UNAVAILABLE",
          },
        });
      },
    );
    await open(`/pending?projectId=${first.project.id}`);
    await expect(page.getByRole("alert")).toContainText("计数未核全");
    await expect(
      page.getByRole("tab", { name: "待确认 · 未核全", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("此分类没有待处理项。", { exact: false }),
    ).toHaveCount(0);
    await page.unroute(
      `**/api/v2/projects/${first.project.id}/story-bible/change-sets`,
    );
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await expect(firstItem).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await firstItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const biblePanel = page.locator(`[data-change-set-id="${bible.id}"]`);
    await expect(
      biblePanel.getByRole("button", { name: "采用", exact: true }),
    ).toBeVisible();
    // Only an explicit source edit changes the author draft. The read model
    // then reports conflict without mutating the stored revision history.
    const edit = await fetch(
      `${bootstrap.baseUrl}/api/v2/chapters/${firstChapter.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bootstrap.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: firstChapter.version,
          content: "作者明确修改的新原稿，不能被旧候选覆盖。",
        }),
      },
    );
    expect(edit.ok, await edit.clone().text()).toBe(true);
    const edited = await edit.json();
    // The open review panel reacts to the real Writing event. Its lifecycle
    // still says draft: freshness is derived, never a read-side mutation.
    await expect(biblePanel.getByRole("alert")).toContainText("来源版本已变化");
    await expect(
      biblePanel.getByRole("button", { name: "采用", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await json<
          Array<{
            id: string;
            status: string;
            sourceState: string;
            updatedAt: string;
          }>
        >(`projects/${first.project.id}/story-bible/change-sets`)
      ).find((item) => item.id === bible.id),
    ).toMatchObject({
      status: bible.status,
      sourceState: "stale",
      updatedAt: bible.updatedAt,
    });
    await open(`/pending?projectId=${first.project.id}&category=attention`);
    await expect(firstItem).toContainText("来源版本已变化");
    await expect(revisionItem).toContainText("来源版本冲突");
    await revisionItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    const conflicted = page.getByLabel("对应待确认对象", { exact: true });
    await expect(conflicted).toContainText("版本冲突");
    await expect(
      conflicted.getByRole("button", { name: "确认采用修订", exact: true }),
    ).toHaveCount(0);
    expect(
      (await json<{ status: string }>(`revisions/${revision.id}`)).status,
    ).toBe("pending");
    await conflicted
      .getByRole("button", { name: "放弃此预览", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "确认危险操作",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    const bounds = await confirmation.boundingBox();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThan(viewportWidth / 2);
    expect(bounds!.height).toBeLessThan(400);
    await confirmation
      .getByRole("button", { name: "确认继续", exact: true })
      .click();
    await expect(conflicted).toContainText("已放弃");
    expect(
      (await json<{ status: string }>(`revisions/${revision.id}`)).status,
    ).toBe("discarded");
    expect(await json(`chapters/${firstChapter.id}`)).toEqual(edited);
    await open(`/pending?projectId=${first.project.id}&category=attention`);
    await expect(revisionItem).toHaveCount(0);
    await expect(
      page.locator(`[data-confirmation-key="revision:${newerRevision.id}"]`),
    ).toContainText("来源版本冲突");
    await firstItem
      .getByRole("link", { name: "返回对应对象", exact: true })
      .click();
    await expect(biblePanel.getByRole("alert")).toContainText("来源版本已变化");
    await biblePanel.getByRole("button", { name: "丢弃", exact: true }).click();
    await expect(biblePanel).toContainText("已撤销");
    expect(await json(`chapters/${firstChapter.id}`)).toEqual(edited);
    expect(
      await json(`chapter-memories?projectId=${first.project.id}`),
    ).toEqual([]);
    await open(`/pending?projectId=${first.project.id}&category=attention`);
    await expect(firstItem).toHaveCount(0);
    await expect(
      page.locator(`[data-confirmation-key="revision:${newerRevision.id}"]`),
    ).toContainText("来源版本冲突");
    await page.screenshot({
      path: test.info().outputPath("pending-confirmation.png"),
      fullPage: true,
    });
  } finally {
    await application?.close();
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
