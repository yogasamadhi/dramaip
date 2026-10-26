import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
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
import {
  TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  type TimelineRenderCreateInput,
} from "@dramaip/contracts/timeline";
import { openProductionStage, selectWorkspaceObject } from "./project-tools";

// Opt-in local executables only, never downloads/installs or bypasses the product signature checks.
const ffmpeg = process.env.DRAMAIP_TEST_FFMPEG_PATH;
const ffprobe = process.env.DRAMAIP_TEST_FFPROBE_PATH;
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

test("后台实际渲染界面以原键恢复未知结果；冻结成片读播、重启、取消与等长篡改失败不自动换源", async ({}, info) => {
  test.skip(
    !ffmpeg || !ffprobe,
    "需显式指定已安装的本地 FFmpeg／FFprobe；不自动下载，也不把未执行算作通过。",
  );
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "dramaip-render-owner-ui-"));
  let application: ElectronApplication | undefined;
  let manager: ServerConnectionManager | undefined;
  try {
    const root = join(userData, "renderer-sidecars", "active");
    await mkdir(root, { recursive: true });
    const keys = generateKeyPairSync("ed25519");
    const publicKeyPem = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    for (const [source, name, manifestName] of [
      [ffmpeg!, "ffmpeg", "render-manifest.json"],
      [ffprobe!, "ffprobe", "manifest.json"],
    ]) {
      const target = join(
        root,
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
        license: "LOCAL-TEST-ONLY-NOT-A-DISTRIBUTION",
        sourceUrl: "https://fixtures.invalid/local/source",
        buildRecipeUrl: "https://fixtures.invalid/local/recipe",
      };
      const signature = sign(
        null,
        Buffer.from(JSON.stringify(unsigned)),
        keys.privateKey,
      ).toString("base64");
      await writeFile(
        join(root, manifestName!),
        JSON.stringify({ ...unsigned, signature }),
        { mode: 0o600 },
      );
    }
    const library = join(userData, "media-library");
    await mkdir(library, { mode: 0o700 });
    const mediaRef = crypto.randomUUID();
    const sourceFile = join(library, `${mediaRef}.mp4`);
    execute(ffmpeg!, [
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=500:sample_rate=48000:duration=3",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      sourceFile,
    ]);
    const originalBytes = await readFile(sourceFile);
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_RENDERER_MANIFEST_PUBLIC_KEY_PEM: publicKeyPem,
      },
    });
    let page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible(
      { timeout: 30_000 },
    );
    const hidden = () =>
      application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) => !window.isVisible() && !window.isFocused(),
        ),
      );
    expect(await hidden()).toBe(true);
    const bootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...bootstrap, source: "spawned" });
    let client = createStudioClient(manager.createTransport());
    const { project } = await client.projects.create({
      title: "实际静音渲染（本地受控，不是服务商质量／发行）",
    });
    let parentId: string | undefined;
    const records = [];
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
        title: `实际渲染 ${kind}`,
        payload: { 动作: "蓝色本地受控画面", 时长: 3 },
      });
      parentId = record.id;
      records.push(record);
    }
    const asset = await client.resources.create("video", {
      projectId: project.id,
      parentId,
      title: "冻结本地 MP4",
      payload: { mediaRef: crypto.randomUUID(), 预览类型: "video" },
    });
    const seeded = spawnSync(
      "node",
      [
        "scripts/run-node.mjs",
        "--input-type=module",
        "--eval",
        "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); const v=JSON.parse(process.argv[2]); db.prepare(\"INSERT INTO media_artifacts(artifact_id,media_record_id,project_id,media_ref,kind,mime_type,extension,size_bytes,sha256,status,created_at) VALUES(?,?,?,?,'video','video/mp4','.mp4',?,?,'archived',?)\").run(v.artifactId,v.recordId,v.projectId,v.mediaRef,v.sizeBytes,v.sha256,new Date().toISOString());db.close();",
        join(userData, "dramaip.db"),
        JSON.stringify({
          artifactId: crypto.randomUUID(),
          recordId: asset.id,
          projectId: project.id,
          mediaRef,
          sizeBytes: originalBytes.length,
          sha256: sha(originalBytes),
        }),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    expect(seeded.status, seeded.stderr).toBe(0);
    let timeline = await client.timeline.get(records[1]!.id);
    const clip = timeline.tracks.find((track) => track.kind === "video")!
      .clips[0]!;
    const change = async (
      command: import("@dramaip/contracts/timeline").TimelineEditCommand,
    ) => {
      timeline = await client.timeline.command(timeline.id, {
        version: timeline.version,
        command,
      });
    };
    await change({ type: "relink", clipId: clip.id, assetId: asset.id });
    await change({ type: "trim", clipId: clip.id, durationFrames: 50 });
    await change({ type: "split", clipId: clip.id, atFrame: 25 });
    const second = timeline.tracks.find((track) => track.kind === "video")!
      .clips[1]!;
    await change({ type: "move", clipId: second.id, startFrame: 50 }); // Actual 1s black gap, then source offset 1s.
    await change({
      type: "set-track-audio",
      trackId: timeline.tracks.find((track) => track.kind === "video")!.id,
      muted: true,
    });
    const frozen = timeline;
    const preflight = await client.timelineRenders.preflight(
      timeline.id,
      timeline.version,
      undefined,
      { version: 1, mode: "omit" },
    );
    expect(preflight.ready, preflight.blockers.join("；")).toBe(true);
    expect(preflight.warnings.join("；")).toContain("静音");
    const input: TimelineRenderCreateInput = {
      timelineProfileVersion: preflight.profileVersion,
      rendererVersion: preflight.rendererVersion!,
      sidecarArtifactVersion: preflight.sidecarArtifactVersion!,
      sourceFingerprint: preflight.sourceFingerprint!,
      subtitlePolicy: preflight.subtitlePolicy,
    };
    const renderPath = `/produce?${new URLSearchParams({ projectId: project.id, adaptationId: records[0]!.id, episodeId: records[1]!.id, stage: "renders" })}`;
    await page.evaluate((value) => {
      window.location.hash = value;
    }, renderPath);
    await page.reload();
    const panel = () => page.getByTestId("timeline-render-panel");
    await expect(panel()).toBeVisible();
    await expect(
      panel().getByRole("button", { name: "创建本次混音渲染", exact: true }),
    ).toBeDisabled();
    await expect(panel().getByLabel("字幕输出策略")).toHaveValue("");
    await panel()
      .getByRole("button", { name: "核对实际来源与渲染能力", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-preflight"),
    ).toContainText("尚未明确字幕策略");
    await expect(panel().getByRole("checkbox")).toBeDisabled();
    await panel().getByLabel("字幕输出策略").selectOption("omit");
    await panel()
      .getByRole("button", { name: "核对实际来源与渲染能力", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-preflight"),
    ).toContainText("冻结输入预检通过");
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    const createPattern = `**/api/v2/timelines/${timeline.id}/renders`;
    let creates = 0;
    // The Runtime accepts the real request, but its browser reply is lost. Recovery must not dispatch another write.
    await page.route(createPattern, async (route) => {
      creates++;
      await route.fetch();
      await route.abort("failed");
    });
    await panel().getByRole("checkbox").check();
    await panel()
      .getByRole("button", { name: "创建本次混音渲染", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-pending-request"),
    ).toBeVisible();
    await expect(panel()).toContainText("请求结果未能核对");
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      `dramaip.timeline-render:${project.id}:${records[1]!.id}`,
    );
    expect(saved.input).toEqual(input);
    expect(saved.version).toBe(frozen.version);
    expect(saved).not.toHaveProperty("confirmed");
    expect(saved).not.toHaveProperty("timeline");
    const key: string = saved.key;
    await page.unroute(createPattern);
    await page.reload();
    await expect(panel().getByTestId("timeline-render-job")).toBeVisible();
    await expect(
      panel().getByTestId("timeline-render-pending-request"),
    ).toHaveCount(0);
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    expect(creates).toBe(1);
    const history = await client.timelineRenders.list(
      project.id,
      records[1]!.id,
    );
    expect(history.items).toHaveLength(1);
    let job = history.items[0]!;
    await expect
      .poll(
        async () => {
          job = await client.timelineRenders.get(job.jobId, timeline.id);
          return !["queued", "running"].includes(job.status);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    expect(job.sourceFingerprint).toBe(input.sourceFingerprint);
    expect(
      (
        await client.timelineRenders.create(
          timeline.id,
          timeline.version,
          input,
          key,
        )
      ).jobId,
    ).toBe(job.jobId);
    const outputs = await client.resources.list(
      "video",
      project.id,
      records[1]!.id,
    );
    expect(outputs).toHaveLength(1);
    const output = await client.mediaSources.record(outputs[0]!.id);
    expect(output.payload.lineage).toMatchObject({
      timelineVersion: frozen.version,
      sourceFingerprint: input.sourceFingerprint,
    });
    expect(job.outputRecord).toEqual({
      id: output.id,
      projectId: project.id,
      version: output.version,
    });
    const bytes = await client.mediaPlayback.open(
      output.id,
      project.id,
      output.version,
    );
    const outputBytes = new Uint8Array(await bytes.blob.arrayBuffer());
    expect(sha(outputBytes)).toBe(job.outputSha256);
    const outputFile = join(library, `${job.outputMediaRef}.mp4`);
    const probe = JSON.parse(
      execute(ffprobe!, [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        outputFile,
      ]).toString(),
    ) as { streams: Record<string, unknown>[] };
    const video = probe.streams.find(
      (stream) => stream.codec_type === "video",
    )!;
    expect(video).toMatchObject({
      codec_name: "h264",
      width: 1080,
      height: 1920,
      avg_frame_rate: "25/1",
      nb_frames: "75",
    });
    expect(
      probe.streams.find((stream) => stream.codec_type === "audio"),
    ).toMatchObject({ codec_name: "aac", sample_rate: "48000", channels: 2 });
    const sample = (seconds: string) => [
      ...execute(ffmpeg!, [
        "-nostdin",
        "-v",
        "error",
        "-ss",
        seconds,
        "-i",
        outputFile,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]),
    ];
    expect(sample("0.5")[2]).toBeGreaterThan(200);
    expect(Math.max(...sample("1.5"))).toBeLessThan(10);
    expect(sample("2.5")[2]).toBeGreaterThan(200);
    expect(await client.timeline.get(records[1]!.id)).toEqual(frozen);
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "渲染文件已归档",
      { timeout: 15_000 },
    );
    const player = () => panel().getByTestId(`media-playback-${output.id}`);
    await expect(player().locator("video")).toHaveCount(0);
    await player()
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect
      .poll(() =>
        player()
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await player()
      .locator("video")
      .evaluate(async (node: HTMLVideoElement) => {
        node.muted = true;
        node.currentTime = 2.5;
        await node.play();
      });
    await expect
      .poll(() =>
        player()
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeGreaterThan(2.5);
    await player()
      .locator("video")
      .evaluate((node: HTMLVideoElement) => node.pause());
    await panel().screenshot({
      path: info.outputPath("actual-frozen-render.png"),
    });
    const blobUrl = await player()
      .locator("video")
      .evaluate((node: HTMLVideoElement) => node.currentSrc);
    await player()
      .getByRole("button", { name: "停止并释放媒体", exact: true })
      .click();
    await expect(player().locator("video")).toHaveCount(0);
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return true;
        } catch {
          return false;
        }
      }, blobUrl),
    ).toBe(false);
    manager.disconnect();
    manager = undefined;
    await application.close();
    application = undefined;
    application = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_RENDERER_MANIFEST_PUBLIC_KEY_PEM: publicKeyPem,
      },
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1800, height: 1100 });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    const restoredBootstrap = await page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    manager = new ServerConnectionManager();
    await manager.attach({ ...restoredBootstrap, source: "spawned" });
    client = createStudioClient(manager.createTransport());
    await page.evaluate((value) => {
      window.location.hash = value;
    }, renderPath);
    await page.reload();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      job.jobId,
    );
    await expect(player().locator("video")).toHaveCount(0);
    await expect(panel().getByRole("checkbox")).not.toBeChecked();
    expect(
      (await client.timelineRenders.list(project.id, records[1]!.id)).items,
    ).toHaveLength(1);
    const pending = await client.timelineRenders.create(
      timeline.id,
      timeline.version,
      input,
      crypto.randomUUID(),
    );
    await panel()
      .getByRole("button", { name: "重新核对渲染历史", exact: true })
      .click();
    await panel()
      .getByRole("button", { name: new RegExp(pending.jobId) })
      .click();
    await panel()
      .getByRole("button", { name: "明确取消此任务", exact: true })
      .click();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "已取消",
    );
    expect(
      (await client.timelineRenders.get(pending.jobId, timeline.id)).status,
    ).toBe("canceled");
    expect(
      await client.resources.list("video", project.id, records[1]!.id),
    ).toHaveLength(1);
    const corrupt = Buffer.from(originalBytes);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(sourceFile, corrupt);
    expect(
      (await client.timelineRenders.preflight(timeline.id, timeline.version))
        .ready,
    ).toBe(true); // Metadata is not byte evidence.
    let rejected = await client.timelineRenders.create(
      timeline.id,
      timeline.version,
      input,
      crypto.randomUUID(),
    );
    await expect
      .poll(async () => {
        rejected = await client.timelineRenders.get(
          rejected.jobId,
          timeline.id,
        );
        return rejected.status;
      })
      .toBe("failed");
    expect(rejected).not.toHaveProperty("outputMediaRef");
    expect(
      await client.resources.list("video", project.id, records[1]!.id),
    ).toHaveLength(1);
    await writeFile(sourceFile, originalBytes);
    let retried = await client.timelineRenders.retry(
      rejected.jobId,
      timeline.id,
      timeline.version,
      input,
      crypto.randomUUID(),
    );
    await expect
      .poll(
        async () => {
          retried = await client.timelineRenders.get(
            retried.jobId,
            timeline.id,
          );
          return !["queued", "running"].includes(retried.status);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(retried.status, JSON.stringify(retried)).toBe("succeeded");
    expect(retried.sourceFingerprint).toBe(rejected.sourceFingerprint);
    await panel()
      .getByRole("button", { name: "重新核对渲染历史", exact: true })
      .click();
    await panel()
      .getByRole("button", { name: new RegExp(rejected.jobId) })
      .click();
    await panel().getByLabel("字幕输出策略").selectOption("omit");
    await panel()
      .getByRole("button", { name: "核对实际来源与渲染能力", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-preflight"),
    ).toContainText("冻结输入预检通过");
    await expect(
      panel().getByRole("button", { name: "明确重试原任务来源", exact: true }),
    ).toBeDisabled();
    await panel().getByRole("checkbox").check();
    await panel()
      .getByRole("button", { name: "明确重试原任务来源", exact: true })
      .click();
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "渲染文件已归档",
      { timeout: 15_000 },
    );
    const lastId = await panel()
      .getByTestId("timeline-render-job")
      .getByText(/指定任务/)
      .innerText();
    expect(lastId).not.toContain(rejected.jobId);
    await panel().screenshot({
      path: info.outputPath("explicit-render-retry.png"),
    });
    const newest = (
      await client.timelineRenders.list(project.id, records[1]!.id)
    ).items[0]!;
    const newestOutput = newest.outputRecord!;
    await client.resources.update("video", newestOutput.id, {
      version: newestOutput.version,
      title: "后来编辑的输出记录",
    });
    await page.reload();
    const oldPlayer = panel().getByTestId(`media-playback-${newestOutput.id}`);
    await oldPlayer
      .getByRole("button", { name: "加载实际媒体", exact: true })
      .click();
    await expect(oldPlayer.getByRole("alert")).toContainText("版本");
    await expect(oldPlayer.locator("video")).toHaveCount(0);
    await panel().screenshot({
      path: info.outputPath("frozen-render-output-version-rejected.png"),
    });
    expect(await client.timeline.get(records[1]!.id)).toEqual(frozen);
    // The actual NLE UI must separate owner metadata from explicit complete byte verification.
    const manifest = await client.timeline.deliveryManifest(records[1]!.id);
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.media).toHaveLength(1);
    expect(manifest.media[0]).toMatchObject({
      assetId: asset.id,
      sourceVersion: asset.version,
      sourceStatus: "current",
      checksum: sha(originalBytes),
      rightsStatus: "unknown",
      archive: { verification: "owner-metadata-only" },
    });
    let nleReads = 0;
    await page.route(
      `**/api/v2/media-records/${asset.id}/playback/content?**`,
      async (route) => {
        nleReads++;
        await route.continue();
      },
    );
    await openProductionStage(page, "多轨时间线");
    const nle = () => page.getByLabel("NLE 交付与媒体核验");
    const verification = () => nle().getByTestId("nle-media-verification");
    await expect(
      verification().getByRole("button", {
        name: "核验清单媒体完整字节",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toHaveCount(0);
    expect(nleReads).toBe(0);
    await verification()
      .getByRole("button", { name: "核验清单媒体完整字节", exact: true })
      .click();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toContainText("本次完整字节核验 1／1");
    expect(nleReads).toBe(1);
    await nle().screenshot({
      path: info.outputPath("nle-owner-metadata-and-explicit-bytes.png"),
    });
    const byteReceipts = () =>
      verification().getByLabel(`持久字节凭证-${asset.id}`);
    await byteReceipts()
      .getByRole("button", { name: "核验并保存字节凭证", exact: true })
      .click();
    await expect(
      byteReceipts().getByTestId("media-byte-receipts-history"),
    ).toContainText("原字节凭证 1 条");
    const firstReceipts = await client.mediaPlayback.byteVerifications(
      asset.id,
      project.id,
      asset.version,
    );
    expect(firstReceipts.items).toHaveLength(1);
    expect(firstReceipts.items[0]).toMatchObject({
      descriptor: {
        recordId: asset.id,
        recordVersion: asset.version,
        sha256: sha(originalBytes),
      },
      currentBinding: "unchanged-metadata",
      rightsState: "unverified",
      qualityState: "unverified",
    });
    let droppedReceiptPosts = 0;
    const dropReceipt = `**/api/v2/media-records/${asset.id}/byte-verifications`;
    await page.route(dropReceipt, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      droppedReceiptPosts++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await byteReceipts()
      .getByRole("button", { name: "核验并保存字节凭证", exact: true })
      .click();
    await expect(byteReceipts().getByRole("alert")).toContainText("原请求保留");
    const pendingKeyText = await byteReceipts()
      .getByTestId("media-byte-receipts-pending")
      .innerText();
    expect(droppedReceiptPosts).toBe(1);
    await page.unroute(dropReceipt);
    await page.reload();
    await openProductionStage(page, "多轨时间线");
    await expect(
      byteReceipts().getByTestId("media-byte-receipts-pending"),
    ).toHaveText(pendingKeyText);
    await byteReceipts()
      .getByRole("button", { name: "只读恢复原字节凭证", exact: true })
      .click();
    await expect(
      byteReceipts().getByTestId("media-byte-receipts-history"),
    ).toContainText("原字节凭证 1 条");
    expect(droppedReceiptPosts).toBe(1);
    expect(nleReads).toBe(1);
    await byteReceipts()
      .getByRole("button", { name: "读取本版本字节凭证", exact: true })
      .click();
    await expect(
      byteReceipts().getByTestId("media-byte-receipts-history"),
    ).toContainText("原字节凭证 2 条");
    await nle().screenshot({
      path: info.outputPath(
        "nle-durable-byte-receipts-original-key-recovery.png",
      ),
    });
    await writeFile(sourceFile, corrupt);
    await verification()
      .getByRole("button", { name: "核验清单媒体完整字节", exact: true })
      .click();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toContainText("本次完整字节核验 0／1");
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toContainText("没有自动换源或重试");
    expect(nleReads).toBe(2);
    await nle().screenshot({
      path: info.outputPath("nle-equal-length-byte-tamper-rejected.png"),
    });
    await writeFile(sourceFile, originalBytes);
    await verification()
      .getByRole("button", { name: "核验清单媒体完整字节", exact: true })
      .click();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toContainText("本次完整字节核验 1／1");
    expect(nleReads).toBe(3);
    await page.reload();
    await expect(verification()).toBeVisible();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toHaveCount(0);
    expect(nleReads).toBe(3);
    await client.resources.update("video", asset.id, {
      version: asset.version,
      title: "实际源记录后续被编辑",
    });
    await page.reload();
    await verification()
      .getByRole("button", { name: "核验清单媒体完整字节", exact: true })
      .click();
    await expect(
      verification().getByTestId("nle-media-verification-result"),
    ).toContainText("本次完整字节核验 0／1");
    expect(nleReads).toBe(3); // No latest-version fallback and no bytes for the stale frozen clip.
    expect(await client.timeline.get(records[1]!.id)).toEqual(frozen);
    await openProductionStage(page, "成片渲染");
    const foreign = await client.projects.create({ title: "渲染页只读空项目" });
    const foreignAdaptation = await client.resources.create("adaptations", {
      projectId: foreign.project.id,
      title: "实际另一作品",
    });
    const foreignEpisode = await client.resources.create("episodes", {
      projectId: foreign.project.id,
      parentId: foreignAdaptation.id,
      title: "实际另一分集",
    });
    const foreignPath = `/produce?${new URLSearchParams({ projectId: foreign.project.id, adaptationId: foreignAdaptation.id, episodeId: foreignEpisode.id, stage: "renders" })}`;
    // Refresh the real directory and explicitly expand the advanced project
    // selector; GET ownership checks remain authoritative for exact links.
    await page.reload();
    await selectWorkspaceObject(page, "项目", foreign.project.id);
    await expect(panel()).toContainText("没有既有时间线");
    await page.evaluate((value) => {
      window.location.hash = value;
    }, foreignPath);
    await page.reload();
    await expect(panel()).toContainText("没有既有时间线");
    await expect(panel().getByTestId("timeline-render-job")).toHaveCount(0);
    await expect(panel().locator("video")).toHaveCount(0);
    const empty = await client.timelineRenders.list(
      foreign.project.id,
      foreignEpisode.id,
    );
    expect(empty.timeline).toBeUndefined();
    expect(empty.items).toEqual([]);
    await page.evaluate(
      ({ key, pending }) => localStorage.setItem(key, JSON.stringify(pending)),
      {
        key: `dramaip.timeline-render:${foreign.project.id}:${foreignEpisode.id}`,
        pending: saved,
      },
    );
    await page.reload();
    await expect(panel().getByRole("alert")).toContainText("不属于当前项目");
    await expect(
      panel().getByRole("button", { name: "创建本次混音渲染", exact: true }),
    ).toBeDisabled();
    expect(
      (await client.timelineRenders.list(foreign.project.id, foreignEpisode.id))
        .timeline,
    ).toBeUndefined();
    await panel().screenshot({
      path: info.outputPath("render-empty-project-recovery-scope.png"),
    });
    // A separate explicit new timeline binding must actually mix the embedded sound.
    // Do not rewrite the earlier muted job, its original request or its recovery evidence.
    await selectWorkspaceObject(page, "项目", project.id);
    timeline = await client.timeline.get(records[1]!.id);
    for (const item of timeline.tracks.find((track) => track.kind === "video")!
      .clips) {
      await change({ type: "relink", clipId: item.id, assetId: asset.id });
      await change({
        type: "set-clip-audio",
        clipId: item.id,
        volume: item.startFrame === 0 ? 0.4 : 1.2,
      });
    }
    await change({
      type: "set-track-audio",
      trackId: timeline.tracks.find((track) => track.kind === "video")!.id,
      muted: false,
    });
    const mixedPreflight = await client.timelineRenders.preflight(
      timeline.id,
      timeline.version,
      undefined,
      { version: 1, mode: "omit" },
    );
    expect(mixedPreflight.ready, mixedPreflight.blockers.join("；")).toBe(true);
    expect(mixedPreflight.profileVersion).toBe(
      TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    );
    expect(mixedPreflight.sourceFingerprint).not.toBe(input.sourceFingerprint);
    await page.evaluate((value) => {
      window.location.hash = value;
    }, renderPath);
    await page.reload();
    await expect(panel()).toContainText("本地实验混音渲染");
    await panel().getByLabel("字幕输出策略").selectOption("omit");
    await panel()
      .getByRole("button", { name: "核对实际来源与渲染能力", exact: true })
      .click();
    await expect(
      panel().getByTestId("timeline-render-preflight"),
    ).toContainText("冻结输入预检通过");
    await panel().getByRole("checkbox").check();
    const mixedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/v2/timelines/${timeline.id}/renders`),
    );
    await panel()
      .getByRole("button", { name: "创建本次混音渲染", exact: true })
      .click();
    const mixedReceipt = (await (
      await mixedResponse
    ).json()) as import("@dramaip/contracts/timeline").TimelineRenderJob;
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      mixedReceipt.jobId,
    );
    await expect(panel().getByTestId("timeline-render-job")).toContainText(
      "渲染文件已归档",
      { timeout: 60000 },
    );
    const mixedJob = await client.timelineRenders.get(
      mixedReceipt.jobId,
      timeline.id,
    );
    expect(mixedJob.status).toBe("succeeded");
    expect(mixedJob.timelineVersion).toBe(timeline.version);
    expect(mixedJob.sourceFingerprint).toBe(mixedPreflight.sourceFingerprint);
    expect(mixedJob.outputRecord).toBeDefined();
    const mixedPCM = execute(ffmpeg!, [
      "-nostdin",
      "-v",
      "error",
      "-i",
      join(library, `${mixedJob.outputMediaRef}.mp4`),
      "-map",
      "0:a:0",
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ]);
    expect(mixedPCM.length).toBeGreaterThanOrEqual(3 * 48000 * 8);
    const rms = (from: number, to: number) => {
      let square = 0;
      for (let sample = from * 48000; sample < to * 48000; sample++) {
        const value = mixedPCM.readFloatLE(sample * 8);
        if (!Number.isFinite(value))
          throw new Error("Actual encoded mix has a non-finite sample");
        square += value * value;
      }
      return Math.sqrt(square / ((to - from) * 48000));
    };
    const firstGain = rms(0.25, 0.75),
      secondGain = rms(2.25, 2.75);
    expect(firstGain).toBeGreaterThan(0.01);
    expect(secondGain / firstGain).toBeGreaterThan(2.7);
    expect(secondGain / firstGain).toBeLessThan(3.3);
    expect(rms(1.2, 1.8)).toBeLessThan(0.000001);
    await panel().screenshot({
      path: info.outputPath("actual-embedded-audio-mix-controls-and-gap.png"),
    });
    expect(await hidden()).toBe(true);
    manager.disconnect();
    manager = undefined;
    await application.close();
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
