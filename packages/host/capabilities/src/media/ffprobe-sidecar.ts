import { createHash, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaProbeResult } from "./media-archive";
import {
  interpretRenderAudioProbe,
  type RenderAudioProbe,
} from "./audio-probe";
import { buildTimelineAudioMix } from "./render-audio";
import { renderMediaInputOptions } from "./render-media-input";
import {
  interpretRenderVideoProbe,
  VideoFrameProofError,
  type RenderVideoProbe,
} from "./video-proof";
import { verifyRenderVideoFrames } from "./render-video-execution";

const executeFile = promisify(execFile);

export interface RendererSidecarManifest {
  version: string;
  platform: string;
  arch: string;
  url: string;
  sha256: string;
  signature: string;
  license: string;
  sourceUrl: string;
  buildRecipeUrl: string;
}

function canonicalManifest(manifest: RendererSidecarManifest): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: manifest.version,
      platform: manifest.platform,
      arch: manifest.arch,
      url: manifest.url,
      sha256: manifest.sha256,
      license: manifest.license,
      sourceUrl: manifest.sourceUrl,
      buildRecipeUrl: manifest.buildRecipeUrl,
    }),
    "utf8",
  );
}

export function verifyRendererSidecarManifest(
  value: unknown,
  publicKeyPem: string,
): RendererSidecarManifest {
  if (!value || typeof value !== "object")
    throw new Error("Renderer sidecar manifest is invalid");
  const manifest = value as Record<string, unknown>;
  const required = [
    "version",
    "platform",
    "arch",
    "url",
    "sha256",
    "signature",
    "license",
    "sourceUrl",
    "buildRecipeUrl",
  ] as const;
  if (required.some((field) => typeof manifest[field] !== "string"))
    throw new Error("Renderer sidecar manifest is incomplete");
  const typed = manifest as unknown as RendererSidecarManifest;
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(typed.version))
    throw new Error("Renderer sidecar version is invalid");
  if (typed.platform !== process.platform || typed.arch !== process.arch)
    throw new Error("Renderer sidecar platform does not match this host");
  if (!/^[a-f0-9]{64}$/u.test(typed.sha256))
    throw new Error("Renderer sidecar checksum is invalid");
  for (const url of [typed.url, typed.sourceUrl, typed.buildRecipeUrl]) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("Renderer sidecar manifest URL is invalid");
  }
  if (!typed.license.trim())
    throw new Error("Renderer sidecar license is missing");
  if (
    !verify(
      null,
      canonicalManifest(typed),
      publicKeyPem,
      Buffer.from(typed.signature, "base64"),
    )
  )
    throw new Error("Renderer sidecar manifest signature is invalid");
  return typed;
}

function ratio(value: string): { numerator: number; denominator: number } {
  const [numerator, denominator] = value.split("/").map(Number);
  if (
    !Number.isInteger(numerator) ||
    numerator! < 1 ||
    !Number.isInteger(denominator) ||
    denominator! < 1
  )
    throw new Error("ffprobe returned an invalid frame rate");
  return { numerator: numerator!, denominator: denominator! };
}

export async function loadVerifiedFfprobe(input: {
  root: string;
  publicKeyPem?: string;
}): Promise<
  | {
      version: string;
      probe(path: string): Promise<MediaProbeResult>;
      probeAudio(
        path: string,
        kind: "audio" | "video",
      ): Promise<RenderAudioProbe>;
      probeVideo(
        path: string,
        output?: { width: number; height: number; durationFrames: number },
      ): Promise<RenderVideoProbe>;
    }
  | undefined
> {
  if (!input.publicKeyPem?.trim()) return undefined;
  const manifestPath = join(input.root, "manifest.json");
  const executablePath = join(
    input.root,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
  if (!existsSync(manifestPath) || !existsSync(executablePath))
    return undefined;
  const manifest = verifyRendererSidecarManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    input.publicKeyPem,
  );
  const executableSha256 = createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex");
  if (executableSha256 !== manifest.sha256)
    throw new Error("Renderer sidecar artifact checksum mismatch");
  return {
    version: manifest.version,
    async probeVideo(path, output) {
      const { stdout } = await executeFile(
        executablePath,
        [
          "-v",
          "error",
          ...renderMediaInputOptions(path),
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
      try {
        return interpretRenderVideoProbe(JSON.parse(stdout), output);
      } catch (cause) {
        throw new VideoFrameProofError(
          "Actual video stream inventory or presentation clock is invalid",
          { cause },
        );
      }
    },
    async probeAudio(path, kind) {
      const { stdout } = await executeFile(
        executablePath,
        [
          "-v",
          "error",
          ...renderMediaInputOptions(path),
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
      return interpretRenderAudioProbe(JSON.parse(stdout), kind);
    },
    async probe(path) {
      const { stdout } = await executeFile(
        executablePath,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file",
          "-f",
          "mov",
          "-enable_drefs",
          "0",
          "-use_absolute_path",
          "0",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
      const output = JSON.parse(stdout) as {
        streams?: Array<Record<string, unknown>>;
        format?: Record<string, unknown>;
      };
      const video = output.streams?.find(
        (stream) => stream["codec_type"] === "video",
      );
      if (!video) throw new Error("ffprobe found no video stream");
      const frameRate = ratio(String(video["avg_frame_rate"] ?? ""));
      const durationSeconds = Number(
        video["duration"] ?? output.format?.["duration"],
      );
      const durationFrames = Math.round(
        durationSeconds * (frameRate.numerator / frameRate.denominator),
      );
      return {
        kind: "video",
        mimeType: "video/mp4",
        extension: ".mp4",
        width: Number(video["width"]),
        height: Number(video["height"]),
        durationFrames,
        frameRate: { ...frameRate, dropFrame: false },
      };
    },
  };
}

export async function loadVerifiedFfmpeg(input: {
  root: string;
  publicKeyPem?: string;
}): Promise<
  | {
      version: string;
      executablePath: string;
      audioMixAvailable: boolean;
      videoProofAvailable: boolean;
    }
  | undefined
> {
  if (!input.publicKeyPem?.trim()) return undefined;
  const manifestPath = join(input.root, "render-manifest.json");
  const executablePath = join(
    input.root,
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  if (!existsSync(manifestPath) || !existsSync(executablePath))
    return undefined;
  const manifest = verifyRendererSidecarManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    input.publicKeyPem,
  );
  const executableSha256 = createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex");
  if (executableSha256 !== manifest.sha256)
    throw new Error("Renderer sidecar artifact checksum mismatch");
  // Failure disables only the new policy. Legacy jobs never inherit an unverified mix capability.
  const audioMixAvailable = await verifyFfmpegAudioMixCapability(
    executablePath,
  ).catch(() => false);
  const videoProofAvailable = await verifyFfmpegVideoProofCapability(
    executablePath,
  ).catch(() => false);
  return {
    version: manifest.version,
    executablePath,
    audioMixAvailable,
    videoProofAvailable,
  };
}

/** Actual x264 MP4 decode, three frames and original demux clock, not a filter-list or process-exists check. */
export async function verifyFfmpegVideoProofCapability(
  executablePath: string,
): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-video-capability-"));
  try {
    const path = join(directory, "controlled.mp4");
    await executeFile(
      executablePath,
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=16x16:r=25:d=0.12",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-video_track_timescale",
        "12800",
        path,
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
    );
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const proof = await verifyRenderVideoFrames({
        executable: executablePath,
        path,
        probe: {
          streamIndex: 0,
          width: 16,
          height: 16,
          codecName: "h264",
          pixelFormat: "yuv420p",
          timeBase: { n: 1n, d: 12800n },
          startTicks: 0n,
          durationTicks: 1536n,
          origin: { n: 0n, d: 1n },
        },
        outputFrames: 3,
        signal: abort.signal,
        observer: () => {},
      });
      return proof.frames === 3;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Exercise the actual mixer and AAC/x264 encoders after signature+executable SHA verification. */
export async function verifyFfmpegAudioMixCapability(
  executablePath: string,
): Promise<boolean> {
  const controls = {
    inputIndex: 0,
    channels: 1 as const,
    startFrame: 0,
    durationFrames: 1,
    sourceOffsetFrame: 0,
    volume: 0.8,
    fadeInFrames: 1,
    fadeOutFrames: 1,
    duckingGain: 0.5,
  };
  const mix = buildTimelineAudioMix(1, [
    { ...controls, kind: "bgm" },
    { ...controls, kind: "dialogue", volume: 0 },
  ]);
  const { stdout } = await executeFile(
    executablePath,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.125:s=48000:d=0.04",
      "-filter_complex",
      mix.filters.join(";"),
      "-map",
      `[${mix.outputLabel}]`,
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ],
    {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      encoding: "buffer",
    },
  );
  if (stdout.length !== 1920 * 8)
    throw new Error(
      "Signed mixer did not produce the exact capability sample count",
    );
  for (let sample = 0; sample < 1920; sample++) {
    const expected =
      0.125 * 0.8 * (sample / 1920) * ((1920 - sample) / 1920) * 0.5;
    for (let channel = 0; channel < 2; channel++) {
      const actual = stdout.readFloatLE((sample * 2 + channel) * 4);
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-6)
        throw new Error(
          "Signed mixer did not preserve the frozen gain/sample-clock policy",
        );
    }
  }
  await executeFile(
    executablePath,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:r=25:d=0.04",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo:d=0.04",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-frames:v",
      "1",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-f",
      "null",
      "-",
    ],
    { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
  );
  return true;
}
