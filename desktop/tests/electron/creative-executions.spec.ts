import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { creativeExecutionLedgerFixture } from "../fixtures/creative-execution-ledger";
import { creativeDeliveryLedgerFixture } from "../fixtures/creative-delivery-ledger";

test("A07 后台只读原请求台账：实际空记录、受控四阶段界面、分页失败不保留成功读数、项目切换拒绝延迟旧回复", async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-a07-ledger-ui-"));
  const application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  let manager: ServerConnectionManager | undefined;
  let release: (() => void) | undefined;
  let releaseCoverage: (() => void) | undefined;
  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    const client = createStudioClient(manager.createTransport());
    const { project } = await client.projects.create({
      title: "原请求台账界面受控样本",
    });
    const { project: other } = await client.projects.create({
      title: "独立空记录项目",
    });
    const actualEmpty = await client.creativeOutcomes.executions(project.id);
    expect(actualEmpty.items).toEqual([]);
    expect(
      (await client.creativeOutcomes.deliveryCoverage(project.id)).groups.every(
        (g) => g.ratio === null,
      ),
    ).toBe(true);
    const actualSummary = await client.creativeOutcomes.summary(project.id);
    expect((await client.novelRevisionEffort.read(project.id)).items).toEqual(
      [],
    );
    const value = creativeExecutionLedgerFixture(project.id),
      older = creativeExecutionLedgerFixture(project.id);
    value.request.record.cursor = 10;
    for (const fact of value.facts.items) fact.record.cursor += 9;
    value.projection = { state: "healthy", checkpoint: 12 };
    older.projection = { state: "healthy", checkpoint: 12 };
    if (
      older.request.family === "creative" &&
      older.request.record.fact.kind === "request"
    )
      older.request.record.fact.targetKey = "d".repeat(64);
    for (const fact of older.facts.items)
      if (
        fact.family === "creative" &&
        fact.record.fact.kind !== "owner-rejection"
      )
        fact.record.fact.targetKey = "d".repeat(64);
    let listMode: "normal" | "fail" = "normal",
      detailMode: "normal" | "fail" | "delayed" = "normal";
    let delayedStarted = false;
    let revisionFails = false;
    const chapterId = crypto.randomUUID(),
      previewId = crypto.randomUUID(),
      adoptionId = crypto.randomUUID(),
      olderAdoptionId = crypto.randomUUID(),
      olderChapterId = crypto.randomUUID(),
      olderPreviewId = crypto.randomUUID();
    await page.route(
      "**/api/v2/projects/*/creative-outcomes/revision-effort*",
      async (route) => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        if (!url.pathname.includes(`/projects/${project.id}/`))
          return route.continue();
        if (revisionFails)
          return route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            json: {
              type: "https://dramaip.local/problems/controlled-revision-read",
              status: 503,
              title: "受控修订原读取失败",
              code: "REVISION_HISTORY_UNAVAILABLE",
            },
          });
        const row = {
          targetKey: "a".repeat(64),
          workflowIds: [value.workflowId],
          state: "measured",
          localRevisionCount: 3,
          observedContentUpdates: 2,
          observedRebases: 1,
          observedContentChangingRebases: 1,
          adoption: {
            eventId: adoptionId,
            cursor: 8,
            workflowId: value.workflowId,
            previewId,
            chapterId,
            version: 1,
          },
        };
        return route.fulfill({
          json: {
            format: "novel-revision-effort-page-v1",
            projectId: project.id,
            projection: { state: "healthy", checkpoint: 12 },
            totalTargets: 2,
            items: [
              {
                ...row,
                targetKey: "d".repeat(64),
                workflowIds: [older.workflowId],
                state: "unknown",
                localRevisionCount: null,
                adoption: {
                  ...row.adoption,
                  eventId: olderAdoptionId,
                  chapterId: olderChapterId,
                  previewId: olderPreviewId,
                  workflowId: older.workflowId,
                  cursor: 3,
                },
              },
              row,
            ],
            policy:
              "saved-content-changes-before-first-recorded-formal-adoption",
            modelRevisions: "excluded",
            qualityState: "unverified",
          },
        });
      },
    );
    const gets: string[] = [];
    await page.route(
      "**/api/v2/projects/*/creative-outcomes/executions**",
      async (route) => {
        const request = route.request();
        expect(request.method()).toBe("GET");
        const url = new URL(request.url());
        gets.push(url.pathname + url.search);
        if (!url.pathname.includes(`/projects/${project.id}/`)) {
          await route.continue();
          return;
        }
        const fail = () =>
          route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            json: {
              type: "https://dramaip.local/problems/controlled-a07-ui",
              title: "受控原读取失败",
              status: 503,
              code: "SERVICE_UNAVAILABLE",
            },
          });
        if (url.pathname.endsWith("/executions")) {
          if (listMode === "fail") {
            await fail();
            return;
          }
          await route.fulfill({
            json: {
              projectId: project.id,
              historyPolicy: "recorded-original-requests-only",
              projection: { state: "healthy", checkpoint: 12 },
              items: url.searchParams.has("cursor")
                ? [older.request]
                : [value.request],
              ...(url.searchParams.has("cursor") ? {} : { nextCursor: 10 }),
            },
          });
        } else {
          if (detailMode === "delayed") {
            delayedStarted = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          if (detailMode === "fail") {
            await fail();
            return;
          }
          await route
            .fulfill({
              json: url.pathname.endsWith(older.workflowId) ? older : value,
            })
            .catch(() => undefined);
        }
      },
    );
    await page.evaluate(() => {
      window.location.hash = "/insights";
    });
    await page
      .getByRole("combobox", { name: "所属项目" })
      .selectOption(project.id);
    const panel = page.getByRole("region", { name: "本地原请求与运行台账" });
    const configurationPanel = page.getByRole("region", {
      name: "全项目原请求配置漏斗",
      exact: true,
    });
    await expect(panel).toBeVisible();
    expect(gets).toHaveLength(0);
    const deliveryPanel = page.getByRole("region", {
        name: "正式采用与保存的同版本交付覆盖",
        exact: true,
      }),
      deliveryButton = deliveryPanel.getByRole("button", {
        name: "读取采用版本交付覆盖",
        exact: true,
      }),
      deliveryResult = deliveryPanel.getByLabel("正式采用版本交付覆盖结果", {
        exact: true,
      });
    await deliveryButton.click();
    await expect(deliveryResult).toContainText("覆盖率未建立，不补零");
    const coverageFixture = creativeDeliveryLedgerFixture(project.id);
    let coverageMode: "normal" | "fail" | "delayed" = "normal",
      coverageStarted = false;
    await page.route(
      "**/api/v2/projects/*/creative-outcomes**",
      async (route) => {
        const url = new URL(route.request().url());
        const base = `/api/v2/projects/${project.id}/creative-outcomes`;
        if (url.pathname !== base && url.pathname !== `${base}/summary`)
          return route.fallback();
        expect(route.request().method()).toBe("GET");
        if (coverageMode === "fail")
          return route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            json: {
              type: "https://dramaip.local/problems/controlled-delivery",
              status: 503,
              title: "受控交付读取失败",
              code: "SERVICE_UNAVAILABLE",
            },
          });
        if (coverageMode === "delayed") {
          coverageStarted = true;
          await new Promise<void>((resolve) => (releaseCoverage = resolve));
        }
        const json = url.pathname.endsWith("/summary")
          ? {
              ...actualSummary,
              counts: coverageFixture.counts,
              projection: coverageFixture.projection,
            }
          : url.searchParams.has("cursor")
            ? { projectId: project.id, items: coverageFixture.records.slice(3) }
            : {
                projectId: project.id,
                items: coverageFixture.records.slice(0, 3),
                nextCursor: 7,
              };
        await route.fulfill({ json }).catch(() => {});
      },
    );
    await deliveryButton.click();
    await expect(deliveryResult).toContainText("采用版本交付覆盖 2/3");
    const timeButton = deliveryPanel.getByRole("button", {
        name: "读取七天交付与保存耗时",
        exact: true,
      }),
      timeResult = deliveryPanel.getByLabel("七天交付与采用后保存耗时", {
        exact: true,
      });
    await timeButton.click();
    await expect(timeResult).toContainText("本窗新增采用 3");
    await expect(timeResult).toContainText("本窗首次匹配保存 2");
    await expect(timeResult).toContainText("3000/2 毫秒");
    await expect(timeResult).toContainText("不是模型生成速度");
    await timeResult.scrollIntoViewIfNeeded();
    await timeResult.screenshot({
      path: info.outputPath("a07-controlled-delivery-window.png"),
    });
    coverageMode = "fail";
    await timeButton.click();
    await expect(deliveryPanel.getByRole("alert")).toContainText(
      "原交付覆盖读取失败",
    );
    await expect(timeResult).toHaveCount(0);
    coverageMode = "delayed";
    coverageStarted = false;
    await timeButton.click();
    await expect.poll(() => coverageStarted).toBe(true);
    await deliveryPanel
      .getByRole("button", { name: "停止读取交付覆盖", exact: true })
      .click();
    coverageMode = "normal";
    releaseCoverage?.();
    releaseCoverage = undefined;
    await timeButton.click();
    await expect(timeResult).toContainText("3000/2 毫秒");
    await deliveryButton.click();
    await expect(deliveryResult).toContainText("采用版本交付覆盖 2/3");
    await expect(deliveryResult).toContainText("采用版本交付覆盖 1/1");
    await expect(deliveryResult).toContainText("尚无匹配保存 1");
    await expect(deliveryResult).toContainText("缺此前采用关联的版本 1");
    await deliveryResult.scrollIntoViewIfNeeded();
    await deliveryResult.screenshot({
      path: info.outputPath("a07-controlled-delivery-coverage.png"),
    });
    coverageMode = "fail";
    await deliveryButton.click();
    await expect(deliveryPanel.getByRole("alert")).toContainText(
      "原交付覆盖读取失败",
    );
    await expect(deliveryResult).toHaveCount(0);
    coverageMode = "delayed";
    await deliveryButton.click();
    await expect.poll(() => coverageStarted).toBe(true);
    await deliveryPanel
      .getByRole("button", { name: "停止读取交付覆盖", exact: true })
      .click();
    coverageMode = "normal";
    releaseCoverage?.();
    releaseCoverage = undefined;
    await deliveryButton.click();
    await expect(deliveryResult).toContainText("采用版本交付覆盖 2/3");
    await panel
      .getByRole("button", { name: "读取原请求台账", exact: true })
      .click();
    await panel
      .getByRole("button", { name: new RegExp(value.workflowId) })
      .click();
    const detail = panel.getByRole("region", {
      name: "原工作流运行关联",
      exact: true,
    });
    await expect(detail).toHaveAttribute(
      "data-creative-execution-workflow-id",
      value.workflowId,
    );
    for (const phase of ["生成", "检查", "修订", "复检"])
      await expect(
        detail.getByRole("region", { name: `原${phase}阶段`, exact: true }),
      ).toBeVisible();
    await expect(detail).toContainText("输入 0");
    await expect(detail).toContainText("输出 未报告");
    await expect(detail).toContainText("缓存读取 报告值无效");
    await expect(detail).toContainText("不是本次运行用量");
    await expect(detail).toContainText("EUR");
    const statistics = detail.getByRole("region", {
      name: "原尝试配置分组与运行统计",
      exact: true,
    });
    await expect(statistics).toContainText("已记录阶段 4");
    await expect(statistics).toContainText("可核耗时 4/4");
    await expect(statistics).toContainText("1000–1000 毫秒");
    await expect(
      statistics.getByRole("region", { name: "原请求配置组 1", exact: true }),
    ).toBeVisible();
    await statistics.scrollIntoViewIfNeeded();
    await statistics.screenshot({
      path: info.outputPath("a07-controlled-configuration-statistics.png"),
    });
    await configurationPanel
      .getByRole("button", { name: "读取全项目原配置漏斗", exact: true })
      .click();
    const configurationResult = configurationPanel.getByRole("region", {
      name: "全项目原请求配置漏斗结果",
      exact: true,
    });
    await expect(configurationResult).toContainText("已记录原工作流 2");
    await expect(configurationResult).toContainText("原目标 2");
    await expect(configurationResult).toContainText("原候选直接采用 2");
    await expect(configurationResult).toContainText(
      "包含待决定，不是公开模型采用率",
    );
    await configurationResult.scrollIntoViewIfNeeded();
    await configurationResult.screenshot({
      path: info.outputPath("a07-controlled-project-configuration-funnel.png"),
    });
    const revisionPanel = page.getByRole("region", {
      name: "首次章节采用前实际修订",
      exact: true,
    });
    await revisionPanel
      .getByRole("button", { name: "读取首次章节采用前修订", exact: true })
      .click();
    const revisionResult = revisionPanel.getByLabel("首次章节采用前修订结果", {
      exact: true,
    });
    await expect(revisionResult).toContainText(
      "首次正式采用前局部正文修订 3 次",
    );
    await expect(revisionResult).toContainText("已观察正文修改 2 次");
    await expect(revisionResult).toContainText("采用后的变化不并入");
    await expect(revisionResult).toContainText("模型修订阶段");
    await revisionResult.scrollIntoViewIfNeeded();
    await revisionResult.screenshot({
      path: info.outputPath("a07-controlled-first-adoption-revisions.png"),
    });
    revisionFails = true;
    await revisionPanel
      .getByRole("button", { name: "读取首次章节采用前修订", exact: true })
      .click();
    await expect(revisionPanel.getByRole("alert")).toContainText(
      "不显示部分分页、旧结果或推定零",
    );
    await expect(revisionResult).toHaveCount(0);
    revisionFails = false;
    await revisionPanel
      .getByRole("button", { name: "读取首次章节采用前修订", exact: true })
      .click();
    await expect(revisionResult).toBeVisible();
    const groupButton = revisionPanel.getByRole("button", {
      name: "读取按原配置分组的章节修订",
      exact: true,
    });
    const groupResult = revisionPanel.getByRole("region", {
      name: "原配置章节修订结果",
      exact: true,
    });
    await groupButton.click();
    await expect(groupResult).toContainText("已可核采用 1 / 目标 2");
    await expect(groupResult).toContainText("已采用历史未知 1");
    await expect(groupResult).toContainText("均值 3/1 次（精确分数）");
    await expect(groupResult).toContainText("不表示所有尝试均使用本组模型");
    await groupResult.scrollIntoViewIfNeeded();
    await groupResult.screenshot({
      path: info.outputPath("a07-controlled-revision-configuration.png"),
    });
    revisionFails = true;
    await groupButton.click();
    await expect(revisionPanel.getByRole("alert")).toContainText(
      "不显示部分分页、旧结果或推定零",
    );
    await expect(groupResult).toHaveCount(0);
    revisionFails = false;
    detailMode = "delayed";
    delayedStarted = false;
    await groupButton.click();
    await expect.poll(() => delayedStarted).toBe(true);
    await revisionPanel
      .getByRole("button", { name: "停止本次修订读取", exact: true })
      .click();
    release!();
    await expect(groupResult).toHaveCount(0);
    await expect(groupButton).toBeEnabled();
    detailMode = "normal";
    await revisionPanel
      .getByRole("button", { name: "读取首次章节采用前修订", exact: true })
      .click();
    await expect(revisionResult).toBeVisible();
    await panel.screenshot({
      path: info.outputPath("a07-controlled-original-ledger.png"),
    });
    // The parent lives in a scrolling main pane; its long screenshot is clipped
    // below the viewport. Capture each complete card separately for honest QA.
    for (const phase of ["生成", "检查", "修订", "复检"]) {
      const card = detail.getByRole("region", {
        name: `原${phase}阶段`,
        exact: true,
      });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: info.outputPath(`a07-controlled-${phase}.png`),
      });
    }
    await panel
      .getByRole("button", { name: "读取更早的原请求", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: new RegExp(older.workflowId) }),
    ).toBeVisible();
    detailMode = "fail";
    await panel
      .getByRole("button", { name: "重新读取原工作流", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("原运行读取失败");
    await expect(detail).toHaveCount(0);
    detailMode = "normal";
    await panel
      .getByRole("button", { name: "重新读取原工作流", exact: true })
      .click();
    await expect(detail).toBeVisible();
    listMode = "fail";
    await configurationPanel
      .getByRole("button", { name: "读取全项目原配置漏斗", exact: true })
      .click();
    await expect(configurationPanel.getByRole("alert")).toContainText(
      "原配置漏斗读取失败",
    );
    await expect(configurationResult).toHaveCount(0);
    await panel
      .getByRole("button", { name: "读取原请求台账", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("原请求读取失败");
    await expect(
      panel.getByRole("button", { name: new RegExp(value.workflowId) }),
    ).toHaveCount(0);
    await expect(detail).toHaveCount(0);
    listMode = "normal";
    detailMode = "delayed";
    delayedStarted = false;
    await configurationPanel
      .getByRole("button", { name: "读取全项目原配置漏斗", exact: true })
      .click();
    await expect.poll(() => delayedStarted).toBe(true);
    await configurationPanel
      .getByRole("button", { name: "停止本次读取", exact: true })
      .click();
    release!();
    await expect(configurationResult).toHaveCount(0);
    await expect(
      configurationPanel.getByRole("button", {
        name: "读取全项目原配置漏斗",
        exact: true,
      }),
    ).toBeEnabled();
    detailMode = "normal";
    await panel
      .getByRole("button", { name: "读取原请求台账", exact: true })
      .click();
    detailMode = "delayed";
    delayedStarted = false;
    await panel
      .getByRole("button", { name: new RegExp(value.workflowId) })
      .click();
    await expect.poll(() => delayedStarted).toBe(true);
    coverageMode = "delayed";
    coverageStarted = false;
    await timeButton.click();
    await expect.poll(() => coverageStarted).toBe(true);
    await page
      .getByRole("combobox", { name: "所属项目" })
      .selectOption(other.id);
    release!();
    coverageMode = "normal";
    releaseCoverage?.();
    releaseCoverage = undefined;
    await expect(deliveryResult).toHaveCount(0);
    await expect(timeResult).toHaveCount(0);
    await deliveryButton.click();
    await expect(deliveryResult).toContainText("覆盖率未建立，不补零");
    await expect(deliveryResult).not.toContainText("采用版本交付覆盖 2/3");
    await panel
      .getByRole("button", { name: "读取原请求台账", exact: true })
      .click();
    await expect(panel).toContainText("没有已记录的原请求");
    await expect(panel).not.toContainText(value.workflowId);
    await expect(
      panel.getByRole("region", { name: "原工作流运行关联" }),
    ).toHaveCount(0);
    await expect(panel).not.toContainText("输入 0");
    await expect(
      configurationPanel.getByRole("region", {
        name: "全项目原请求配置漏斗结果",
        exact: true,
      }),
    ).toHaveCount(0);
    await configurationPanel
      .getByRole("button", { name: "读取全项目原配置漏斗", exact: true })
      .click();
    await expect(configurationPanel).toContainText("没有已记录原请求");
    await expect(configurationPanel).not.toContainText(value.workflowId);
    expect(await client.creativeOutcomes.executions(project.id)).toEqual(
      actualEmpty,
    );
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    releaseCoverage?.();
    release?.();
    manager?.disconnect();
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
