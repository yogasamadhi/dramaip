import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import {
  selectWorkspaceObject,
  openProductionStage,
  openProjectCreation,
  openProjectTool,
} from "./project-tools";

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

test("剧本入口直达本地规则检查，示例时间线与内部审片反馈贯通（不证明成片或发行）", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole("button", { name: "先看看示例" }).click();
  await expect(
    page.getByRole("heading", { name: "示例短剧：雨夜归来" }),
  ).toBeVisible();
  await openProjectCreation(page);
  await page.getByRole("button", { name: "导入已有剧本" }).click();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page
    .getByRole("textbox", { name: "项目名称" })
    .fill("P2 Gate 剧本入口");
  await page
    .getByRole("textbox", { name: "已有剧本内容" })
    .fill("【雨夜门口】\n林晚：这封信不能让任何人看见。");
  await page
    .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。")
    .check();
  await page.getByRole("button", { name: "创建单季短剧" }).click();
  await expect(
    page.getByRole("heading", { name: "剧本审查", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始审查", exact: true }).click();
  await expect(
    page.getByText(
      "已完成本地规则审查。它仅依据已保存的剧本和场景，不会冒充模型结论。",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "剧本审查", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("林晚：这封信不能让任何人看见。", { exact: true }),
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
    .getByRole("button", { name: "确认来源并生成首集" })
    .click();
  await expect(fixturePilot).toContainText("当前阶段：采用试制剧本");

  await page.getByRole("link", { name: "制作", exact: true }).click();
  await selectWorkspaceObject(page, "项目", {
    label: "示例短剧：雨夜归来",
  });
  await selectWorkspaceObject(page, "改编项目", {
    label: "雨夜归来·第一季改编方案",
  });
  await selectWorkspaceObject(page, "分集", { label: "第 1 集：雨夜敲门" });
  await selectWorkspaceObject(page, "剧本", { label: "第 1 集剧本" });
  await selectWorkspaceObject(page, "场景", { label: "场景 1：雨夜门口" });
  await selectWorkspaceObject(page, "分镜", { label: "镜头 1：门缝中的雨夜" });

  await openProductionStage(page, "导演看板");
  await expect(page.getByLabel("导演分镜看板")).toBeVisible();
  await expect(page.getByLabel("静帧预览：静帧已采用")).toBeVisible();

  await openProductionStage(page, "多轨时间线");
  const timeline = page.getByLabel("多轨时间线编辑器");
  await expect(timeline).toBeVisible();
  for (const track of ["视频", "对白", "旁白", "配乐", "音效", "字幕"])
    await expect(timeline.getByText(track, { exact: true })).toBeVisible();
  // Demo records have no actual media bytes. The product must not run an
  // empty clock; real playback is separately covered by media-playback.spec.
  await expect(
    timeline.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await timeline
    .getByRole("button", { name: "加载实际同步预览", exact: true })
    .click();
  await expect(timeline.getByRole("alert")).toContainText(
    "片段缺少明确可读素材",
  );
  await expect(
    timeline.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(
    timeline.getByRole("button", { name: "暂停", exact: true }),
  ).toHaveCount(0);

  const delivery = timeline.getByLabel("NLE 交付与媒体核验");
  for (const format of [
    "导出 FCPXML",
    "导出 OTIO",
    "导出 EDL",
    "导出重链接清单",
  ])
    await expect(delivery.getByRole("button", { name: format })).toBeVisible();
  await expect(delivery).toContainText("NLE 交付不包含 MP4 成片。");

  await page.getByRole("link", { name: "审核交付" }).click();
  await selectWorkspaceObject(page, "项目", { label: "示例短剧：雨夜归来" });
  await selectWorkspaceObject(page, "改编项目", {
    label: "雨夜归来·第一季改编方案",
  });
  await selectWorkspaceObject(page, "分集", { label: "第 1 集：雨夜敲门" });
  await page.getByRole("button", { name: "预览与修订", exact: true }).click();
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

  await page.getByText("导入已有修改稿", { exact: true }).click();
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
