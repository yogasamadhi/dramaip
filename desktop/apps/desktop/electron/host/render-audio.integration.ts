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
import { join } from "node:path";
import { createServer } from "node:http";
import type {
  HostTimelineRenderAudioClip,
  HostTimelineRenderInput,
} from "@dramaip/desktop-host";
import { loadVerifiedFfmpeg, loadVerifiedFfprobe } from "./ffprobe-sidecar";
import { RenderSupervisor } from "./render-supervisor";
import {
  renderTimelineAudioPcm,
  verifyRenderAudioSource,
} from "./render-audio-execution";
import { TimelineManifestSchema } from "@dramaip/contracts/timeline";
import { verifyRenderVideoFrames } from "./render-video-execution";
import { timelinePreviewFrame } from "../../../../packages/app/src/timeline-preview";

// Explicit opt-in existing local binaries; no download, install, provider request, playback or GUI.
const ffmpegPath = process.env.DRAMAIP_TEST_FFMPEG_PATH;
const ffprobePath = process.env.DRAMAIP_TEST_FFPROBE_PATH;
assert(
  ffmpegPath && ffprobePath,
  "Set both DRAMAIP_TEST_FFMPEG_PATH and DRAMAIP_TEST_FFPROBE_PATH to existing local executables.",
);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const run = (args: string[]) =>
  execFileSync(ffmpegPath, ["-nostdin", "-v", "error", "-y", ...args], {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dramaip-formal-audio-"));
  try {
    const sidecars = join(root, "sidecars"),
      library = join(root, "library");
    await mkdir(sidecars);
    await mkdir(library);
    const keys = generateKeyPairSync("ed25519");
    const publicKeyPem = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    for (const [source, name, manifest] of [
      [ffmpegPath, "ffmpeg", "render-manifest.json"],
      [ffprobePath, "ffprobe", "manifest.json"],
    ] as const) {
      assert(
        source,
        "The opt-in executable must be present before copying the signed local fixture",
      );
      const file = join(
        sidecars,
        process.platform === "win32" ? `${name}.exe` : name,
      );
      await copyFile(source, file);
      await chmod(file, 0o700);
      const unsigned = {
        version: "0.0.0-controlled-local",
        platform: process.platform,
        arch: process.arch,
        url: `https://fixtures.invalid/${name}`,
        sha256: sha(await readFile(file)),
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
    const ffmpeg = await loadVerifiedFfmpeg({ root: sidecars, publicKeyPem });
    const ffprobe = await loadVerifiedFfprobe({ root: sidecars, publicKeyPem });
    assert(
      ffmpeg?.audioMixAvailable && ffmpeg.videoProofAvailable && ffprobe,
      "Actual signed fixture must exercise the mixer, AAC and x264 capability.",
    );
    const videoRef = randomUUID(),
      audioRef = randomUUID();
    const videoPath = join(library, `${videoRef}.mp4`),
      audioPath = join(library, `${audioRef}.wav`);
    run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=25:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=500:sample_rate=48000:duration=2",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ]);
    run([
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.15:s=16000:d=2",
      "-c:a",
      "pcm_f32le",
      audioPath,
    ]);
    const videoBytes = await readFile(videoPath),
      audioBytes = await readFile(audioPath);
    const video = {
      mediaRef: videoRef,
      sha256: sha(videoBytes),
      sizeBytes: videoBytes.length,
      mimeType: "video/mp4" as const,
      startFrame: 0,
      durationFrames: 25,
      sourceOffsetFrame: 0,
    };
    const audio = {
      mediaRef: audioRef,
      sha256: sha(audioBytes),
      sizeBytes: audioBytes.length,
      mimeType: "audio/wav",
    };
    const clip = (
      kind: HostTimelineRenderAudioClip["kind"],
      patch: Partial<HostTimelineRenderAudioClip> = {},
    ): HostTimelineRenderAudioClip => ({
      ...audio,
      clipId: randomUUID(),
      kind,
      startFrame: 0,
      durationFrames: 25,
      sourceOffsetFrame: 0,
      volume: 0.3,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      duckingGain: 0.55,
      ...patch,
    });
    const render: HostTimelineRenderInput = {
      jobId: randomUUID(),
      timelineId: randomUUID(),
      durationFrames: 25,
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      clips: [video],
      audioPlan: {
        format: "dramaip-render-audio",
        version: 1,
        policy: "saved-gains-reject-over-unity",
        videoEmbeddedAudio: "mix-if-present",
        clips: [
          clip("video", { ...video, volume: 0.2 }),
          clip("dialogue", { startFrame: 5, durationFrames: 10, volume: 0 }),
          clip("narration", { startFrame: 10, durationFrames: 10 }),
          clip("bgm", { volume: 0.6, fadeInFrames: 30, fadeOutFrames: 35 }),
          clip("sfx", { startFrame: 20, durationFrames: 5 }),
        ],
      },
    };
    const supervisor = new RenderSupervisor({
      mediaRoot: library,
      ffmpegPath: ffmpeg.executablePath,
      rendererVersion: ffmpeg.version,
      probe: ffprobe.probe,
      probeAudio: ffprobe.probeAudio,
      audioMixAvailable: ffmpeg.audioMixAvailable,
      probeVideo: ffprobe.probeVideo,
      videoProofAvailable: ffmpeg.videoProofAvailable,
    });
    const finish = async (input: HostTimelineRenderInput) => {
      supervisor.start(input);
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const job = supervisor.get(input.jobId)!;
        if (!["queued", "running"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error(
        "Actual render did not finish within the bounded fixture deadline",
      );
    };
    const cleanup = async () => {
      await supervisor.dispose();
      await rm(root, { recursive: true, force: true });
    };
    return {
      root,
      library,
      ffmpeg,
      ffprobe,
      videoPath,
      audioPath,
      video,
      audio,
      clip,
      render,
      supervisor,
      finish,
      cleanup,
    };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

test(
  "project-signed actual capability, mono source decode and shared-source sample mix match the actual preview function",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const audioProbe = await f.ffprobe.probeAudio(f.audioPath, "audio");
      assert(audioProbe.hasAudio);
      const source = await verifyRenderAudioSource({
        executable: f.ffmpeg.executablePath,
        path: f.audioPath,
        probe: audioProbe,
        requiredSamples: 48000,
        signal: new AbortController().signal,
        observer: () => {},
      });
      assert.equal(source.samplesPerChannel, 96000);
      const render = structuredClone(f.render);
      render.audioPlan!.clips = f.render.audioPlan!.clips.filter(
        (clip) => clip.kind !== "video",
      );
      const directory = await mkdtemp(join(f.root, "mix-")),
        pcmPath = join(directory, "mix.f32le");
      const mix = await renderTimelineAudioPcm({
        executable: f.ffmpeg.executablePath,
        render,
        paths: new Map([[f.audio.mediaRef, f.audioPath]]),
        probes: new Map([[f.audio.mediaRef, audioProbe]]),
        pcmPath,
        filterPath: join(directory, "filter.txt"),
        signal: new AbortController().signal,
        observer: () => {},
      });
      const pcm = await readFile(pcmPath);
      assert.equal(sha(pcm), mix.sha256);
      assert.equal(pcm.length, 48000 * 8);
      const timeline = TimelineManifestSchema.parse({
        format: "dramaip-timeline",
        schemaVersion: 2,
        id: render.timelineId,
        projectId: randomUUID(),
        adaptationId: randomUUID(),
        episodeId: randomUUID(),
        sourceFingerprint: "actual-controlled-audio-only",
        profile: render.profile,
        timebase: "frames",
        durationFrames: 25,
        migrationWarnings: [],
        version: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tracks: render.audioPlan!.clips.map((clip) => {
          const trackId = randomUUID();
          return {
            id: trackId,
            kind: clip.kind,
            label: clip.kind,
            muted: false,
            solo: false,
            clips: [
              {
                id: clip.clipId,
                trackId,
                name: clip.kind,
                startFrame: clip.startFrame,
                durationFrames: clip.durationFrames,
                sourceOffsetFrame: clip.sourceOffsetFrame,
                volume: clip.volume,
                fadeInFrames: clip.fadeInFrames,
                fadeOutFrames: clip.fadeOutFrames,
                duckingGain: clip.duckingGain,
                mediaStatus: "linked",
                manuallyEdited: false,
              },
            ],
          };
        }),
      });
      for (let sample = 0; sample < 48000; sample++) {
        const frame = timelinePreviewFrame(timeline, sample / 48000);
        const expected = frame.sources.reduce(
          (sum, entry) => sum + Math.fround(0.15) * entry.gain,
          0,
        );
        for (let channel = 0; channel < 2; channel++)
          assert(
            Math.abs(pcm.readFloatLE(sample * 8 + channel * 4) - expected) <
              1e-6,
          );
      }
      await assert.rejects(
        verifyRenderAudioSource({
          executable: f.ffmpeg.executablePath,
          path: f.audioPath,
          probe: audioProbe,
          requiredSamples: 96001,
          signal: new AbortController().signal,
          observer: () => {},
        }),
        /does not cover/u,
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "the actual supervisor stages video+AUDIO, preserves controls and publishes only fully decoded AAC plus exact video",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const before = structuredClone(f.render);
      const job = await f.finish(f.render);
      assert.equal(job.status, "succeeded", JSON.stringify(job));
      assert(job.output);
      assert.deepEqual(f.render, before);
      const output = join(f.library, `${job.output.mediaRef}.mp4`);
      assert.equal(sha(await readFile(output)), job.output.sha256);
      const probe = await f.ffprobe.probeAudio(output, "video");
      assert(probe.hasAudio);
      assert.equal(probe.codecName, "aac");
      assert.equal(probe.channels, 2);
      assert.equal(probe.sampleRate, 48000);
      const pcm = run([
        "-i",
        output,
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        "pipe:1",
      ]);
      assert(pcm.length >= 48000 * 8);
      let peak = 0;
      for (let at = 0; at < pcm.length; at += 4) {
        const value = pcm.readFloatLE(at);
        assert(Number.isFinite(value));
        peak = Math.max(peak, Math.abs(value));
      }
      assert(
        peak > 0.01,
        "A real mixed job cannot pass by substituting silence.",
      );
      assert.equal((await f.ffprobe.probe(output)).durationFrames, 25);
      await f.supervisor.dispose();
      assert(
        (await readdir(f.library)).every(
          (name) => !name.startsWith("render-job-"),
        ),
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "known empty new-policy input is exact silence while legacy absence stays a separately hashed job policy",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const empty = structuredClone(f.render);
      empty.audioPlan!.clips = [];
      const mixed = await f.finish(empty);
      assert.equal(mixed.status, "succeeded", JSON.stringify(mixed));
      const legacy = structuredClone(empty);
      delete legacy.audioPlan;
      assert.throws(
        () => f.supervisor.start(legacy),
        /different frozen input/u,
      );
      legacy.jobId = randomUUID();
      assert.equal((await f.finish(legacy)).status, "succeeded");
      const pcm = run([
        "-i",
        join(f.library, `${mixed.output!.mediaRef}.mp4`),
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        "pipe:1",
      ]);
      assert(pcm.length >= 48000 * 8);
      for (let at = 0; at < pcm.length; at += 4)
        assert.equal(pcm.readFloatLE(at), 0);
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "over-unity, unavailable source range and equal-length archive corruption fail without a published output",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const peak = structuredClone(f.render);
      peak.audioPlan!.clips = [f.clip("bgm", { volume: 20 })];
      const short = structuredClone(f.render);
      short.jobId = randomUUID();
      short.audioPlan!.clips = [f.clip("dialogue", { sourceOffsetFrame: 50 })];
      for (const input of [peak, short]) {
        const job = await f.finish(input);
        assert.equal(job.status, "failed");
        assert.equal(job.output, undefined);
        if (input === peak)
          assert.equal(job.failureCode, "AUDIO_MIX_PEAK_EXCEEDED");
      }
      const broken = structuredClone(f.render);
      broken.jobId = randomUUID();
      await writeFile(f.audioPath, Buffer.alloc(f.audio.sizeBytes, 7));
      const job = await f.finish(broken);
      assert.equal(job.status, "failed");
      assert.equal(job.output, undefined);
      await f.supervisor.dispose();
      assert.deepEqual(
        (await readdir(f.library)).sort(),
        [`${f.video.mediaRef}.mp4`, `${f.audio.mediaRef}.wav`].sort(),
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "actual source cancellation reaps its decoder and a playlist disguised as WAV cannot open nested HTTP",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(404).end();
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert(address && typeof address !== "string");
      const audioProbe = await f.ffprobe.probeAudio(f.audioPath, "audio");
      assert(audioProbe.hasAudio);
      const abort = new AbortController();
      let pid: number | undefined;
      await assert.rejects(
        verifyRenderAudioSource({
          executable: f.ffmpeg.executablePath,
          path: f.audioPath,
          probe: audioProbe,
          requiredSamples: 48000,
          signal: abort.signal,
          observer: (child) => {
            if (child) {
              pid = child.pid;
              abort.abort();
            }
          },
        }),
      );
      const reapedPid = pid;
      assert(reapedPid);
      assert.throws(() => process.kill(reapedPid, 0));
      const playlist = Buffer.from(
        `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttp://127.0.0.1:${address.port}/external.wav\n#EXT-X-ENDLIST\n`,
      );
      await writeFile(f.audioPath, playlist);
      const render = structuredClone(f.render);
      render.audioPlan!.clips = [
        f.clip("dialogue", {
          sha256: sha(playlist),
          sizeBytes: playlist.length,
        }),
      ];
      const job = await f.finish(render);
      assert.equal(job.status, "failed");
      assert.equal(job.output, undefined);
      assert.equal(requests, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.cleanup();
    }
  },
);

test(
  "valid MP4 inventory and declared duration cannot hide corrupt video packets from the full-source publication gate",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.from(await readFile(f.videoPath));
      let corruptBytes = 0;
      const packets = JSON.parse(
        execFileSync(
          ffprobePath!,
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_packets",
            "-show_entries",
            "packet=pos,size,pts_time",
            "-of",
            "json",
            f.videoPath,
          ],
          { windowsHide: true },
        ).toString(),
      ).packets as Array<{ pos: string; size: string; pts_time: string }>;
      for (const packet of packets) {
        if (Number(packet.pts_time) < 1.2) continue;
        const at = Number(packet.pos),
          size = Number(packet.size);
        assert(
          Number.isSafeInteger(at) &&
            Number.isSafeInteger(size) &&
            at >= 0 &&
            size > 0 &&
            at + size <= bytes.length,
        );
        bytes.fill(0, at, at + size);
        corruptBytes += size;
      }
      assert(corruptBytes > 0);
      await writeFile(f.videoPath, bytes);
      // moov/avcC and all declared clocks still exist; this is not just a checksum/metadata mismatch test.
      const nominal = await f.ffprobe.probeVideo(f.videoPath);
      assert.equal(
        (nominal.durationTicks * nominal.timeBase.n * 25n) / nominal.timeBase.d,
        50n,
      );
      await assert.rejects(
        verifyRenderVideoFrames({
          executable: f.ffmpeg.executablePath,
          path: f.videoPath,
          probe: nominal,
          requiredRanges: [{ sourceOffsetFrame: 0, durationFrames: 25 }],
          signal: new AbortController().signal,
          observer: () => {},
        }),
        /Video decoder failed|complete declared/u,
      );
      const render = structuredClone(f.render);
      render.clips[0]!.sha256 = sha(bytes);
      render.audioPlan!.clips = []; // No audio decode can accidentally be credited for rejecting the visual corruption.
      const job = await f.finish(render);
      assert.equal(job.status, "failed", JSON.stringify(job));
      assert.equal(job.failureCode, "VIDEO_FRAME_PROOF_INVALID");
      assert.equal(job.output, undefined);
      await f.supervisor.dispose();
      assert(
        (await readdir(f.library)).every(
          (name) => !name.startsWith("render-job-"),
        ),
      );
      assert.deepEqual(await readFile(f.videoPath), bytes);
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "real irregular frame clocks fail exact output validation despite a 25-frame one-second nominal stream",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const path = join(f.root, "irregular.mp4");
      run([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=96x64:r=25:d=1",
        "-an",
        "-c:v",
        "libx264",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-video_track_timescale",
        "12800",
        path,
      ]);
      // Rewrite this generated file's stts only: total duration/count stay 1 second/25,
      // while two adjacent raw frame durations become 768 and 256 ticks instead of 512.
      // moov is after mdat, so enlarging its child boxes does not change media chunk offsets.
      const original = await readFile(path);
      let rewrites = 0,
        mediaSeen = false;
      const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
      function rewriteBoxes(bytes: Buffer, top = false): Buffer {
        const boxes: Buffer[] = [];
        for (let at = 0; at + 8 <= bytes.length;) {
          const size = bytes.readUInt32BE(at),
            type = bytes.toString("ascii", at + 4, at + 8);
          assert(size >= 8 && at + size <= bytes.length);
          let body = bytes.subarray(at + 8, at + size);
          if (top && type === "mdat") mediaSeen = true;
          if (top && type === "moov") assert(mediaSeen);
          if (containers.has(type)) body = rewriteBoxes(body);
          else if (type === "stts") {
            assert.equal(body.readUInt32BE(4), 1);
            assert.equal(body.readUInt32BE(8), 25);
            assert.equal(body.readUInt32BE(12), 512);
            const changed = Buffer.alloc(40);
            body.copy(changed, 0, 0, 4);
            changed.writeUInt32BE(4, 4);
            for (const [i, [count, ticks]] of [
              [10, 512],
              [1, 768],
              [1, 256],
              [13, 512],
            ].entries()) {
              changed.writeUInt32BE(count!, 8 + i * 8);
              changed.writeUInt32BE(ticks!, 12 + i * 8);
            }
            body = changed;
            rewrites++;
          }
          const head = Buffer.from(bytes.subarray(at, at + 8));
          head.writeUInt32BE(body.length + 8);
          boxes.push(head, body);
          at += size;
        }
        return Buffer.concat(boxes);
      }
      const irregular = rewriteBoxes(original, true);
      assert.equal(rewrites, 1);
      await writeFile(path, irregular);
      const nominal = await f.ffprobe.probeVideo(path);
      const metadata = JSON.parse(
        execFileSync(
          ffprobePath!,
          ["-v", "error", "-show_streams", "-of", "json", path],
          { windowsHide: true },
        ).toString(),
      );
      assert.equal(metadata.streams[0].nb_frames, "25");
      assert.equal(metadata.streams[0].avg_frame_rate, "25/1");
      assert.equal(
        (nominal.durationTicks * nominal.timeBase.n * 25n) / nominal.timeBase.d,
        25n,
      );
      await assert.rejects(
        verifyRenderVideoFrames({
          executable: f.ffmpeg.executablePath,
          path,
          probe: nominal,
          outputFrames: 25,
          signal: new AbortController().signal,
          observer: () => {},
        }),
        /exact zero-origin|gap, overlap/u,
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "actual full-video decoder cancellation reaps its original child before returning",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      const abort = new AbortController();
      let childPid: number | undefined;
      await assert.rejects(
        verifyRenderVideoFrames({
          executable: f.ffmpeg.executablePath,
          path: f.videoPath,
          probe: await f.ffprobe.probeVideo(f.videoPath),
          requiredRanges: [{ sourceOffsetFrame: 0, durationFrames: 25 }],
          signal: abort.signal,
          observer: (child) => {
            if (child) {
              childPid = child.pid;
              abort.abort();
            }
          },
        }),
        /abort/u,
      );
      const reapedPid = childPid;
      assert(reapedPid);
      assert.throws(() => process.kill(reapedPid, 0), /ESRCH/u);
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "post-encode packet corruption cannot be published even when the preceding actual output probe matched",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    let outputProbeCalls = 0;
    const supervisor = new RenderSupervisor({
      mediaRoot: f.library,
      ffmpegPath: f.ffmpeg.executablePath,
      rendererVersion: f.ffmpeg.version,
      probe: f.ffprobe.probe,
      probeAudio: f.ffprobe.probeAudio,
      audioMixAvailable: f.ffmpeg.audioMixAvailable,
      videoProofAvailable: f.ffmpeg.videoProofAvailable,
      probeVideo: async (path, output) => {
        const proof = await f.ffprobe.probeVideo(path, output);
        if (output) {
          outputProbeCalls++;
          const bytes = await readFile(path);
          const packets = JSON.parse(
            execFileSync(
              ffprobePath!,
              [
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_packets",
                "-show_entries",
                "packet=pos,size,pts_time",
                "-of",
                "json",
                path,
              ],
              { windowsHide: true },
            ).toString(),
          ).packets as Array<{ pos: string; size: string; pts_time: string }>;
          let changed = 0;
          for (const packet of packets) {
            if (Number(packet.pts_time) < 0.6) continue;
            const at = Number(packet.pos),
              size = Number(packet.size);
            assert(
              Number.isSafeInteger(at) &&
                Number.isSafeInteger(size) &&
                at >= 0 &&
                size > 0 &&
                at + size <= bytes.length,
            );
            bytes.fill(0, at, at + size);
            changed += size;
          }
          assert(changed > 0);
          await writeFile(path, bytes);
        }
        return proof;
      },
    });
    try {
      supervisor.start(f.render);
      const deadline = Date.now() + 30000;
      while (
        ["queued", "running"].includes(
          supervisor.get(f.render.jobId)!.status,
        ) &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(outputProbeCalls, 1);
      assert.equal(supervisor.get(f.render.jobId)?.status, "failed");
      assert.equal(
        supervisor.get(f.render.jobId)?.failureCode,
        "VIDEO_FRAME_PROOF_INVALID",
      );
      assert.equal(supervisor.get(f.render.jobId)?.output, undefined);
      await supervisor.dispose();
      assert.deepEqual(
        (await readdir(f.library)).sort(),
        [`${f.video.mediaRef}.mp4`, `${f.audio.mediaRef}.wav`].sort(),
      );
    } finally {
      await supervisor.dispose();
      await f.cleanup();
    }
  },
);
