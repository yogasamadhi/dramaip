import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-21-e2e-"));
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

test("已采用的音轨可以审查、选择采用为时间线 change set，并保护人工锁定", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page.getByRole("link", { name: "制作", exact: true }).click();
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
  await page.getByRole("button", { name: "音频制作", exact: true }).click();

  for (const [kind, label, text] of [
    ["dialogue", "雨夜对白", "你还记得我吗？"],
    ["narration", "雨夜旁白", "雨声吞没了门口的回答。"],
    ["bgm", "雨夜配乐", ""],
    ["sfx", "雨声效果", ""],
  ] as const) {
    await page.getByPlaceholder("音轨名称").fill(label);
    await page.getByLabel("音轨类别").selectOption(kind);
    await page.getByPlaceholder("起点（秒）").fill("0");
    await page.getByPlaceholder("时长（秒）").fill("2");
    await page.getByPlaceholder("对白、旁白或制作说明（可选）").fill(text);
    await page
      .getByRole("button", { name: "另存音轨草案", exact: true })
      .click();
    await expect(
      page.getByText("已另存音轨草案；采用时会再次校验当前镜头版本。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "采用此音轨", exact: true }).click();
    await expect(
      page.getByText("已采用音轨。若镜头或剧本更新，系统会将它标记为过期。"),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "多轨时间线" }).click();
  const editor = page.getByLabel("多轨时间线编辑器");
  await expect(editor).toBeVisible();
  const assembly = editor.getByLabel("自动音频字幕编排");
  await assembly.getByRole("button", { name: "审查自动编排" }).click();
  await expect(assembly.getByText(/候选 4 段 · 字幕 2 条/)).toBeVisible();
  await expect(assembly.getByText("权利待核验").first()).toBeVisible();
  await assembly.getByRole("button", { name: "采用选中的自动编排" }).click();
  await expect(
    editor.getByText(
      "已采用选中的自动编排；人工移动、裁切、音量和锁定片段保持不变。",
    ),
  ).toBeVisible();

  await editor.getByRole("button", { name: /选择片段：雨夜对白/ }).click();
  await editor.getByRole("button", { name: "锁定，保护自动编排" }).click();
  await expect(
    editor.getByText("编辑已自动保存；源媒体没有被修改。"),
  ).toBeVisible();
  await assembly.getByRole("button", { name: "审查自动编排" }).click();
  await expect(assembly.getByText(/受保护人工片段 1 个/)).toBeVisible();
});
