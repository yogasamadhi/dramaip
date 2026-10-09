import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
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
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  createDesktopHost,
  DesktopHostClient,
  type DesktopHostActions,
  type HostTimelineRenderInput,
} from "@dramaip/desktop-host";
import { loadVerifiedFfmpeg, loadVerifiedFfprobe } from "./ffprobe-sidecar";
import { loadVerifiedRendererFonts } from "./renderer-fonts";
import { fontFixture, signedFontFixture } from "./renderer-font.fixture";
import { RenderSupervisor } from "./render-supervisor";

const ffmpegPath = process.env.DRAMAIP_TEST_FFMPEG_PATH,
  ffprobePath = process.env.DRAMAIP_TEST_FFPROBE_PATH,
  fontPath = process.env.DRAMAIP_TEST_SUBTITLE_FONT_PATH;
assert(
  ffmpegPath && ffprobePath && fontPath,
  "Explicit existing FFmpeg, FFprobe and local-test font paths are required; no install/download/GUI.",
);
const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const run = (args: string[], maxBuffer = 32 * 1024 * 1024) =>
  execFileSync(ffmpegPath, ["-nostdin", "-v", "error", "-xerror", ...args], {
    timeout: 30_000,
    maxBuffer,
    windowsHide: true,
  });
async function fixture(
  fontBytes?: Buffer,
  sourceHook?: (path: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-host-subtitles-"));
  let supervisor: RenderSupervisor | undefined,
    server: { close(): void } | undefined;
  try {
    const sidecars = join(root, "sidecars"),
      library = join(root, "library");
    await mkdir(sidecars);
    await mkdir(library);
    const keys = generateKeyPairSync("ed25519"),
      publicKeyPem = keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
    for (const [source, name, manifest] of [
      [ffmpegPath, "ffmpeg", "render-manifest.json"],
      [ffprobePath, "ffprobe", "manifest.json"],
    ] as const) {
      assert(source);
      const executable = join(
        sidecars,
        process.platform === "win32" ? `${name}.exe` : name,
      );
      await copyFile(source, executable);
      await chmod(executable, 0o700);
      const unsigned = {
        version: "0.0.0-controlled-local",
        platform: process.platform,
        arch: process.arch,
        url: `https://fixtures.invalid/${name}`,
        sha256: sha(await readFile(executable)),
        license: "LOCAL-TEST-ONLY-NOT-DISTRIBUTION",
        sourceUrl: "https://fixtures.invalid/source",
        buildRecipeUrl: "https://fixtures.invalid/recipe",
      };
      await writeFile(
        join(sidecars, manifest),
        JSON.stringify({
          ...unsigned,
          signature: sign(
            null,
            Buffer.from(JSON.stringify(unsigned)),
            keys.privateKey,
          ).toString("base64"),
        }),
      );
    }
    const ffmpeg = await loadVerifiedFfmpeg({ root: sidecars, publicKeyPem }),
      ffprobe = await loadVerifiedFfprobe({ root: sidecars, publicKeyPem });
    assert(ffmpeg?.audioMixAvailable && ffmpeg.videoProofAvailable && ffprobe);
    assert(fontPath);
    const signed = await signedFontFixture(
      root,
      fontBytes ?? (await readFile(fontPath)),
    );
    const fonts = await loadVerifiedRendererFonts({
      root,
      publicKeyPem: signed.publicKeyPem,
    });
    supervisor = new RenderSupervisor({
      mediaRoot: library,
      ffmpegPath: ffmpeg.executablePath,
      rendererVersion: ffmpeg.version,
      probe: ffprobe.probe,
      probeAudio: ffprobe.probeAudio,
      probeVideo: async (path, output) => {
        const result = await ffprobe.probeVideo(path, output);
        if (!output) await sourceHook?.(path);
        return result;
      },
      audioMixAvailable: ffmpeg.audioMixAvailable,
      videoProofAvailable: ffmpeg.videoProofAvailable,
      rendererFonts: fonts,
    });
    assert.equal(
      supervisor.subtitleBurnInAvailable,
      false,
      "Signed cmap alone is not actual native capability.",
    );
    const videoRef = randomUUID(),
      videoPath = join(library, `${videoRef}.mp4`);
    run([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=96x64:r=25:d=1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ]);
    const video = await readFile(videoPath),
      descriptor = fonts[0]!.descriptor;
    const input: HostTimelineRenderInput = {
      jobId: randomUUID(),
      timelineId: randomUUID(),
      durationFrames: 12,
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      clips: [
        {
          mediaRef: videoRef,
          sha256: sha(video),
          sizeBytes: video.length,
          mimeType: "video/mp4",
          startFrame: 0,
          durationFrames: 12,
          sourceOffsetFrame: 0,
        },
      ],
      audioPlan: {
        format: "dramaip-render-audio",
        version: 1,
        policy: "saved-gains-reject-over-unity",
        videoEmbeddedAudio: "mix-if-present",
        clips: [],
      },
      subtitlePlan: {
        format: "dramaip-render-subtitles",
        version: 1,
        mode: "burn-in",
        font: {
          id: descriptor.id,
          packVersion: descriptor.packVersion,
          sha256: descriptor.sha256,
        },
        cues: [
          {
            clipId: randomUUID(),
            startFrame: 2,
            durationFrames: 5,
            text: "字幕 %{n}",
          },
        ],
      },
    };
    const active = supervisor;
    const createHost = async () => {
      const host = createDesktopHost({
        accessToken: "actual-host-subtitle",
        capabilities: [
          {
            id: "renderer.ffmpeg-subtitles-v1",
            available: active.subtitleBurnInAvailable,
            version: active.rendererVersion,
            fonts: active.subtitleFonts,
          },
        ],
        actions: {
          startTimelineRender: (v: HostTimelineRenderInput) => active.start(v),
          getTimelineRender: (id: string) => active.get(id),
          cancelTimelineRender: (id: string) => active.cancel(id),
        } as unknown as DesktopHostActions,
      });
      const started = await host.start({ hostname: "127.0.0.1", port: 0 });
      server = started;
      return new DesktopHostClient({
        baseUrl: `http://${started.hostname}:${started.port}`,
        accessToken: "actual-host-subtitle",
      });
    };
    const finish = async (
      client: DesktopHostClient,
      value: HostTimelineRenderInput,
    ) => {
      await client.startTimelineRender(value);
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const job = await client.getTimelineRender(value.jobId);
        if (job && !["queued", "running"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error("Actual subtitle render exceeded the test deadline");
    };
    return {
      root,
      library,
      ffmpeg,
      ffprobe,
      fonts,
      signed,
      input,
      supervisor,
      createHost,
      finish,
      cleanup: async () => {
        server?.close();
        await active.dispose();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (cause) {
    server?.close();
    await supervisor?.dispose();
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

/** Actual local media only; the font remains an isolated non-distribution fixture. */
async function combinedInput(f: Awaited<ReturnType<typeof fixture>>) {
  const input = structuredClone(f.input);
  input.durationFrames = 25;
  const first = input.clips[0]!,
    firstPath = join(f.library, `${first.mediaRef}.mp4`);
  run([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=96x64:r=25:d=0.2",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=96x64:r=25:d=0.8",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    firstPath,
  ]);
  const firstBytes = await readFile(firstPath);
  Object.assign(first, {
    sha256: sha(firstBytes),
    sizeBytes: firstBytes.length,
    durationFrames: 8,
    sourceOffsetFrame: 3,
  });
  const secondRef = randomUUID(),
    secondPath = join(f.library, `${secondRef}.mp4`);
  run([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=96x64:r=25:d=1",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    secondPath,
  ]);
  const secondBytes = await readFile(secondPath);
  const clips: HostTimelineRenderInput["clips"] = [
    ...input.clips,
    {
      mediaRef: secondRef,
      sha256: sha(secondBytes),
      sizeBytes: secondBytes.length,
      mimeType: "video/mp4",
      startFrame: 13,
      durationFrames: 12,
      sourceOffsetFrame: 4,
    },
  ];
  const audioRef = randomUUID(),
    audioPath = join(f.library, `${audioRef}.wav`);
  run([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.2:s=48000:d=2",
    "-c:a",
    "pcm_f32le",
    audioPath,
  ]);
  const audioBytes = await readFile(audioPath);
  const audio = (
    kind: "dialogue" | "narration" | "bgm",
    startFrame: number,
    durationFrames: number,
    volume: number,
  ) => ({
    clipId: randomUUID(),
    kind,
    mediaRef: audioRef,
    sha256: sha(audioBytes),
    sizeBytes: audioBytes.length,
    mimeType: "audio/wav",
    startFrame,
    durationFrames,
    sourceOffsetFrame: 5,
    volume,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    duckingGain: 0.5,
  });
  input.audioPlan!.clips = [
    audio("bgm", 0, 25, 0.1),
    audio("dialogue", 2, 4, 0.2),
    audio("narration", 14, 4, 0.3),
  ];
  const subtitles = input.subtitlePlan!;
  assert(subtitles.mode === "burn-in");
  subtitles.cues = [
    {
      clipId: randomUUID(),
      startFrame: 6,
      durationFrames: 4,
      text: "跨镜头 %{n}",
    },
    {
      clipId: randomUUID(),
      startFrame: 16,
      durationFrames: 3,
      text: "第二镜头",
    },
  ];
  return { ...input, clips };
}

test(
  "actual Host combines offset shots, a five-frame gap, shared-source ducked audio and two literal subtitle windows",
  { timeout: 60_000 },
  async () => {
    const f = await fixture();
    try {
      await f.supervisor.verifySubtitleCapability();
      const client = await f.createHost(),
        input = await combinedInput(f),
        frozen = structuredClone(input),
        job = await f.finish(client, input);
      assert.equal(job.status, "succeeded", job.failureCode);
      assert(job.output);
      assert.deepEqual(input, frozen);
      const path = join(f.library, `${job.output.mediaRef}.mp4`),
        bytes = await readFile(path);
      assert.equal(sha(bytes), job.output.sha256);
      assert.equal(bytes.length, job.output.sizeBytes);
      assert.equal((await f.ffprobe.probe(path)).durationFrames, 25);
      const colours = run([
        "-i",
        path,
        "-an",
        "-vf",
        "crop=4:4:0:0",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      assert.equal(colours.length, 25 * 4 * 4 * 3);
      for (let frame = 0; frame < 25; frame++) {
        const rgb = [...colours.subarray(frame * 48, frame * 48 + 3)];
        if (frame < 2)
          assert(
            rgb[2]! > 200 && rgb[0]! < 10 && rgb[1]! < 10,
            `blue offset frame ${frame}: ${rgb}`,
          );
        else if (frame < 8)
          assert(
            rgb[1]! > 100 && rgb[0]! < 10 && rgb[2]! < 10,
            `green offset frame ${frame}: ${rgb}`,
          );
        else if (frame < 13)
          assert(
            rgb.every((v) => v < 10),
            `black gap frame ${frame}: ${rgb}`,
          );
        else
          assert(
            rgb[0]! > 200 && rgb[1]! < 10 && rgb[2]! < 10,
            `second red shot frame ${frame}: ${rgb}`,
          );
      }
      const pixels = run([
        "-i",
        path,
        "-an",
        "-vf",
        "crop=888:480:96:1440",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      const frameBytes = 888 * 480;
      assert.equal(pixels.length, frameBytes * 25);
      for (let frame = 0; frame < 25; frame++) {
        const white = pixels
          .subarray(frame * frameBytes, (frame + 1) * frameBytes)
          .reduce((n, pixel) => n + Number(pixel > 200), 0);
        assert.equal(
          white > 100,
          (frame >= 6 && frame < 10) || (frame >= 16 && frame < 19),
          `subtitle window at frame ${frame}`,
        );
      }
      const audioProbe = await f.ffprobe.probeAudio(path, "video");
      assert(audioProbe.hasAudio);
      assert.equal(audioProbe.codecName, "aac");
      assert.equal(audioProbe.sampleRate, 48_000);
      assert.equal(audioProbe.channels, 2);
      const pcm = run([
        "-i",
        path,
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        "pipe:1",
      ]);
      assert(pcm.length >= 48_000 * 8);
      const mean = (from: number, to: number, channel: number) => {
        let sum = 0;
        const start = from * 1920,
          end = to * 1920;
        for (let sample = start; sample < end; sample++) {
          const value = pcm.readFloatLE(sample * 8 + channel * 4);
          assert(Number.isFinite(value));
          sum += value;
        }
        return sum / (end - start);
      };
      for (const channel of [0, 1])
        for (const [from, to, expected] of [
          [3, 5, 0.05],
          [9, 12, 0.02],
          [15, 17, 0.07],
          [21, 24, 0.02],
        ])
          assert(
            Math.abs(mean(from!, to!, channel) - expected!) < 0.01,
            `AAC mean ${from}-${to}, channel ${channel}`,
          );
      const replay = await client.startTimelineRender(input);
      assert.equal(replay.output?.sha256, job.output.sha256);
      const changed = structuredClone(input);
      assert(changed.subtitlePlan?.mode === "burn-in");
      changed.subtitlePlan.cues[0]!.text = "不能复用旧键";
      await assert.rejects(client.startTimelineRender(changed));
      assert.equal(
        (await client.getTimelineRender(input.jobId))?.output?.sha256,
        job.output.sha256,
      );
      await f.supervisor.dispose();
      assert(
        !(await readdir(f.library)).some((name) =>
          name.startsWith("render-job-"),
        ),
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "canceling a combined job while its original source proof is pending cannot publish after that proof returns",
  { timeout: 45_000 },
  async () => {
    let signalObserved!: () => void, releaseProof!: () => void;
    const observed = new Promise<void>((resolve) => {
      signalObserved = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      releaseProof = resolve;
    });
    const f = await fixture(undefined, async () => {
      signalObserved();
      await pending;
    });
    try {
      await f.supervisor.verifySubtitleCapability();
      const client = await f.createHost(),
        input = await combinedInput(f),
        before = (await readdir(f.library))
          .filter((name) => name.endsWith(".mp4"))
          .sort();
      await client.startTimelineRender(input);
      await Promise.race([
        observed,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(Error("Original source proof was not observed")),
            5000,
          ).unref();
        }),
      ]);
      assert.equal(
        (await client.cancelTimelineRender(input.jobId))?.status,
        "canceled",
      );
      releaseProof();
      await f.supervisor.dispose();
      const job = await client.getTimelineRender(input.jobId);
      assert.equal(job?.status, "canceled");
      assert.equal(job?.output, undefined);
      const members = await readdir(f.library);
      assert.deepEqual(
        members.filter((name) => name.endsWith(".mp4")).sort(),
        before,
      );
      assert(!members.some((name) => name.startsWith("render-job-")));
    } finally {
      releaseProof();
      await f.cleanup();
    }
  },
);

test(
  "actual signed Host capability and frozen font/text yield a fully decoded H264/AAC MP4 with exact subtitle frame range",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      await f.supervisor.verifySubtitleCapability();
      assert(f.supervisor.subtitleBurnInAvailable);
      const client = await f.createHost(),
        health = await client.health();
      assert.equal(
        health.capabilities[0]!.fonts?.[0]?.sha256,
        f.fonts[0]!.descriptor.sha256,
      );
      assert(!JSON.stringify(health).includes(f.root));
      // Changing the original pack after verified startup cannot replace its retained immutable snapshot.
      await writeFile(
        f.signed.path,
        Buffer.alloc(f.fonts[0]!.descriptor.sizeBytes),
      );
      const job = await f.finish(client, f.input);
      assert.equal(job.status, "succeeded", job.failureCode);
      assert(job.output);
      const path = join(f.library, `${job.output.mediaRef}.mp4`);
      assert.equal(sha(await readFile(path)), job.output.sha256);
      const pixels = run([
        "-f",
        "mov",
        "-enable_drefs",
        "0",
        "-use_absolute_path",
        "0",
        "-protocol_whitelist",
        "file",
        "-i",
        path,
        "-an",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      assert.equal(pixels.length, 1080 * 1920 * 12);
      for (let n = 0; n < 12; n++) {
        const frame = pixels.subarray(n * 1080 * 1920, (n + 1) * 1080 * 1920);
        assert.equal(
          frame.some((value) => value > 100),
          n >= 2 && n < 7,
        );
      }
      assert.equal((await f.ffprobe.probeAudio(path, "video")).hasAudio, true);
      assert(
        !(await readdir(f.library)).some((name) =>
          name.startsWith("render-job-"),
        ),
      );
      await assert.rejects(
        client.startTimelineRender({
          ...f.input,
          subtitlePlan: {
            format: "dramaip-render-subtitles",
            version: 1,
            mode: "omit",
          },
        }),
      );
      assert.equal(
        f.supervisor.get(f.input.jobId)!.output!.sha256,
        job.output.sha256,
      );
    } finally {
      await f.cleanup();
    }
  },
);
test(
  "explicit omit publishes no subtitle; old absence remains independent and cannot reuse a burn-in job key",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      await f.supervisor.verifySubtitleCapability();
      const client = await f.createHost(),
        omitted = {
          ...f.input,
          subtitlePlan: {
            format: "dramaip-render-subtitles" as const,
            version: 1 as const,
            mode: "omit" as const,
          },
        };
      const job = await f.finish(client, omitted);
      assert.equal(job.status, "succeeded", job.failureCode);
      assert(job.output);
      const pixels = run([
        "-f",
        "mov",
        "-i",
        join(f.library, `${job.output.mediaRef}.mp4`),
        "-an",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      assert(!pixels.some((value) => value > 10));
      await assert.rejects(client.startTimelineRender(f.input));
      const { subtitlePlan: _subtitle, ...legacy } = omitted;
      const old = await f.finish(client, { ...legacy, jobId: randomUUID() });
      assert.equal(old.status, "succeeded", old.failureCode);
      // Host terminal output and asynchronous private-workdir cleanup are distinct.
      // Dispose is the public supervision barrier; do not race get(status) against finally.
      await f.supervisor.dispose();
      assert(
        !(await readdir(f.library)).some((name) =>
          name.startsWith("render-job-"),
        ),
      );
    } finally {
      await f.cleanup();
    }
  },
);
test(
  "unknown frozen font is synchronously refused; actual missing glyph and over-wide subtitle fail without output or job members",
  { timeout: 45000 },
  async () => {
    for (const text of ["字幕\u{10ffff}", "A".repeat(100)]) {
      const f = await fixture();
      try {
        await f.supervisor.verifySubtitleCapability();
        const client = await f.createHost(),
          plan = f.input.subtitlePlan!;
        assert(plan.mode === "burn-in");
        await assert.rejects(
          client.startTimelineRender({
            ...f.input,
            subtitlePlan: {
              ...plan,
              font: { ...plan.font, sha256: "0".repeat(64) },
            },
          }),
        );
        assert.equal(f.supervisor.get(f.input.jobId), undefined);
        const input = {
          ...f.input,
          jobId: randomUUID(),
          subtitlePlan: { ...plan, cues: [{ ...plan.cues[0]!, text }] },
        };
        const job = await f.finish(client, input);
        assert.equal(job.status, "failed");
        assert.equal(job.failureCode, "SUBTITLE_PREPARATION_INVALID");
        assert.equal(job.output, undefined);
        await f.supervisor.dispose();
        assert.deepEqual(
          (await readdir(f.library)).filter((name) => name.endsWith(".mp4")),
          [`${f.input.clips[0]!.mediaRef}.mp4`],
        );
        assert(
          !(await readdir(f.library)).some((name) =>
            name.startsWith("render-job-"),
          ),
        );
      } finally {
        await f.cleanup();
      }
    }
  },
);
test(
  "a signature-valid cmap without native outlines cannot advertise subtitle capability",
  { timeout: 45000 },
  async () => {
    const f = await fixture(fontFixture());
    try {
      await assert.rejects(f.supervisor.verifySubtitleCapability());
      assert.equal(f.supervisor.subtitleBurnInAvailable, false);
      assert.deepEqual(f.supervisor.subtitleFonts, []);
      assert(f.supervisor.audioMixAvailable);
      const client = await f.createHost();
      await assert.rejects(client.startTimelineRender(f.input));
      assert.equal(f.supervisor.get(f.input.jobId), undefined);
    } finally {
      await f.cleanup();
    }
  },
);
test(
  "Host cancellation is terminal and disposal removes exclusive subtitle preparation without a late published output",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      await f.supervisor.verifySubtitleCapability();
      const client = await f.createHost();
      await client.startTimelineRender(f.input);
      const canceled = await client.cancelTimelineRender(f.input.jobId);
      assert.equal(canceled?.status, "canceled");
      await f.supervisor.dispose();
      const job = await client.getTimelineRender(f.input.jobId);
      assert.equal(job?.status, "canceled");
      assert.equal(job?.output, undefined);
      assert(
        !(await readdir(f.library)).some((name) =>
          name.startsWith("render-job-"),
        ),
      );
      assert.deepEqual(
        (await readdir(f.library)).filter((name) => name.endsWith(".mp4")),
        [`${f.input.clips[0]!.mediaRef}.mp4`],
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "late equal-size font, text or fontconfig mutation cannot publish or adopt a system font",
  { timeout: 45000 },
  async () => {
    for (const member of [
      "subtitle-font.ttf",
      "subtitle-0000.txt",
      "subtitle-fontconfig.xml",
    ]) {
      let mutated = false;
      const f = await fixture(undefined, async (path) => {
        if (mutated) return;
        const target = join(dirname(path), member),
          bytes = await readFile(target);
        bytes[bytes.length - 1] ^= 1;
        await chmod(target, 0o600);
        await writeFile(target, bytes);
        mutated = true;
      });
      try {
        await f.supervisor.verifySubtitleCapability();
        const client = await f.createHost(),
          job = await f.finish(client, f.input);
        assert(mutated);
        assert.equal(job.status, "failed");
        assert.equal(job.failureCode, "SUBTITLE_PREPARATION_INVALID");
        assert.equal(job.output, undefined);
        await f.supervisor.dispose();
        assert.deepEqual(
          (await readdir(f.library)).filter((name) => name.endsWith(".mp4")),
          [`${f.input.clips[0]!.mediaRef}.mp4`],
        );
        assert(
          !(await readdir(f.library)).some((name) =>
            name.startsWith("render-job-"),
          ),
        );
      } finally {
        await f.cleanup();
      }
    }
  },
);
test(
  "disposal during an actual native font capability process reaps its original PID and cannot advertise later",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const pending = f.supervisor.verifySubtitleCapability(),
        rejected = assert.rejects(pending);
      const supervised = f.supervisor as unknown as {
        fontChild?: import("node:child_process").ChildProcess;
      };
      const deadline = Date.now() + 5000;
      while (!supervised.fontChild?.pid && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 1));
      const pid = supervised.fontChild?.pid;
      assert(
        pid,
        "Original live native capability PID must be observed before disposal.",
      );
      await f.supervisor.dispose();
      await rejected;
      assert.throws(
        () => process.kill(pid, 0),
        (cause: unknown) =>
          Boolean(
            cause &&
            typeof cause === "object" &&
            "code" in cause &&
            cause.code === "ESRCH",
          ),
      );
      assert.equal(f.supervisor.subtitleBurnInAvailable, false);
      assert.deepEqual(f.supervisor.subtitleFonts, []);
    } finally {
      await f.cleanup();
    }
  },
);
