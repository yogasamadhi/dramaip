import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ProductionQualitySource,
  ProductionRecord,
} from "@dramaip/contracts/production";
import type {
  NarrativeQualityRequest,
  NarrativeQualityReport,
} from "@dramaip/contracts/creative-quality";
import type { CreationWorkflow } from "@dramaip/contracts/creation";

test("普通保存剧本与独立场景质量：明确指纹、源禁发零分配、独立采用／原报告重启、同版本改稿与失败缓存保护（后台受控接口）", async ({}, info) => {
  test.setTimeout(180000);
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-ordinary-quality-e2e-"),
  );
  const model = "controlled-saved-quality-v1",
    key = "only-local-fixture-not-a-provider-key";
  const calls: string[] = [],
    errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (
        req.method !== "POST" ||
        req.url !== "/v1/chat/completions" ||
        req.headers.authorization !== `Bearer ${key}`
      )
        throw new Error("Unexpected local fixture request");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        stream: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      if (body.model !== model || body.stream !== true)
        throw new Error("Only configured local streaming fixture is permitted");
      const prompt = body.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");
      let output: unknown;
      if (prompt.includes("审阅候选与冻结")) {
        calls.push("check");
        output = { issues: [] };
      } else {
        const raw = prompt.match(/目标：(\{[^\n]+\})\n/u)?.[1];
        if (!raw) throw new Error("Exact quality request absent");
        const input = JSON.parse(raw) as NarrativeQualityRequest;
        const target = input.target;
        if (
          !["script", "scene"].includes(target.kind) ||
          !target.sourceFingerprint
        )
          throw new Error(
            "Fixture requires an actual saved source fingerprint",
          );
        const rawSource = prompt.match(
          new RegExp(
            `/production/${target.id} \\(source=production:${target.id}@${target.version}\\)\\n([^\\n]+)`,
            "u",
          ),
        )?.[1];
        if (!rawSource) throw new Error("Actual complete frozen source absent");
        const source = JSON.parse(rawSource) as {
          kind: string;
          sourceFingerprint: string;
          content: {
            blocks?: Array<{ type: string; text?: string }>;
            场景动作?: string;
          };
        };
        if (
          source.kind !== target.kind ||
          source.sourceFingerprint !== target.sourceFingerprint
        )
          throw new Error("Frozen source substituted");
        const index =
          source.content.blocks?.findIndex(
            (block) => block.type === "action" && block.text,
          ) ?? -1;
        const quote =
          target.kind === "script"
            ? source.content.blocks?.[index]?.text
            : source.content.场景动作;
        if (!quote) throw new Error("Actual saved prose absent");
        calls.push(target.kind);
        output = {
          title: "实际保存来源质量候选",
          content: "受控模型协议回归，不是文学质量证明。",
          items: [
            {
              ref: "report",
              kind: "narrative-quality-report",
              title: "来源绑定评议",
              data: {
                summary:
                  "只核对明确冻结的实际保存材料；不改原稿，不证明文学或改编语义。",
                reviewedDimensions: input.dimensions,
                reviewedSources: [
                  {
                    sourceId: target.id,
                    sourceVersion: target.version,
                    fieldPath: `/production/${target.id}`,
                  },
                ],
                issues: [
                  {
                    id: "actual-source-1",
                    category: "causality",
                    severity: "warning",
                    source: "model",
                    message: "作者须独立核对这处行动的动机。",
                    suggestion: "核对原稿，不自动改写或采用。",
                    evidence: [
                      {
                        sourceId: target.id,
                        sourceVersion: target.version,
                        fieldPath: `/production/${target.id}`,
                        valuePath:
                          target.kind === "script"
                            ? `/content/blocks/${index}/text`
                            : "/content/场景动作",
                        quote,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        };
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: crypto.randomUUID(), object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      chunk({ role: "assistant", content: JSON.stringify(output) });
      chunk({}, "stop");
      res.end("data: [DONE]\n\n");
    } catch (cause) {
      errors.push(
        cause instanceof Error ? cause.message : "Local fixture error",
      );
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: errors.at(-1) } }));
    }
  });
  await new Promise<void>((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local fixture did not bind");
  const url = `http://127.0.0.1:${address.port}/v1`;
  let application: ElectronApplication | undefined,
    page: Page,
    bootstrap: { baseUrl: string; accessToken: string },
    dialogs = 0;
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
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(
      page.getByRole("heading", { name: "项目工作台", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    bootstrap = await page.evaluate(() => window.runtimeBootstrap.resolve());
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  };
  const api = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> => {
    const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`,
        "Content-Type": "application/json",
        ...(method === "POST"
          ? { "Idempotency-Key": crypto.randomUUID() }
          : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBe(true);
    return (await response.json()) as T;
  };
  const panel = () =>
    page.getByLabel("版本绑定质量报告工作台", { exact: true });
  const open = async (projectId: string, query = "") => {
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${projectId}/tools/quality-review${query}`);
    await expect(panel()).toBeVisible();
  };
  try {
    await launch();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page
      .getByRole("combobox", { name: "服务商", exact: true })
      .selectOption("other");
    await page
      .getByRole("textbox", { name: "服务商名称", exact: true })
      .fill("后台受控保存来源接口");
    await page
      .getByRole("textbox", { name: "模型名称", exact: true })
      .fill(model);
    await page
      .getByRole("textbox", { name: "服务地址", exact: true })
      .fill(url);
    const capturePromise = application!.waitForEvent("window");
    await page
      .getByRole("button", { name: "添加模型服务商", exact: true })
      .click();
    const capture = await capturePromise;
    await capture
      .getByRole("textbox", { name: "安全凭据", exact: true })
      .fill(key);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
    await Promise.all([
      capture.waitForEvent("close"),
      capture.getByRole("button", { name: "安全保存", exact: true }).click(),
    ]);
    await page
      .getByLabel("模型服务商 后台受控保存来源接口", { exact: true })
      .getByRole("button", { name: "设为智能助手模型", exact: true })
      .click();
    await expect(page.getByText(/后台受控保存来源接口：.*已/)).toBeVisible();
    await page
      .getByRole("combobox", { name: "全局默认引擎", exact: true })
      .selectOption("langgraph");
    await page
      .getByRole("button", { name: "保存全局默认值", exact: true })
      .click();
    await expect(
      page.getByText("全局默认智能引擎已保存", { exact: true }),
    ).toBeVisible();
    const { project } = await api<{ project: { id: string } }>(
      "projects",
      "POST",
      {
        title: "普通保存稿与独立场景质量",
        mode: "series_longform",
        modeConfig: { mode: "series_longform" },
      },
    );
    const script = await api<ProductionRecord>("scripts", "POST", {
      projectId: project.id,
      title: "实际保存稿",
      payload: {
        剧本内容:
          "INT. ACTUAL ROOM - DAY\n\nActual saved action remains unchanged.\n\nLINA\nActual saved dialogue.",
      },
    });
    const scene = await api<ProductionRecord>("scenes", "POST", {
      projectId: project.id,
      title: "独立场景，不先建小说／剧本",
      payload: {
        场景动作: "Actual independent scene remains unchanged.",
        对白与备注: "Actual scene dialogue.",
      },
    });
    const source = await api<ProductionQualitySource>(
      `projects/${project.id}/production-quality-sources/${script.id}`,
    );
    if (source.source.state !== "available" || !source.source.document)
      throw new Error("Saved source absent");
    await open(project.id);
    await expect(
      panel().getByLabel("质量检查目标", { exact: true }),
    ).toHaveValue("");
    await panel()
      .getByLabel("质量检查目标", { exact: true })
      .selectOption(`script:${script.id}`);
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await expect(
      panel().locator("[data-quality-source-fingerprint]"),
    ).toHaveAttribute(
      "data-quality-source-fingerprint",
      source.source.contentHash,
    );
    const dependency = source.source.policyDependencies.find(
      (value) =>
        value.fieldPath.includes("/blocks/") &&
        value.fieldPath.endsWith("/text"),
    )!;
    await api(
      `projects/${project.id}/agent-context-policies`,
      "PUT",
      {
        version: 0,
        policies: [
          { fieldPath: `/production/${script.id}`, mode: "always" },
          { fieldPath: dependency.fieldPath, mode: "never" },
        ],
      },
      { "If-Match": '"0"' },
    );
    const originalTasks = await api("tasks"),
      originalWorkflows = await api(
        `workflows/creation?projectId=${project.id}`,
      );
    await panel()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(panel()).toContainText("未完整纳入", { timeout: 20000 });
    expect(await api("tasks")).toEqual(originalTasks);
    expect(await api(`workflows/creation?projectId=${project.id}`)).toEqual(
      originalWorkflows,
    );
    expect(calls).toEqual([]);
    await api(
      `projects/${project.id}/agent-context-policies`,
      "PUT",
      { version: 1, policies: [] },
      { "If-Match": '"1"' },
    );
    await panel()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect(
      panel().getByRole("button", { name: "采用此质量报告", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    const runs = await api<{ items: CreationWorkflow[] }>(
      `workflows/creation?projectId=${project.id}`,
    );
    const scriptRun = runs.items.find(
      (value) => value.input.qualityReviewRequest?.target.id === script.id,
    )!;
    let scriptReport = await api<NarrativeQualityReport>(
      `narrative-quality-reports/${scriptRun.narrativeReportId}`,
    );
    expect(scriptReport.basis.productionSourceBasis!.document!.id).toBe(
      source.source.document.id,
    );
    expect(
      scriptReport.basis.productionSourceBasis!.document!.blocks.map(
        (block) => block.id,
      ),
    ).toEqual(source.source.document.blocks.map((block) => block.id));
    await panel()
      .getByRole("button", { name: "采用此质量报告", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认采用报告", exact: true })
      .click();
    await expect(
      panel().locator(`[data-narrative-report-id="${scriptReport.id}"]`),
    ).toContainText("当前已采用报告");
    scriptReport = await api(`narrative-quality-reports/${scriptReport.id}`);
    await panel().locator("[data-quality-production-basis] summary").click();
    await panel()
      .locator("[data-quality-production-basis]")
      .scrollIntoViewIfNeeded();
    await panel()
      .locator("[data-quality-production-basis]")
      .screenshot({ path: info.outputPath("saved-script-frozen-blocks.png") });
    await panel()
      .getByLabel("质量检查目标", { exact: true })
      .selectOption(`scene:${scene.id}`);
    await panel()
      .getByRole("button", { name: "确认本轮质量基准", exact: true })
      .click();
    await panel()
      .getByRole("button", {
        name: "生成并检查版本绑定的质量报告",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (
            await api<{ items: CreationWorkflow[] }>(
              `workflows/creation?projectId=${project.id}`,
            )
          ).items.find(
            (value) => value.input.qualityReviewRequest?.target.id === scene.id,
          )?.stage,
        { timeout: 30000 },
      )
      .toBe("awaiting-review");
    const sceneRun = (
      await api<{ items: CreationWorkflow[] }>(
        `workflows/creation?projectId=${project.id}`,
      )
    ).items.find(
      (value) => value.input.qualityReviewRequest?.target.id === scene.id,
    )!;
    const sceneReport = await api<NarrativeQualityReport>(
      `narrative-quality-reports/${sceneRun.narrativeReportId}`,
    );
    expect(sceneReport.basis.productionSourceBasis!.document).toBeUndefined();
    expect(sceneReport.basis.productionSourceBasis!.ancestors).toEqual([]);
    expect(await api(`projects/${project.id}/chapters`)).toEqual([]);
    expect(await api(`scripts/${script.id}`)).toEqual(script);
    expect(await api(`scenes/${scene.id}`)).toEqual(scene);
    const count = calls.length;
    const exactScene = `?reportId=${sceneReport.id}&workflowId=${sceneRun.id}`;
    await application!.close();
    application = undefined;
    await launch();
    await open(project.id, exactScene);
    await expect(
      panel().locator(`[data-narrative-report-id="${sceneReport.id}"]`),
    ).toBeVisible();
    expect(await api(`narrative-quality-reports/${sceneReport.id}`)).toEqual(
      sceneReport,
    );
    expect(calls).toHaveLength(count);
    const savedScope = await page.evaluate(
      (name) => window.localStorage.getItem(name),
      `dramaip-quality-scope:${project.id}`,
    );
    expect(savedScope).toContain(
      sceneReport.basis.request.target.sourceFingerprint,
    );
    expect(savedScope).not.toContain("Actual independent");
    let failures = 0;
    const failedPath = `**/api/v2/narrative-quality-reports/${sceneReport.id}`;
    await page.route(failedPath, async (route) => {
      failures++;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          status: 503,
          code: "CONTROLLED_READ_FAILURE",
          traceId: crypto.randomUUID(),
          title: "Controlled original report read failure",
        }),
      });
    });
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/projects/${project.id}/tools`);
    await open(project.id, exactScene);
    await expect.poll(() => failures).toBeGreaterThan(0);
    await expect(
      panel().locator(`[data-narrative-report-id="${sceneReport.id}"]`),
    ).toHaveCount(0);
    await expect(
      panel()
        .getByRole("alert")
        .filter({ hasText: "操作未能完成，请稍后重试。" }),
    ).toBeVisible();
    // Unknown provider/transport details stay sanitized; the actual failed read
    // counter and absent old report, not a forged success body, prove fail-closed UI.
    await expect(panel()).not.toContainText(
      "Controlled original report read failure",
    );
    await panel().screenshot({
      path: info.outputPath("saved-quality-failed-cache.png"),
    });
    await page.unroute(failedPath);
    await api(
      `scripts/${script.id}/screenplay`,
      "PATCH",
      {
        version: source.source.document.version,
        blocks: source.source.document.blocks.map((block) =>
          "text" in block && block.type === "action"
            ? { ...block, text: "Actual author changed the saved action." }
            : block,
        ),
      },
      { "If-Match": `"${source.source.document.version}"` },
    );
    await open(
      project.id,
      `?reportId=${scriptReport.id}&workflowId=${scriptRun.id}`,
    );
    await expect(
      panel().locator(`[data-narrative-report-id="${scriptReport.id}"]`),
    ).toContainText("来源已失效（只保留历史）");
    const stale = await api<NarrativeQualityReport>(
      `narrative-quality-reports/${scriptReport.id}`,
    );
    expect(stale.basis).toEqual(scriptReport.basis);
    expect(stale.content).toEqual(scriptReport.content);
    expect(stale.basis.request.target.version).toBe(script.version);
    expect(
      (
        await api<NarrativeQualityReport>(
          `narrative-quality-reports/${sceneReport.id}`,
        )
      ).sourceState,
    ).toBe("current");
    expect(calls).toHaveLength(count);
    expect(errors).toEqual([]);
    expect(dialogs).toBe(0);
    expect(
      await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await application?.close();
    server.closeAllConnections();
    await new Promise<void>((resolveServer, reject) =>
      server.close((cause) => (cause ? reject(cause) : resolveServer())),
    );
    await rm(userData, { recursive: true, force: true });
  }
});
