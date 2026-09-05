import { createHash, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type { MediaProbeResult } from "./media-archive";

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
    async probe(path) {
      const { stdout } = await executeFile(
        executablePath,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
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
  return { version: manifest.version, executablePath };
}
