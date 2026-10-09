import { test, expect } from "@playwright/test";
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
test("后台整包审片冻结全部原轨道，旧预检拒绝、原键丢回复恢复与未解决意见阻断；来源变动不批准当前交付", async ({}, info) => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), "dramaip-bound-review-ui-"));
  let app: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined,
    page: Page,
    client: StudioClient,
    posts = 0,
    reads = 0;
  const launch = async () => {
    app = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: dir,
        DRAMAIP_DEBUG_BACKGROUND: "1",
      },
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1200 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (r.method() === "POST" && p.endsWith("/media-review-packages"))
        posts++;
      if (r.method() === "GET" && p.includes("/media-review-requests/"))
        reads++;
    });
    manager = new ServerConnectionManager();
    await manager.attach({
      ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
      source: "spawned",
    });
    client = createStudioClient(manager.createTransport());
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  try {
    await launch();
    const { project } = await client.projects.create({
      title: "整包原审片后台",
    });
    let parentId: string | undefined;
    const nodes = [];
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
    ] as const) {
      const n = await client.resources.create(kind, {
        projectId: project.id,
        ...(parentId ? { parentId } : {}),
        title: kind,
        payload: { 时长: 2 },
      });
      nodes.push(n);
      parentId = n.id;
    }
    const episode = nodes[1]!,
      shot = nodes[4]!,
      adaptation = nodes[0]!;
    const asset = await client.resources.create("video", {
      projectId: project.id,
      parentId: shot.id,
      title: "审片原素材元数据",
      payload: {
        mediaRef: crypto.randomUUID(),
        sha256: "a".repeat(64),
        rightsStatus: "revoked",
        providerStatus: "unavailable",
        费用状态: "已知",
        privatePrompt: "PRIVATE must never appear in review evidence",
      },
    });
    const initial = await client.timeline.get(episode.id),
      clip = initial.tracks.find((t) => t.kind === "video")!.clips[0]!;
    const linked = await client.timeline.command(initial.id, {
      version: initial.version,
      command: { type: "relink", clipId: clip.id, assetId: asset.id },
    });
    const route = `/review?${new URLSearchParams({ projectId: project.id, adaptationId: adaptation.id, episodeId: episode.id, stage: "review" })}`,
      navigate = () =>
        page.evaluate((p) => {
          window.location.hash = p;
        }, route),
      panel = () => page.getByTestId(`media-review-${episode.id}`);
    await navigate();
    await expect(panel()).toBeVisible();
    expect(posts).toBe(0);
    await panel()
      .getByRole("button", { name: "核对本轮整包来源", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-preview")).toBeVisible();
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    await panel().getByRole("checkbox").check();
    await client.resources.update("episodes", episode.id, {
      version: episode.version,
      title: "后来的分集",
    });
    await panel()
      .getByRole("button", { name: "创建原版本整包审片包", exact: true })
      .click();
    await expect(
      panel().getByRole("button", {
        name: "保留原拒绝记录，重新核对审片来源",
        exact: true,
      }),
    ).toBeVisible();
    await panel()
      .getByRole("button", {
        name: "保留原拒绝记录，重新核对审片来源",
        exact: true,
      })
      .click();
    await panel()
      .getByRole("button", { name: "核对本轮整包来源", exact: true })
      .click();
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    await panel().getByRole("checkbox").check();
    let accepted = false;
    await page.route(
      "**/api/v2/episodes/*/media-review-packages",
      async (r) => {
        const result = await r.fetch();
        expect(result.status()).toBe(201);
        accepted = true;
        await r.abort();
      },
    );
    await panel()
      .getByRole("button", { name: "创建原版本整包审片包", exact: true })
      .click();
    await expect(panel().getByRole("status")).toContainText(
      "原创建结果未能核对",
    );
    expect(accepted).toBe(true);
    expect(posts).toBe(2);
    await page.unroute("**/api/v2/episodes/*/media-review-packages");
    await page.reload();
    await expect(panel().getByRole("status")).toContainText("已核对原整包");
    expect(posts).toBe(2);
    expect(reads).toBeGreaterThan(0);
    await expect(panel().getByTestId("media-review-preview")).toHaveCount(0);
    const packs = await client.reviewEditor.listPackages(episode.id);
    expect(packs).toHaveLength(1);
    const pack = packs[0]!;
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "pending",
    );
    await page.getByLabel("审片决定", { exact: true }).selectOption("approve");
    await page
      .getByRole("button", { name: "保存审片决定", exact: true })
      .click();
    await expect(
      page.getByText("审片决定已保存，可作为后续返工和交付复核依据。", {
        exact: true,
      }),
    ).toBeVisible();
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "approved",
    );
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "releaseReady=false",
    );
    const ownerEvidence = panel().getByRole("region", {
      name: "原包逐素材owner证据",
      exact: true,
    });
    await expect(ownerEvidence).toContainText("DECLARED_RIGHTS_RESTRICTED");
    await expect(ownerEvidence).toContainText("DECLARED_PROVIDER_UNAVAILABLE");
    await expect(ownerEvidence).toContainText("ORIGINAL_ARCHIVE_UNBOUND");
    await ownerEvidence.locator("summary").click();
    await expect(ownerEvidence).toContainText("用户声明已知（不是结算回执）");
    await expect(ownerEvidence).toContainText("当前文件未读取");
    await expect(ownerEvidence).not.toContainText("PRIVATE");
    const evidenceRoute = `**/api/v2/review-packages/${pack.id}/delivery-evidence?*`;
    await page.route(evidenceRoute, (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 503, title: "原证据读取失败" }),
      }),
    );
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByRole("status")).toContainText(
      "原审片请求或资料未能核对",
    );
    await expect(panel().getByTestId("media-review-evidence")).toHaveCount(0);
    await page.unroute(evidenceRoute);
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(ownerEvidence).toContainText("DECLARED_RIGHTS_RESTRICTED");
    const comment = await client.reviewEditor.createComment(pack.id, {
      shotId: shot.id,
      body: "真实未解决意见",
    });
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "UNRESOLVED_COMMENT",
    );
    await client.reviewEditor.resolveComment(comment.id, true);
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "approved",
    );
    await client.timeline.command(linked.id, {
      version: linked.version,
      command: {
        type: "set-track-audio",
        trackId: linked.tracks[0]!.id,
        muted: true,
      },
    });
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "SOURCE_CHANGED",
    );
    const originalExport = await client.mediaReview.exportOriginal(pack.id, {
      projectId: project.id,
      episodeId: episode.id,
    });
    expect(
      JSON.parse(originalExport.content).original.snapshot.delivery.timeline,
    ).toEqual(linked);
    expect(originalExport.content).not.toContain("requestKey");
    await panel().screenshot({
      path: info.outputPath("original-review-not-release.png"),
    });
    await manager!.disconnect();
    manager = undefined;
    await app!.close();
    app = undefined;
    await launch();
    await navigate();
    await expect(panel()).toBeVisible();
    expect(posts).toBe(2);
    await expect(panel().getByTestId("media-review-evidence")).toHaveCount(0);
    await page.getByLabel("当前审片包", { exact: true }).selectOption(pack.id);
    await panel()
      .getByRole("button", { name: "核对当前包审片门", exact: true })
      .click();
    await expect(panel().getByTestId("media-review-evidence")).toContainText(
      "stale",
    );
    expect(
      (
        await client.mediaReview.exportOriginal(pack.id, {
          projectId: project.id,
          episodeId: episode.id,
        })
      ).content,
    ).toBe(originalExport.content);
  } finally {
    await manager?.disconnect();
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
