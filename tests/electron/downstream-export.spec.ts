import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { ElectronApplication, Page } from "playwright";
import { electron, hostAccess, hostFetch } from "./desktop-host";
import { openCreationWizardIfQuick, quickCreateProject } from "./project-tools";

const NOVEL = [
  "# 旧书店",
  "",
  "第一章 雨夜",
  "林晚推开书店的门，雨水顺着伞尖滴落。",
  "",
  "第二章 来电",
  "电话响了，对方说出了她父亲的名字。",
  "",
].join("\n");

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-export-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test.afterEach(async () => {
  await application.close();
  await rm(userData, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const access = await hostAccess(page);
  const response = await hostFetch(`${access.baseUrl}/api/v2/${path}`, init);
  expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Only the OS save-location picker is controlled; the Host writes for real. */
async function saveTo(filePath: string) {
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, filePath);
}

test("导入按「第N章」分章的 TXT 后进入构思，并导出小说 TXT 和 Word", async () => {
  test.setTimeout(180_000);
  const source = join(userData, "旧书店.txt");
  await writeFile(source, NOVEL);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, source);
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await openCreationWizardIfQuick(page);
  await page
    .getByRole("button", { name: "导入小说或大纲", exact: true })
    .click();
  await page
    .getByRole("button", { name: "写小说 · 系列长篇", exact: true })
    .click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("旧书店");
  await page.getByRole("button", { name: "选择文件", exact: true }).click();
  await page
    .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
    .check();
  await page
    .getByRole("button", { name: "创建系列长篇并导入", exact: true })
    .click();

  // The import lands on 构思, offering to break the chapters down.
  await expect(page).toHaveURL(/#\/projects\/[^/?]+\?section=plan/);
  await expect(
    page.getByRole("button", { name: "从已导入的 2 章整理设定、人物和大纲" }),
  ).toBeVisible();
  const projectId = /#\/projects\/([^/?]+)/u.exec(page.url())![1]!;
  const chapters = await api<Array<{ title: string; content: string }>>(
    `projects/${projectId}/chapters`,
  );
  expect(chapters.map((chapter) => chapter.title)).toEqual([
    "第一章 雨夜",
    "第二章 来电",
  ]);

  // A novel-only project offers no script or video material.
  const io = page.getByRole("button", { name: "输入输出", exact: true });
  await io.click();
  await expect(
    page.getByRole("menuitem", { name: "导出剧本资料", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "导出分镜表 CSV", exact: true }),
  ).toHaveCount(0);

  const dialog = () =>
    page.getByRole("dialog", { name: "核验并导出投稿稿件", exact: true });
  const exportAs = async (item: string, filePath: string) => {
    await saveTo(filePath);
    if (!(await page.getByRole("menuitem", { name: item }).isVisible()))
      await io.click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    await dialog()
      .getByRole("button", { name: "生成稿件预览", exact: true })
      .click();
    await dialog()
      .getByRole("checkbox", {
        name: "我确认上述章节版本与范围，并有权导出这份稿件",
        exact: true,
      })
      .check();
    await dialog()
      .getByRole("button", { name: "确认范围与权利并保存稿件", exact: true })
      .click();
    await expect(dialog()).toContainText("稿件已保存并核验。");
    await dialog()
      .getByRole("button", { name: "关闭稿件预览", exact: true })
      .click();
  };

  const txt = join(userData, "旧书店.txt.export");
  await exportAs("导出小说 TXT", txt);
  const text = await readFile(txt, "utf8");
  expect(text).toContain("第一章 雨夜");
  expect(text).toContain("林晚推开书店的门");
  expect(text).not.toContain("#");

  const docx = join(userData, "旧书店.docx");
  await exportAs("导出小说 Word", docx);
  const files = unzipSync(new Uint8Array(await readFile(docx)));
  const body = strFromU8(files["word/document.xml"]!);
  expect(body).toContain("第二章 来电");
  expect(body).toContain("对方说出了她父亲的名字");
});

test("剧本页导出 Word 和 JSON", async () => {
  test.setTimeout(150_000);
  await quickCreateProject(page, "写剧本");
  await expect(page).toHaveURL(/#\/adapt\?.*stage=scripts/);
  const params = new URLSearchParams(page.url().split("?")[1]);
  const listed = await api<
    Array<{ id: string }> | { items: Array<{ id: string }> }
  >(`scripts?projectId=${params.get("projectId")}`);
  const scripts = Array.isArray(listed) ? listed : listed.items;
  expect(scripts).toHaveLength(1);
  const scriptId = params.get("scriptId") ?? scripts[0]!.id;
  const access = await hostAccess(page);
  const current = await hostFetch(
    `${access.baseUrl}/api/v2/scripts/${scriptId}/screenplay`,
  );
  expect(current.ok).toBe(true);
  const { version } = (await current.json()) as { version: number };
  await api(`scripts/${scriptId}/screenplay`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"${version}"`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      version,
      blocks: [
        {
          id: randomUUID(),
          type: "scene_heading",
          text: "内景 书店 夜",
          sceneNumber: "1",
        },
        { id: randomUUID(), type: "action", text: "雨声敲着橱窗。" },
        { id: randomUUID(), type: "character", text: "林晚" },
        { id: randomUUID(), type: "dialogue", text: "有人吗？" },
      ],
    }),
  });
  await page.reload();
  const menu = page.locator("details").filter({ hasText: "导出剧本" }).first();
  await menu.getByText("导出剧本", { exact: true }).click();

  const docx = join(userData, "第一集.docx");
  await saveTo(docx);
  await menu.getByRole("button", { name: "Word（.docx）" }).click();
  await expect(menu.getByRole("status")).toContainText("已保存");
  const xml = strFromU8(
    unzipSync(new Uint8Array(await readFile(docx)))["word/document.xml"]!,
  );
  expect(xml).toContain('<w:pStyle w:val="SceneHeading"/>');
  expect(xml).toContain("有人吗？");

  const json = join(userData, "第一集.json");
  await saveTo(json);
  await menu.getByRole("button", { name: "JSON（结构化）" }).click();
  await expect
    .poll(async () => readFile(json, "utf8").catch(() => ""))
    .toContain("雨声敲着橱窗。");
  const value = JSON.parse(await readFile(json, "utf8")) as {
    blocks: Array<{ type: string; text?: string }>;
  };
  expect(value.blocks.map((block) => block.type)).toEqual([
    "scene_heading",
    "action",
    "character",
    "dialogue",
  ]);
});
