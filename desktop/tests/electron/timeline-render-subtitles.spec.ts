import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioClient } from "@dramaip/client";
import { ServerConnectionManager } from "@dramaip/server-connection";
import type { TimelineRenderJob } from "@dramaip/contracts/timeline";

const ffmpeg = process.env.DRAMAIP_TEST_FFMPEG_PATH,
  ffprobe = process.env.DRAMAIP_TEST_FFPROBE_PATH,
  fontPath = process.env.DRAMAIP_TEST_SUBTITLE_FONT_PATH;
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function execute(path: string, args: string[]) {
  const result = spawnSync(path, args, {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  expect(result.error, result.stderr?.toString()).toBeUndefined();
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}
test("后台普通字幕界面冻结原字体与字面文字；真实烧录／原键恢复／同策略重试／omit及坏字体重启不自动换源", async ({}, info) => {
  test.skip(
    !ffmpeg || !ffprobe || !fontPath,
    "须显式提供本地工具与本机测试字体；不下载／分发或把未执行算通过。",
  );
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-subtitle-ui-"));
  let application: ElectronApplication | undefined,
    manager: ServerConnectionManager | undefined;
  let evidenceGets = 0;
  try {
    const sidecars = join(userData, "renderer-sidecars", "active");
    await mkdir(sidecars, { recursive: true });
    const keys = generateKeyPairSync("ed25519"),
      publicKeyPem = keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
    for (const [source, name, manifestName] of [
      [ffmpeg!, "ffmpeg", "render-manifest.json"],
      [ffprobe!, "ffprobe", "manifest.json"],
    ]) {
      const target = join(
        sidecars,
        process.platform === "win32" ? `${name}.exe` : name!,
      );
      await copyFile(source!, target);
      await chmod(target, 0o700);
      const unsigned = {
        version: "0.0.0-controlled-local",
        platform: process.platform,
        arch: process.arch,
        url: `https://fixtures.invalid/local/${name}`,
        sha256: sha(await readFile(target)),
        license: "LOCAL-TEST-ONLY-NOT-DISTRIBUTION",
        sourceUrl: "https://fixtures.invalid/local/source",
        buildRecipeUrl: "https://fixtures.invalid/local/recipe",
      };
      await writeFile(
        join(sidecars, manifestName!),
        JSON.stringify({
          ...unsigned,
          signature: sign(
            null,
            Buffer.from(JSON.stringify(unsigned)),
            keys.privateKey,
          ).toString("base64"),
        }),
        { mode: 0o600 },
      );
    }
    const fontRoot = join(userData, "renderer-fonts", "active"),
      fontId = crypto.randomUUID(),
      fontBytes = await readFile(fontPath!);
    await mkdir(join(fontRoot, "fonts"), { recursive: true });
    const privateFont = join(fontRoot, "fonts", `${fontId}.ttf`);
    await writeFile(privateFont, fontBytes, { mode: 0o600 });
    const fontKeys = generateKeyPairSync("ed25519"),
      fontRef = {
        id: fontId,
        packVersion: "0.0.0-local-test",
        sha256: sha(fontBytes),
      };
    const fontManifest = {
      format: "dramaip-renderer-font-pack",
      version: 1,
      packVersion: fontRef.packVersion,
      fonts: [
        {
          id: fontId,
          label: "本机隔离测试字体，非发行字体",
          sha256: fontRef.sha256,
          sizeBytes: fontBytes.length,
          license: "LOCAL-TEST-ONLY-NOT-DISTRIBUTION",
          sourceUrl: "https://fixtures.invalid/font",
        },
      ],
    };
    await writeFile(
      join(fontRoot, "fonts-manifest.json"),
      JSON.stringify({
        ...fontManifest,
        signature: sign(
          null,
          Buffer.from(JSON.stringify(fontManifest)),
          fontKeys.privateKey,
        ).toString("base64"),
      }),
      { mode: 0o600 },
    );
    const env = {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
      DRAMAIP_RENDERER_MANIFEST_PUBLIC_KEY_PEM: publicKeyPem,
      DRAMAIP_RENDERER_FONT_PUBLIC_KEY_PEM: fontKeys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    };
    const library = join(userData, "media-library");
    await mkdir(library);
    const mediaRef = crypto.randomUUID(),
      sourceFile = join(library, `${mediaRef}.mp4`);
    execute(ffmpeg!, [
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25",
      "-frames:v",
      "12",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      sourceFile,
    ]);
    const sourceBytes = await readFile(sourceFile);
    const launch = async () => {
      application = await electron.launch({
        args: [resolve("apps/desktop/out/main/index.js")],
        env,
      });
      const page = await application.firstWindow();
      page.on("request", (request) => {
        if (request.url().includes("/delivery-evidence?")) evidenceGets++;
      });
      await page.setViewportSize({ width: 1800, height: 1100 });
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      manager = new ServerConnectionManager();
      await manager.attach({
        ...(await page.evaluate(() => window.runtimeBootstrap.resolve())),
        source: "spawned",
      });
      return { page, client: createStudioClient(manager.createTransport()) };
    };
    let { page, client } = await launch();
    const hidden = () =>
      application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      );
    expect(await hidden()).toBe(true);
    const { project } = await client.projects.create({
      title: "真实字幕后台测试，不是发行／质量认证",
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
        title: `实际字幕 ${kind}`,
        payload: { 时长: 0.48 },
      });
      records.push(record);
      parentId = record.id;
    }
    const episodeId = records[1]!.id,
      asset = await client.resources.create("video", {
        projectId: project.id,
        parentId,
        title: "原黑色视频",
        payload: { mediaRef, 预览类型: "video" },
      });
    const seeded = spawnSync(
      "bun",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]),v=JSON.parse(process.argv[2]); db.prepare(\"INSERT INTO media_artifacts(artifact_id,media_record_id,project_id,media_ref,kind,mime_type,extension,size_bytes,sha256,status,created_at) VALUES(?,?,?,?,'video','video/mp4','.mp4',?,?,'archived',?)\").run(v.artifactId,v.recordId,v.projectId,v.mediaRef,v.sizeBytes,v.sha256,new Date().toISOString());db.close();",
        join(userData, "dramaip.db"),
        JSON.stringify({
          artifactId: crypto.randomUUID(),
          recordId: asset.id,
          projectId: project.id,
          mediaRef,
          sizeBytes: sourceBytes.length,
          sha256: sha(sourceBytes),
        }),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    expect(seeded.status, seeded.stderr).toBe(0);
    let timeline = await client.timeline.get(episodeId);
    timeline = await client.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "relink",
        clipId: timeline.tracks[0]!.clips[0]!.id,
        assetId: asset.id,
      },
    });
    const literal = "字幕 %{n}",
      draft = await client.episodeMedia.createAudioTrack({
        projectId: project.id,
        episodeId,
        kind: "narration",
        label: "完整原字幕",
        clips: [
          {
            shotId: records[4]!.id,
            startSeconds: 0.08,
            durationSeconds: 0.2,
            text: literal,
          },
        ],
      });
    const adopted = await client.episodeMedia.adoptAudioTrack(
      draft.id,
      draft.version,
      crypto.randomUUID(),
    );
    const assembly = await client.timeline.audioAssemblyPreview(episodeId);
    timeline = await client.timeline.applyAudioAssembly(
      episodeId,
      {
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        sourceFingerprint: assembly.sourceFingerprint,
        audioTrackIds: [adopted.id],
        includeSubtitles: true,
      },
      crypto.randomUUID(),
    );
    timeline = await client.timeline.command(timeline.id, {
      version: timeline.version,
      command: {
        type: "set-track-audio",
        trackId: timeline.tracks.find((track) => track.kind === "narration")!
          .id,
        muted: true,
      },
    });
    const frozen = structuredClone(timeline),
      subtitlePolicy = {
        version: 1 as const,
        mode: "burn-in" as const,
        font: fontRef,
      };
    expect(timeline.durationFrames).toBe(12);
    expect(
      timeline.tracks.find((track) => track.kind === "subtitle")!.clips[0],
    ).toMatchObject({ text: literal, startFrame: 2, durationFrames: 5 });
    const renderPath = `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId, stage: "renders" })}`;
    const open = async (target: Page) => {
      await target.evaluate((value) => {
        window.location.hash = value;
      }, renderPath);
      await target.reload();
      await expect(target.getByTestId("timeline-render-panel")).toBeVisible();
    };
    await open(page);
    const panel = () => page.getByTestId("timeline-render-panel"),
      check = () =>
        panel().getByRole("button", {
          name: "核对实际来源与渲染能力",
          exact: true,
        });
    const chooseBurn = async () => {
      await check().click();
      await expect(
        panel().getByTestId("timeline-render-subtitle-controls"),
      ).toContainText("原字体已通过");
      await panel().getByLabel("字幕输出策略").selectOption("burn-in");
      await expect(panel().getByLabel("烧录字幕字体")).toHaveValue("");
      await expect(panel().getByRole("checkbox")).toBeDisabled();
      await panel()
        .getByLabel("烧录字幕字体")
        .selectOption(JSON.stringify(fontRef));
      await check().click();
      await expect(
        panel().getByTestId("timeline-render-preflight"),
      ).toContainText("冻结输入预检通过");
      await expect(panel().getByRole("checkbox")).not.toBeChecked();
    };
    const waitJob = async (id: string) => {
      let result: TimelineRenderJob | undefined;
      await expect
        .poll(
          async () => {
            result = await client.timelineRenders.get(id, timeline.id);
            return !["queued", "running"].includes(result.status);
          },
          { timeout: 60_000 },
        )
        .toBe(true);
      return result!;
    };
    const pixels = (job: TimelineRenderJob) =>
      execute(ffmpeg!, [
        "-nostdin",
        "-v",
        "error",
        "-i",
        join(library, `${job.outputMediaRef}.mp4`),
        "-map",
        "0:v:0",
        "-vf",
        "crop=888:480:96:1344",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
    const ink = (bytes: Buffer, frame: number) => {
      let count = 0;
      for (const value of bytes.subarray(
        frame * 888 * 480,
        (frame + 1) * 888 * 480,
      ))
        if (value > 32) count++;
      return count;
    };
    await expect(panel().getByLabel("字幕输出策略")).toHaveValue("");
    await chooseBurn();
    await expect(panel()).toContainText("不是授权核验");
    const createPattern = `**/api/v2/timelines/${timeline.id}/renders`;
    let droppedCreates = 0;
    await page.route(createPattern, async (route) => {
      droppedCreates++;
      await route.fetch();
      await route.abort("failed");
    });
    await panel().getByRole("checkbox").check();
    await panel()
      .getByRole("button", { name: "创建本次字幕混音渲染", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-pending-request"),
    ).toBeVisible();
    await expect(panel()).toContainText("请求结果未能核对");
    const storage = `dramaip.timeline-render:${project.id}:${episodeId}`,
      pending = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storage,
      );
    expect(pending.input.subtitlePolicy).toEqual(subtitlePolicy);
    expect(pending.timelineId).toBe(frozen.id);
    expect(pending.version).toBe(frozen.version);
    expect(pending).not.toHaveProperty("confirmed");
    expect(JSON.stringify(pending)).not.toContain(literal);
    expect(JSON.stringify(pending)).not.toContain("license");
    await page.unroute(createPattern);
    await page.reload();
    await expect(panel()).toContainText("已找回同一原请求");
    expect(droppedCreates).toBe(1);
    await expect(panel().getByLabel("字幕输出策略")).toHaveValue("");
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    const first = (await client.timelineRenders.list(project.id, episodeId))
        .items[0]!,
      burned = await waitJob(first.jobId);
    expect(burned.status, JSON.stringify(burned)).toBe("succeeded");
    expect(burned.requestFingerprint).toBe(sha(Buffer.from(pending.key)));
    expect(burned.sourceFingerprint).toBe(pending.input.sourceFingerprint);
    expect(
      (await client.timelineRenders.list(project.id, episodeId)).items,
    ).toHaveLength(1);
    expect(burned.subtitlePolicy).toEqual(subtitlePolicy);
    const burnedPixels = pixels(burned);
    expect(burnedPixels.length).toBe(12 * 888 * 480);
    for (let frame = 0; frame < 12; frame++)
      expect(ink(burnedPixels, frame) > 100).toBe(frame >= 2 && frame < 7);
    expect(await client.timeline.get(episodeId)).toEqual(frozen);
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      burned.jobId,
    );
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "渲染文件已归档",
    );
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      fontRef.sha256,
    );
    const player = panel().getByTestId(
      `media-playback-${burned.outputRecord!.id}`,
    );
    const evidence = () =>
        panel().getByTestId(
          `media-delivery-evidence-${burned.outputRecord!.id}`,
        ),
      evidencePattern = `**/media-records/${burned.outputRecord!.id}/delivery-evidence?*`;
    let contentGets = 0;
    page.on("request", (request) => {
      if (
        request
          .url()
          .includes(
            `/media-records/${burned.outputRecord!.id}/playback/content?`,
          )
      )
        contentGets++;
    });
    await expect(evidence()).toContainText("尚未核对");
    expect(evidenceGets).toBe(0);
    await evidence()
      .getByRole("button", { name: "核对原素材交付证据", exact: true })
      .click();
    await expect(
      evidence().getByTestId("media-delivery-evidence-result"),
    ).toContainText("没有已记录的原版本完整读取凭证");
    expect(evidenceGets).toBe(1);
    expect(contentGets).toBe(0);
    const outputRecord = await client.resources.get(
        "video",
        burned.outputRecord!.id,
      ),
      descriptor = await client.mediaPlayback.describe(
        burned.outputRecord!.id,
        project.id,
        burned.outputRecord!.version,
      ),
      receipt = await client.mediaPlayback.verifyBytes(
        descriptor,
        crypto.randomUUID(),
      );
    const originalEvidence = await client.mediaPlayback.deliveryEvidence(
      burned.outputRecord!.id,
      project.id,
      burned.outputRecord!.version,
    );
    expect(originalEvidence).toMatchObject({
      releaseReady: false,
      currentFileIntegrity: "not-read",
      qualityState: "unverified",
      settlementState: "unknown",
      latestByteRead: {
        id: receipt.id,
        currentArchiveBinding: "matching-archive-metadata",
      },
    });
    const outputFile = join(library, `${burned.outputMediaRef}.mp4`),
      outputBytes = await readFile(outputFile),
      corruptOutput = Buffer.from(outputBytes);
    corruptOutput[corruptOutput.length - 1] ^= 1;
    await writeFile(outputFile, corruptOutput);
    await evidence()
      .getByRole("button", { name: "核对原素材交付证据", exact: true })
      .click();
    await expect(
      evidence().getByTestId("media-delivery-evidence-result"),
    ).toContainText(receipt.id);
    await expect(evidence()).toContainText("当前文件未读取");
    expect(
      await client.mediaPlayback.deliveryEvidence(
        burned.outputRecord!.id,
        project.id,
        burned.outputRecord!.version,
      ),
    ).toEqual(originalEvidence);
    await expect(
      client.mediaPlayback.open(
        burned.outputRecord!.id,
        project.id,
        burned.outputRecord!.version,
      ),
    ).rejects.toThrow();
    await writeFile(outputFile, outputBytes);
    expect(contentGets).toBe(0);
    expect(
      await client.resources.get("video", burned.outputRecord!.id),
    ).toEqual(outputRecord);
    await evidence().screenshot({
      path: info.outputPath(
        "exact-evidence-historical-read-is-not-current-approval.png",
      ),
    });
    // A genuinely delayed original HTTP response must not restore a canceled view.
    let releaseEvidence!: () => void,
      captured!: () => void,
      finished!: () => void;
    const hold = new Promise<void>((resolve) => {
        releaseEvidence = resolve;
      }),
      started = new Promise<void>((resolve) => {
        captured = resolve;
      }),
      ended = new Promise<void>((resolve) => {
        finished = resolve;
      });
    await page.route(evidencePattern, async (route) => {
      const response = await route.fetch();
      captured();
      await hold;
      try {
        await route.fulfill({ response });
      } finally {
        finished();
      }
    });
    await evidence()
      .getByRole("button", { name: "核对原素材交付证据", exact: true })
      .click();
    await started;
    await expect(
      evidence().getByTestId("media-delivery-evidence-result"),
    ).toHaveCount(0);
    await evidence()
      .getByRole("button", { name: "停止证据读取", exact: true })
      .click();
    releaseEvidence();
    await ended;
    await page.unroute(evidencePattern);
    await expect(evidence()).toContainText("尚未核对");
    await expect(
      evidence().getByTestId("media-delivery-evidence-result"),
    ).toHaveCount(0);
    await page.reload();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      burned.jobId,
    );
    await expect(evidence()).toContainText("尚未核对");
    expect(evidenceGets).toBe(3);
    expect(contentGets).toBe(0);
    await expect(player.locator("video")).toHaveCount(0);
    await player
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        player
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await player.locator("video").evaluate((node: HTMLVideoElement) => {
      node.currentTime = 0.12;
      node.muted = true;
    });
    await expect
      .poll(() =>
        player.locator("video").evaluate((node: HTMLVideoElement) => ({
          seeking: node.seeking,
          time: node.currentTime,
          width: node.videoWidth,
          height: node.videoHeight,
          muted: node.muted,
        })),
      )
      .toEqual({
        seeking: false,
        time: 0.12,
        width: 1080,
        height: 1920,
        muted: true,
      });
    await panel().screenshot({
      path: info.outputPath("actual-frozen-subtitle-policy-and-player.png"),
    });
    expect(await hidden()).toBe(true);
    const corruptSource = Buffer.from(sourceBytes);
    corruptSource[corruptSource.length - 1] ^= 1;
    await writeFile(sourceFile, corruptSource);
    await chooseBurn();
    await panel().getByRole("checkbox").check();
    const failedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/timelines/${timeline.id}/renders`),
    );
    await panel()
      .getByRole("button", { name: "创建本次字幕混音渲染", exact: true })
      .click();
    const failed = await waitJob(
      ((await (await failedResponse).json()) as TimelineRenderJob).jobId,
    );
    expect(failed.status).toBe("failed");
    expect(failed.subtitlePolicy).toEqual(subtitlePolicy);
    expect(failed.outputMediaRef).toBeUndefined();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "失败",
    );
    await writeFile(sourceFile, sourceBytes);
    await panel().getByLabel("字幕输出策略").selectOption("omit");
    await check().click();
    await panel().getByRole("checkbox").check();
    await expect(
      panel().getByRole("button", { name: "明确重试原任务来源", exact: true }),
    ).toBeDisabled();
    await chooseBurn();
    await panel().getByRole("checkbox").check();
    const retryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/timeline-renders/${failed.jobId}/retry`),
    );
    await panel()
      .getByRole("button", { name: "明确重试原任务来源", exact: true })
      .click();
    const retried = await waitJob(
      ((await (await retryResponse).json()) as TimelineRenderJob).jobId,
    );
    expect(retried.status).toBe("succeeded");
    expect(retried.subtitlePolicy).toEqual(subtitlePolicy);
    expect(retried.sourceFingerprint).toBe(failed.sourceFingerprint);
    expect(retried.jobId).not.toBe(failed.jobId);
    expect(
      (await client.timelineRenders.get(failed.jobId, timeline.id)).status,
    ).toBe("failed");
    const retriedPixels = pixels(retried);
    for (let frame = 0; frame < 12; frame++)
      expect(ink(retriedPixels, frame) > 100).toBe(frame >= 2 && frame < 7);
    await panel().getByLabel("字幕输出策略").selectOption("omit");
    await check().click();
    await panel().getByRole("checkbox").check();
    const omitResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/timelines/${timeline.id}/renders`),
    );
    await panel()
      .getByRole("button", { name: "创建本次混音渲染", exact: true })
      .click();
    const omitted = await waitJob(
      ((await (await omitResponse).json()) as TimelineRenderJob).jobId,
    );
    expect(omitted.status).toBe("succeeded");
    expect(omitted.subtitlePolicy).toEqual({ version: 1, mode: "omit" });
    expect(omitted.sourceFingerprint).not.toBe(burned.sourceFingerprint);
    const omittedPixels = pixels(omitted);
    for (let frame = 0; frame < 12; frame++)
      expect(ink(omittedPixels, frame)).toBe(0);
    expect(
      (await client.timelineRenders.list(project.id, episodeId)).items,
    ).toHaveLength(4);
    manager!.disconnect();
    manager = undefined;
    await application!.close();
    application = undefined;
    const badFont = Buffer.from(fontBytes);
    badFont[badFont.length - 1] ^= 1;
    await writeFile(privateFont, badFont);
    ({ page, client } = await launch());
    await open(page);
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    await expect(panel().getByLabel("字幕输出策略")).toHaveValue("");
    await check().click();
    await expect(
      panel().getByTestId("timeline-render-subtitle-controls"),
    ).toContainText("当前没有已验证");
    await expect(
      panel().getByLabel("字幕输出策略").locator('option[value="burn-in"]'),
    ).toHaveJSProperty("disabled", true);
    await panel()
      .getByRole("button", { name: new RegExp(burned.jobId) })
      .click();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      fontRef.sha256,
    );
    const unavailable = await client.timelineRenders.preflight(
      timeline.id,
      timeline.version,
      undefined,
      subtitlePolicy,
    );
    expect(unavailable.ready).toBe(false);
    expect(
      (await client.timelineRenders.list(project.id, episodeId)).items,
    ).toHaveLength(4);
    expect(await client.timeline.get(episodeId)).toEqual(frozen);
    await panel().screenshot({
      path: info.outputPath(
        "original-font-policy-survives-unavailable-font-restart.png",
      ),
    });
    expect(evidenceGets).toBe(3);
    await client.resources.update("video", burned.outputRecord!.id, {
      version: burned.outputRecord!.version,
      title: "later output metadata, not original evidence",
    });
    await evidence()
      .getByRole("button", { name: "核对原素材交付证据", exact: true })
      .click();
    await expect(evidence().getByRole("alert")).toContainText("原证据未核全");
    await expect(
      evidence().getByTestId("media-delivery-evidence-result"),
    ).toHaveCount(0);
    expect(await hidden()).toBe(true);
    manager!.disconnect();
    manager = undefined;
    await application!.close();
    application = undefined;
    expect(
      (await readdir(library)).filter((name) => name.startsWith("render-job-")),
    ).toHaveLength(0);
  } finally {
    manager?.disconnect();
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
