import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { selectWorkspaceObject, openProductionStage } from "./project-tools";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-12-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("静帧 Gate 未通过时桌面端不会发出视频提交", async () => {
  const page = await application.firstWindow();
  let videoSubmissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v2/video-generation/runs")
    )
      videoSubmissions += 1;
  });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page.getByRole("link", { name: "制作" }).click();
  await selectWorkspaceObject(page, "分镜", { label: "镜头 1：门缝中的雨夜" });
  await openProductionStage(page, "视频制作");
  await expect(
    page.getByRole("heading", { name: "视频生成与候选采用" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交视频生成" }),
  ).toBeDisabled();
  await expect(page.getByText("静帧优先预检")).toBeVisible();
  expect(videoSubmissions).toBe(0);
});

test("视频预检实际阻断分配的未采用未锁定资产及超出声明能力的时长，未知权利不称已核验且全程无提交", async ({}, info) => {
  test.setTimeout(90000);
  const page = await application.firstWindow();
  const bootstrap = await page.evaluate(() =>
    window.runtimeBootstrap.resolve(),
  );
  const manager = new ServerConnectionManager();
  await manager.attach({ ...bootstrap, source: "spawned" });
  const client = createStudioClient(manager.createTransport());
  let submissions = 0;
  const observe = (request: import("playwright").Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v2/video-generation/runs")
    )
      submissions++;
  };
  page.on("request", observe);
  try {
    const { project } = await client.projects.create({
      title: "M4 实际视频 Gate（不生成媒体）",
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
      const record = await client.resources.create(kind, {
        projectId: project.id,
        parentId,
        title: `Gate 实际 ${kind}`,
        payload: { 动作: "受控作者动作", 时长: 5 },
      });
      records.push(record);
      parentId = record.id;
    }
    const shot = records[4]!;
    const still = await client.resources.create("shot-stills", {
      projectId: project.id,
      parentId: shot.id,
      title: "Gate 实际静帧元数据",
      payload: {},
    });
    await client.visuals.adoptStill(still.id);
    const asset = await client.resources.create("visual-assets", {
      projectId: project.id,
      title: "Gate 未采用未锁定资产",
      payload: { 镜头用途: [shot.id] },
    });
    const provider = await client.resources.create("providers", {
      title: "M4 受控声明能力（不调用）",
      payload: {
        服务类型: "媒体生成",
        模型名称: "MiniMax-H3",
        调用协议: "minimax-h3-cloud",
        服务地址: "https://provider.invalid",
        凭据引用: "m4-no-real-credential",
        单次预估费用: 0,
        费用币种: "CNY",
      },
    });
    expect(
      (await client.resources.list("providers")).some(
        (record) => record.id === provider.id,
      ),
    ).toBe(true);
    await page.evaluate((projectId) => {
      window.location.hash = `#/produce?projectId=${projectId}`;
    }, project.id);
    // The first test already read the empty provider directory. The setup SDK
    // is outside the Renderer cache; reopen this isolated page to read the
    // actual new owner records instead of assuming that cache was invalidated.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    for (const [name, index] of [
      ["改编项目", 0],
      ["分集", 1],
      ["剧本", 2],
      ["场景", 3],
      ["分镜", 4],
    ] as const)
      await selectWorkspaceObject(page, name, records[index]!.id);
    await openProductionStage(page, "视频制作");
    const panel = page.getByLabel("镜头视频提交前检查", { exact: true });
    await panel
      .getByLabel("视频生成服务商", { exact: true })
      .selectOption(provider.id);
    await panel
      .getByLabel("视频生成提示", { exact: true })
      .fill("M4 只检查，不请求模型或生成媒体");
    await panel
      .getByRole("button", { name: "检查静帧与视频预检", exact: true })
      .click();
    await expect(panel).toContainText("尚未明确采用");
    await expect(panel).toContainText("尚未锁定");
    await expect(
      panel.getByRole("button", { name: "提交视频生成", exact: true }),
    ).toBeDisabled();
    await expect(panel).toContainText("未知权利仍未核验");
    await client.assetCenter.action(asset.id, {
      action: "adopt",
      version: asset.version,
    });
    const adopted = await client.resources.get("visual-assets", asset.id);
    await client.assetCenter.action(asset.id, {
      action: "lock",
      version: adopted.version,
    });
    await panel.getByLabel("视频生成时长（秒）", { exact: true }).fill("60");
    await panel
      .getByRole("button", { name: "检查静帧与视频预检", exact: true })
      .click();
    await expect(panel).toContainText("请求时长超出服务商声明能力");
    await expect(panel).not.toContainText("尚未锁定");
    await expect(
      panel.getByRole("button", { name: "提交视频生成", exact: true }),
    ).toBeDisabled();
    expect(submissions).toBe(0);
    expect(await client.videoGeneration.listByShot(shot.id)).toEqual([]);
    const windows = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
    await panel.screenshot({
      path: info.outputPath("m4-media-actual-gate-blocked.png"),
    });
  } finally {
    page.off("request", observe);
    manager.disconnect();
  }
});
