import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { openProjectTool } from "./project-tools";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-25-e2e-"));
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

test("P2 Gate：剧本入口可恢复到试制，完整本地样片可播放、交付并保留审片反馈", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole("button", { name: "先看看示例" }).click();
  await expect(
    page.getByRole("heading", { name: "示例短剧：雨夜归来" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page.getByRole("button", { name: /直接写剧本/ }).click();
  await page
    .getByRole("textbox", { name: "项目名称" })
    .fill("P2 Gate 剧本入口");
  await page
    .getByRole("textbox", { name: "首集剧本" })
    .fill("【雨夜门口】\n林晚：这封信不能让任何人看见。");
  await page.getByRole("button", { name: "创建单季短剧" }).click();
  await openProjectTool(page, "试制计划");

  const inputPilot = page.getByLabel("试制向导");
  await expect(
    inputPilot.getByRole("checkbox", {
      name: "来源章节：第 1 集剧本草稿",
    }),
  ).toBeChecked();
  await inputPilot.getByRole("button", { name: "建立试制计划" }).click();
  await inputPilot
    .getByRole("button", { name: "确认来源并创建试制分集" })
    .click();
  await expect(inputPilot).toContainText("当前阶段：采用试制剧本");
  await expect(
    inputPilot.getByRole("link", { name: "前往唯一待办" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "尽意项目首页" }).click();
  await expect(page.getByText("示例短剧：雨夜归来")).toBeVisible();
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("link", { name: "雨夜归来" }).click();
  await openProjectTool(page, "试制计划");

  const fixturePilot = page.getByLabel("试制向导");
  await expect(fixturePilot.getByRole("checkbox").first()).toBeChecked();
  await fixturePilot.getByRole("button", { name: "建立试制计划" }).click();
  await fixturePilot
    .getByRole("button", { name: "确认来源并创建试制分集" })
    .click();
  await expect(fixturePilot).toContainText("当前阶段：采用试制剧本");

  await page.getByRole("link", { name: "制作", exact: true }).click();
  await page
    .getByLabel(/^项目选择项目/)
    .selectOption({ label: "示例短剧：雨夜归来" });
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await page
    .getByRole("combobox", { name: "剧本" })
    .selectOption({ label: "第 1 集剧本" });
  await page
    .getByRole("combobox", { name: "场景" })
    .selectOption({ label: "场景 1：雨夜门口" });
  await page
    .getByRole("combobox", { name: "分镜" })
    .selectOption({ label: "镜头 1：门缝中的雨夜" });

  await page.getByRole("button", { name: "导演看板" }).click();
  await expect(page.getByLabel("导演分镜看板")).toBeVisible();
  await expect(page.getByLabel("静帧预览：静帧已采用")).toBeVisible();

  await page.getByRole("button", { name: "多轨时间线" }).click();
  const timeline = page.getByLabel("多轨时间线编辑器");
  await expect(timeline).toBeVisible();
  for (const track of ["视频", "对白", "旁白", "配乐", "音效", "字幕"])
    await expect(timeline.getByText(track, { exact: true })).toBeVisible();
  await timeline.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    timeline.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await timeline.getByRole("button", { name: "暂停", exact: true }).click();

  const delivery = timeline.getByLabel("已验证 NLE 交付");
  for (const format of [
    "导出 FCPXML",
    "导出 OTIO",
    "导出 EDL",
    "导出重链接清单",
  ])
    await expect(delivery.getByRole("button", { name: format })).toBeVisible();
  await expect(delivery).toContainText(
    "当前目录未声明该能力，因此未生成或伪造成片。",
  );

  await page.getByRole("link", { name: "审核交付" }).click();
  await page
    .getByRole("combobox", { name: "项目", exact: true })
    .selectOption({ label: "示例短剧：雨夜归来" });
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await page.getByRole("button", { name: "审片", exact: true }).click();
  await page.getByRole("button", { name: "创建离线审片包" }).click();
  await expect(
    page.getByText("已创建离线审片包记录；可以导出单文件审阅页分发给审片人。"),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "关联分镜" })
    .selectOption({ label: "镜头 1：门缝中的雨夜" });
  await page.getByLabel("时间码（秒）").fill("1.5");
  await page.getByLabel("署名（可选）").fill("本地审片人");
  await page.getByLabel("审阅意见").fill("请给反应镜头多留一秒。");
  await page.getByRole("button", { name: "保存审阅意见" }).click();
  await expect(page.getByText("请给反应镜头多留一秒。")).toBeVisible();
  await page
    .getByRole("combobox", { name: "决定", exact: true })
    .selectOption("request_changes");
  await page.getByLabel("决定说明（可选）").fill("补充反应镜头。");
  await page.getByRole("button", { name: "保存审片决定" }).click();
  await expect(page.getByText("需要修改 · 本地审片人")).toBeVisible();

  await page
    .getByLabel("修订草案")
    .fill("【雨夜门口】\n林晚先观察门外的反应，再打开门。");
  await page.getByRole("button", { name: "创建待确认修订预览" }).click();
  await expect(
    page.getByText("已创建待确认修订预览；正式剧本尚未改写。"),
  ).toBeVisible();
  await expect(page.getByText("尚未配置", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/仅上传下方明确选择的媒体。令牌只进入本机加密凭据库/),
  ).toBeVisible();
});
