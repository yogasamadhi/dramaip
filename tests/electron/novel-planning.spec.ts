import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ElectronApplication, Page } from "playwright";
import { electron } from "./desktop-host";
import { quickCreateProject } from "./project-tools";

const MODEL = "controlled-planning-fixture-v1";
const KEY = "only-a-local-controlled-fixture-not-a-provider-key";

/** A local model that answers the planning prompts with fixed drafts. */
async function planningModel() {
  const calls: Array<{ kind: string; prompt: string }> = [];
  let characterDrafts = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      messages: Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;
    };
    const prompt = body.messages
      .filter((message) => message.role === "user")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => part.text ?? "").join("\n"),
      )
      .join("\n");
    let kind: string;
    let output: unknown;
    if (prompt.includes("审阅候选与冻结")) {
      kind = "check";
      output = { issues: [] };
    } else if (prompt.includes("kind 为 story-setup")) {
      kind = "setup";
      output = {
        title: "旧书店",
        content: "",
        items: [
          {
            ref: "setup",
            kind: "story-setup",
            title: "旧书店",
            data: {
              题材类型: "都市温情",
              故事梗概: "失业程序员林晚继承了一家快倒闭的旧书店。",
              世界观与规则: "旧书能映出读者的心事。",
              核心钩子: "能读心的旧书店",
              情感内核: "学会求助",
              目标读者: "年轻上班族",
            },
          },
        ],
      };
    } else if (prompt.includes("items 的 kind 为 characters")) {
      kind = "characters";
      characterDrafts++;
      output = {
        title: "人物",
        content: "",
        items: [
          {
            ref: "lin",
            kind: "characters",
            title: characterDrafts === 1 ? "林晚" : "林晚（果断版）",
            data: { 角色定位: "主角", 欲望与目标: "让书店活下去" },
          },
        ],
      };
    } else if (prompt.includes("items 的 kind 为 outlines")) {
      kind = "outline";
      output = {
        title: "全书大纲",
        content: "",
        items: [
          {
            ref: "book",
            kind: "outlines",
            title: "旧书店全书大纲",
            data: {
              大纲层级: "全书",
              内容: "开端接手书店；发展发现旧书秘密；高潮守住书店；结局学会求助。",
            },
          },
        ],
      };
    } else {
      kind = "unexpected";
      output = { title: "", content: "", items: [] };
    }
    calls.push({ kind, prompt });
    const id = `controlled-${randomUUID()}`;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: 1,
          model: MODEL,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    chunk({ role: "assistant", content: JSON.stringify(output) });
    chunk({}, "stop");
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture did not bind to loopback");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

async function configureModel(
  application: ElectronApplication,
  page: Page,
  url: string,
) {
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "服务商", exact: true })
    .selectOption("other");
  await page
    .getByRole("textbox", { name: "服务商名称", exact: true })
    .fill("本地受控构思接口");
  await page
    .getByRole("textbox", { name: "模型名称", exact: true })
    .fill(MODEL);
  await page.getByRole("textbox", { name: "服务地址", exact: true }).fill(url);
  // The credential store opens a moment after the app starts.
  await expect(
    page.getByRole("button", { name: "保存时在独立安全窗口输入密钥" }),
  ).toBeEnabled({ timeout: 30_000 });
  const capturePromise = application.waitForEvent("window");
  await page
    .getByRole("button", { name: "添加模型服务商", exact: true })
    .click();
  const capture = await capturePromise;
  await capture.waitForLoadState("domcontentloaded");
  await capture
    .getByRole("textbox", { name: "安全凭据", exact: true })
    .fill(KEY);
  await Promise.all([
    capture.waitForEvent("close"),
    capture.getByRole("button", { name: "安全保存", exact: true }).click(),
  ]);
  await page
    .getByLabel("模型服务商 本地受控构思接口", { exact: true })
    .getByRole("button", { name: "设为智能助手模型", exact: true })
    .click();
  await expect(page.getByText(/本地受控构思接口：.*已/)).toBeVisible();
  await page
    .getByRole("button", { name: "保存全局默认值", exact: true })
    .click();
  await expect(
    page.getByText("全局默认模型已保存", { exact: true }),
  ).toBeVisible();
}

test("新建小说后和 AI 对话完成设定、人物、大纲，再开始写第一章", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-novel-planning-"));
  const model = await planningModel();
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await configureModel(application, page, model.url);

    // A new novel opens on the planning conversation.
    await quickCreateProject(page, "写小说");
    await expect(page).toHaveURL(/#\/projects\/[^/?]+\?section=plan/);
    await expect(
      page.getByRole("heading", { name: "和 AI 一起构思" }),
    ).toBeVisible();
    const log = page.getByRole("log", { name: "构思对话" });
    const input = page.getByRole("textbox", { name: "和 AI 说说你的想法" });

    // 1. The author's idea becomes a story setup draft, adopted on one click.
    await input.fill("现代都市，一个被裁员的程序员继承了快倒闭的旧书店");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(log.getByText("能读心的旧书店")).toBeVisible();
    expect(model.calls.find((call) => call.kind === "setup")?.prompt).toContain(
      "被裁员的程序员",
    );
    await page.getByRole("button", { name: "采用故事设定" }).click();
    await expect(
      log.getByText("故事设定已保存", { exact: false }),
    ).toBeVisible();

    // 2. Characters are drafted from the adopted setup, then revised by reply.
    await page.getByRole("button", { name: "生成主要人物" }).click();
    await expect(log.getByRole("heading", { name: "林晚" })).toBeVisible();
    expect(
      model.calls.find((call) => call.kind === "characters")?.prompt,
    ).toContain("能读心的旧书店");
    await input.fill("让主角更果断一些");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      log.getByRole("heading", { name: "林晚（果断版）" }),
    ).toBeVisible();
    const revision = model.calls.filter(
      (call) => call.kind === "characters",
    )[1];
    expect(revision?.prompt).toContain("上一版方案");
    expect(revision?.prompt).toContain("让主角更果断一些");
    await page.getByRole("button", { name: "采用主要人物" }).click();
    await expect(
      log.getByText("主要人物已保存", { exact: false }),
    ).toBeVisible();

    // 3. The outline reads the adopted characters too.
    await page.getByRole("button", { name: "生成全书大纲" }).click();
    await expect(
      log.getByRole("heading", { name: "旧书店全书大纲" }),
    ).toBeVisible();
    expect(
      model.calls.find((call) => call.kind === "outline")?.prompt,
    ).toContain("林晚（果断版）");
    await page.getByRole("button", { name: "采用全书大纲" }).click();
    await expect(log.getByText("构思完成", { exact: false })).toBeVisible();
    const steps = page.getByRole("list", { name: "构思进度" });
    await expect(steps.getByText("已完成")).toHaveCount(3);
    expect(model.calls.filter((call) => call.kind === "unexpected")).toEqual(
      [],
    );

    // The setup filled the project's fields but kept its name.
    await expect(
      page.getByRole("button", { name: "当前项目：未命名小说" }),
    ).toBeVisible();
    const sections = page.getByRole("navigation", { name: "小说创作入口" });
    await sections.getByRole("button", { name: "设定", exact: true }).click();
    await expect(page.getByLabel("核心钩子", { exact: true })).toHaveValue(
      "能读心的旧书店",
    );

    // Then writing starts on the first chapter.
    await sections.getByRole("button", { name: "构思", exact: true }).click();
    await page.getByRole("button", { name: "开始写第一章" }).click();
    await expect(
      page.getByRole("button", { name: "章节目录", exact: true }),
    ).toBeVisible();
  } finally {
    await application.close();
    await model.close();
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("设定页一句话生成故事设定，采用后写入项目字段且不改项目名", async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-story-setup-"));
  const model = await planningModel();
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await configureModel(application, page, model.url);
    await quickCreateProject(page, "写小说");
    const sections = page.getByRole("navigation", { name: "小说创作入口" });
    await sections.getByRole("button", { name: "设定", exact: true }).click();

    await page.getByRole("button", { name: /智能补全项目设定/ }).click();
    await page
      .getByRole("textbox", { name: "对项目设定的要求" })
      .fill("被裁员的程序员继承了旧书店，基调温暖");
    await page.getByRole("button", { name: "生成故事设定" }).click();
    const draft = page.getByRole("heading", { name: "旧书店", exact: true });
    await expect(draft).toBeVisible();
    const prompt = model.calls.find((call) => call.kind === "setup")?.prompt;
    expect(prompt).toContain("基调温暖");
    expect(prompt).toContain("只补全空缺的部分");

    await page.getByRole("button", { name: "采用故事设定" }).click();
    await expect(page.getByText("故事设定已写入下面的项目设定")).toBeVisible();
    await expect(draft).toBeHidden();
    await expect(page.getByLabel("核心钩子", { exact: true })).toHaveValue(
      "能读心的旧书店",
    );
    await expect(
      page.getByRole("button", { name: "当前项目：未命名小说" }),
    ).toBeVisible();
    expect(model.calls.filter((call) => call.kind === "unexpected")).toEqual(
      [],
    );
  } finally {
    await application.close();
    await model.close();
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
