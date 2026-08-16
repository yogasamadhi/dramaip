import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const appRoot = resolve(import.meta.dirname, "../..");
const screenshotOptions = {
  animations: "disabled" as const,
  maxDiffPixelRatio: 0.015,
};

test.skip(process.platform !== "darwin", "固定视觉基线在 macOS 采集");

test("core surfaces retain Desktop visual structure in light and dark themes", async () => {
  test.setTimeout(120_000);
  const testUserData = await mkdtemp(
    resolve(tmpdir(), "DramaIP Studio Next UI Parity-"),
  );
  const executablePath =
    process.env.DRAMAIP_ELECTRON_EXECUTABLE ?? (require("electron") as string);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.DRAMAIP_E2E = "1";
  environment.DRAMAIP_E2E_USER_DATA = testUserData;
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath,
    args: [appRoot],
    env: environment,
  });

  try {
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      const studioWindow = BrowserWindow.getAllWindows()[0];
      if (!studioWindow) throw new Error("Studio window is unavailable");
      studioWindow.setContentSize(1440, 920);
    });
    await expect(
      page.getByRole("heading", { name: "项目工作台" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "从灵感开始" }).click();
    await page.getByLabel("项目名称").fill("示例短剧：雨夜归来");
    await page.getByLabel("类型").fill("都市悬疑情感");
    await page.getByLabel("一句话创意").fill("都市悬疑情感");
    await page
      .getByLabel("故事简介")
      .fill(
        "摄影师林晚在雨夜遇见自称失忆的陆沉，却发现他掌握着三年前失踪案的关键证据。",
      );
    await page.getByRole("button", { name: "创建并进入项目" }).click();
    await expect(page.locator(".writing-studio")).toBeVisible();
    const projectPath = new URL(page.url()).pathname;
    const projectId = /^\/projects\/([^/]+)/u.exec(projectPath)?.[1];
    expect(projectId).toBeTruthy();
    await page.getByTitle("新建章节").click();
    await page.getByLabel("章节标题").fill("第一章：雨夜敲门");
    await page
      .locator(".ProseMirror")
      .fill(
        "暴雨吞没了巷口的霓虹。林晚打开门，门外的人浑身湿透，却叫出了她从未对外提起的小名。",
      );
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.getByTitle("新建章节").click();
    await expect(page.getByLabel("章节标题")).toHaveValue("第 2 章");
    await page.getByLabel("章节标题").fill("第二章：旧照片");
    await page
      .locator(".ProseMirror")
      .fill(
        "泛黄照片背后写着一个她从未见过的日期，角落里的倒影却站着三年前已经失踪的陆沉手里的照片中。",
      );
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.getByTitle("新建章节").click();
    await expect(page.getByLabel("章节标题")).toHaveValue("第 3 章");
    await page.getByLabel("章节标题").fill("第三章：无人接听");
    await page
      .locator(".ProseMirror")
      .fill(
        "电话响到第七声，对面只传来列车经过的轰鸣，她循着声音赶到站台，却看见自己的旧相机在发亮了。",
      );
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page
      .locator(".chapter-item")
      .filter({ hasText: "第一章：雨夜敲门" })
      .click();

    if (!projectId) throw new Error("Project id was not captured");
    const apiRequest = async <T>(
      path: string,
      body: Record<string, unknown>,
    ): Promise<T> =>
      page.evaluate(
        async ({ path: target, body: value }) => {
          const init = await window.dramaip.init();
          const response = await fetch(`${init.apiBaseUrl}${target}`, {
            method: "POST",
            headers: {
              authorization: `Basic ${btoa(`${init.username}:${init.password}`)}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(value),
          });
          if (!response.ok) throw new Error(await response.text());
          return response.json();
        },
        { path, body },
      );
    const adaptation = await apiRequest<{ id: string }>(
      "/api/v2/production/adaptations",
      {
        projectId,
        title: "雨夜归来·第一季改编方案",
        ordinal: 0,
        data: {
          sourceId: projectId,
          strategy: "都市悬疑情感短剧",
          direction: "都市悬疑情感短剧",
          targetEpisodeCount: 12,
          notes: "以雨夜重逢开局，围绕旧照片与不存在的列车逐集揭开身份谜团。",
        },
      },
    );
    const episode = await apiRequest<{ id: string }>(
      "/api/v2/production/episodes",
      {
        projectId,
        parentId: adaptation.id,
        title: "第 1 集：雨夜敲门",
        ordinal: 0,
        data: {
          number: 1,
          synopsis: "暴雨之夜，失踪三年的陆沉敲响林晚家门。",
          durationMinutes: 2,
        },
      },
    );
    const script = await apiRequest<{ id: string }>(
      "/api/v2/production/scripts",
      {
        projectId,
        parentId: episode.id,
        title: "第 1 集剧本",
        ordinal: 0,
        data: {
          episodeId: episode.id,
          content: "雨夜门口",
          format: "fountain",
        },
      },
    );
    const scene = await apiRequest<{ id: string }>(
      "/api/v2/production/scenes",
      {
        projectId,
        parentId: script.id,
        title: "场景 1：雨夜门口",
        ordinal: 0,
        data: {
          scriptId: script.id,
          location: "林晚家门口",
          timeOfDay: "夜",
          action: "林晚开门",
          characters: ["林晚", "陆沉"],
        },
      },
    );
    const shots: Array<{ id: string }> = [];
    for (const [ordinal, title] of [
      "镜头 1：「门缝中的雨夜」",
      "镜头 2：雨中的来客",
    ].entries()) {
      shots.push(
        await apiRequest<{ id: string }>("/api/v2/production/shots", {
          projectId,
          parentId: scene.id,
          title,
          ordinal,
          data: {
            sceneId: scene.id,
            shotSize: ordinal ? "中景" : "特写",
            cameraMovement: "固定",
            description: title,
            durationSeconds: 3,
          },
        }),
      );
    }
    const assets: Array<{ id: string }> = [];
    for (const [ordinal, title] of [
      "雨夜霓虹参考素材",
      "林晚·雨夜服装设定",
    ].entries()) {
      assets.push(
        await apiRequest<{ id: string }>("/api/v2/media/assets", {
          projectId,
          title,
          ordinal,
          data: {
            mediaType: "image",
            contentRef: `fixture://asset-${ordinal + 1}`,
            mimeType: "image/png",
            byteSize: 0,
            checksum: `${ordinal + 1}`.padStart(64, "0"),
            rightsStatus: "cleared",
            adoptionStatus: "adopted",
          },
        }),
      );
    }
    await apiRequest("/api/v2/media/stills", {
      projectId,
      parentId: shots[0]?.id,
      title: "门缝雨夜静帧候选 A",
      ordinal: 0,
      data: {
        shotId: shots[0]?.id,
        assetId: assets[0]?.id,
        frame: 0,
      },
    });

    await page.addStyleTag({
      content:
        ".project-card small,.list-row time{visibility:hidden!important}",
    });

    const navigate = async (path: string) => {
      await page.evaluate((target) => {
        history.pushState({}, "", target);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    };
    const setTheme = async (theme: "light" | "dark") => {
      await page.evaluate((value) => {
        localStorage.setItem("dramaip-theme-v1", value);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.addStyleTag({
        content:
          ".project-card small,.list-row time{visibility:hidden!important}",
      });
    };

    for (const theme of ["light", "dark"] as const) {
      await setTheme(theme);

      await navigate("/");
      await expect(
        page.getByRole("heading", { name: "项目工作台" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-projects.png`,
        screenshotOptions,
      );

      await navigate("/write");
      await expect(
        page.getByRole("heading", { name: "小说写作" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-novel-home.png`,
        screenshotOptions,
      );

      await navigate(`/projects/${projectId}/write`);
      await expect(page.locator(".writing-studio")).toBeVisible();
      await expect(page.locator(".project-header-leading strong")).toHaveText(
        "示例短剧：雨夜归来",
      );
      await page
        .locator(".chapter-item")
        .filter({ hasText: "第一章：雨夜敲门" })
        .click();
      await expect(page.getByLabel("章节标题")).toHaveValue("第一章：雨夜敲门");
      await expect(page).toHaveScreenshot(
        `${theme}-novel-editor.png`,
        screenshotOptions,
      );

      await navigate(`/projects/${projectId}/tools`);
      await expect(
        page.getByRole("heading", { name: "项目工具" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-project-tools.png`,
        screenshotOptions,
      );

      await navigate(`/projects/${projectId}/knowledge?section=character`);
      await expect(
        page.getByRole("heading", { name: "故事知识库" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-knowledge.png`,
        screenshotOptions,
      );

      await navigate("/create");
      await expect(
        page.getByRole("heading", { name: "创作工作区" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-creative-analysis.png`,
        screenshotOptions,
      );

      await navigate("/adapt");
      await expect(
        page.getByRole("heading", { name: "从故事到分镜" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-adaptation.png`,
        screenshotOptions,
      );

      await navigate("/produce");
      await expect(
        page.getByRole("heading", { name: "素材与视听制作" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-production.png`,
        screenshotOptions,
      );

      await navigate("/review");
      await expect(
        page.getByRole("heading", { name: "质量、审片与交付" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-review.png`,
        screenshotOptions,
      );

      await navigate("/insights");
      await expect(
        page.getByRole("heading", { name: "数据洞察" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-insights.png`,
        screenshotOptions,
      );

      await navigate("/search");
      await expect(
        page.getByRole("heading", { name: "搜索创作资料" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-search.png`,
        screenshotOptions,
      );

      await navigate("/tasks");
      await expect(
        page.getByRole("heading", { name: "任务中心" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-tasks.png`,
        screenshotOptions,
      );

      await navigate("/settings");
      await expect(
        page.getByRole("heading", { name: "设置中心" }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-settings.png`,
        screenshotOptions,
      );

      await page.getByRole("button", { name: "打开智能助手" }).click();
      await expect(page.locator(".assistant-drawer-content")).toBeVisible();
      await expect(page).toHaveScreenshot(
        `${theme}-global-assistant.png`,
        screenshotOptions,
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(".assistant-drawer-content")).toBeHidden();
    }

    const nativeBackground = await application.evaluate(({ BrowserWindow }) => {
      const studioWindow = BrowserWindow.getAllWindows()[0];
      if (!studioWindow) throw new Error("Studio window is unavailable");
      return studioWindow.getBackgroundColor();
    });
    expect(nativeBackground.toLowerCase()).toBe("#191a19");

    await application.evaluate(({ BrowserWindow }) => {
      const studioWindow = BrowserWindow.getAllWindows()[0];
      if (!studioWindow) throw new Error("Studio window is unavailable");
      studioWindow.setMinimumSize(640, 600);
      studioWindow.setContentSize(1080, 700);
    });
    await navigate(`/projects/${projectId}/write`);
    await expect(page.locator(".writing-studio")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByTitle("收起侧栏").click();
    await expect(page.locator(".writing-studio")).toHaveClass(
      /right-collapsed/u,
    );
    expect(
      (await page.locator(".chapter-assistant").boundingBox())?.width ?? 0,
    ).toBeLessThanOrEqual(2);

    await application.evaluate(({ BrowserWindow }) => {
      const studioWindow = BrowserWindow.getAllWindows()[0];
      if (!studioWindow) throw new Error("Studio window is unavailable");
      studioWindow.setContentSize(760, 700);
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await application.close();
    await rm(testUserData, { recursive: true, force: true });
  }
});
