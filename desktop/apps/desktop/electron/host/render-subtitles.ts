import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFontTextCoverage } from "./font-cmap";
import {
  readBoundedRendererFontMember,
  type VerifiedRendererFont,
} from "./renderer-fonts";
import {
  HOST_MAX_RENDER_SUBTITLE_CUES,
  type HostRendererFontRef,
  type HostTimelineRenderSubtitleCue,
} from "@dramaip/desktop-host";

export type RenderSubtitleFontRef = HostRendererFontRef;
export type RenderSubtitleCue = HostTimelineRenderSubtitleCue;
export const MAX_RENDER_SUBTITLE_CUES = HOST_MAX_RENDER_SUBTITLE_CUES;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const FONT_MEMBER = "subtitle-font.ttf";
const FONTCONFIG_MEMBER = "subtitle-fontconfig.xml";
const FONTCONFIG_EMPTY = Buffer.from(
  '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><selectfont><rejectfont><glob>*</glob></rejectfont></selectfont></fontconfig>',
);
/** Fontconfig sees no configured font directories; direct FreeType fontfile loading remains the only success path. */
export function renderSubtitleEnvironment(
  directory: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FONTCONFIG_FILE: join(directory, FONTCONFIG_MEMBER),
    FONTCONFIG_PATH: directory,
    FONTCONFIG_SYSROOT: "",
  };
}
const member = (index: number) =>
  `subtitle-${String(index).padStart(4, "0")}.txt`;
const style =
  "expansion=none:fontcolor=white:fontsize=48:line_spacing=8:fix_bounds=0";
export class SubtitlePreparationError extends Error {
  readonly code = "SUBTITLE_PREPARATION_INVALID";
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Exact-font P0 preparation; public shape is checked separately before the supervised job is allocated. */
export function validateRenderSubtitleCues(
  durationFrames: number,
  cues: readonly RenderSubtitleCue[],
  font: VerifiedRendererFont,
  ref: RenderSubtitleFontRef,
): void {
  if (
    !Number.isSafeInteger(durationFrames) ||
    durationFrames < 1 ||
    durationFrames > 1_000_000 ||
    !object(ref) ||
    Object.keys(ref).sort().join(",") !== "id,packVersion,sha256" ||
    ref.id !== font.descriptor.id ||
    ref.packVersion !== font.descriptor.packVersion ||
    ref.sha256 !== font.descriptor.sha256
  )
    throw new SubtitlePreparationError(
      "Subtitle policy requires the original exact signed font identity",
    );
  if (
    !Array.isArray(cues) ||
    !cues.length ||
    cues.length > MAX_RENDER_SUBTITLE_CUES
  )
    throw new SubtitlePreparationError(
      "Subtitle cue count exceeds the explicit preparation budget",
    );
  const ids = new Set<string>();
  let total = 0;
  for (const cue of cues) {
    if (
      !object(cue) ||
      Object.keys(cue).sort().join(",") !==
        "clipId,durationFrames,startFrame,text" ||
      typeof cue.clipId !== "string" ||
      !uuid.test(cue.clipId) ||
      ids.has(cue.clipId) ||
      typeof cue.startFrame !== "number" ||
      !Number.isSafeInteger(cue.startFrame) ||
      cue.startFrame < 0 ||
      typeof cue.durationFrames !== "number" ||
      !Number.isSafeInteger(cue.durationFrames) ||
      cue.durationFrames < 1 ||
      !Number.isSafeInteger(cue.startFrame + cue.durationFrames) ||
      cue.startFrame + cue.durationFrames > durationFrames ||
      typeof cue.text !== "string"
    )
      throw new SubtitlePreparationError(
        "Subtitle cues require unique original IDs, integer half-open ranges and literal text",
      );
    try {
      assertFontTextCoverage(cue.text, font.glyph);
    } catch (cause) {
      throw new SubtitlePreparationError(
        cause instanceof Error
          ? cause.message
          : "Subtitle font coverage failed",
        { cause },
      );
    }
    ids.add(cue.clipId);
    total += Buffer.byteLength(cue.text, "utf8");
  }
  if (total > 1024 * 1024)
    throw new SubtitlePreparationError(
      "Subtitle text exceeds the complete byte budget",
    );
  const sorted = [...cues].sort((a, b) => a.startFrame - b.startFrame);
  for (let n = 1; n < sorted.length; n++)
    if (
      sorted[n]!.startFrame <
      sorted[n - 1]!.startFrame + sorted[n - 1]!.durationFrames
    )
      throw new SubtitlePreparationError(
        "Overlapping subtitle placement is not supported; no cue is silently dropped",
      );
}

/** Names are host constants, text is exclusively a file, and FFmpeg expansion is explicitly disabled. */
export function buildRenderSubtitleFilters(
  cues: readonly RenderSubtitleCue[],
): string[] {
  if (
    !Array.isArray(cues) ||
    !cues.length ||
    cues.length > MAX_RENDER_SUBTITLE_CUES
  )
    throw new SubtitlePreparationError(
      "Subtitle graph cue count exceeds its budget",
    );
  for (const cue of cues)
    if (
      !object(cue) ||
      typeof cue.startFrame !== "number" ||
      typeof cue.durationFrames !== "number" ||
      !Number.isSafeInteger(cue.startFrame) ||
      !Number.isSafeInteger(cue.durationFrames) ||
      cue.startFrame < 0 ||
      cue.durationFrames < 1 ||
      cue.startFrame + cue.durationFrames > 1_000_000
    )
      throw new SubtitlePreparationError(
        "Subtitle graph requires bounded integer frames, not filter expressions",
      );
  const result = cues.map(
    (cue, index) =>
      `drawtext=fontfile=${FONT_MEMBER}:textfile=${member(index)}:${style}:x=(w-tw)/2:y=h-th-96:enable='gte(n,${cue.startFrame})*lt(n,${cue.startFrame + cue.durationFrames})'`,
  );
  if (Buffer.byteLength(result.join(",")) > 64 * 1024)
    throw new SubtitlePreparationError(
      "Subtitle graph exceeds the explicit resource budget",
    );
  return result;
}

async function measure(input: {
  executable: string;
  directory: string;
  textMember: string;
  signal: AbortSignal;
  observer(child: ChildProcess | undefined): void;
}): Promise<{ width: number; height: number }> {
  input.signal.throwIfAborted();
  const child = spawn(
    input.executable,
    [
      "-nostdin",
      "-v",
      "verbose",
      "-xerror",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1080x1920:r=25",
      "-vf",
      `drawtext=fontfile=${FONT_MEMBER}:textfile=${input.textMember}:${style}:x=(w-tw)/2+print(tw+1000000)-1000000-tw:y=h-th-96+print(th+2000000)-2000000-th`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    {
      cwd: input.directory,
      env: renderSubtitleEnvironment(input.directory),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  input.observer(child);
  let stderr = "",
    stdoutBytes = 0,
    failure: Error | undefined,
    killTimer: ReturnType<typeof setTimeout> | undefined;
  let inkPixels = 0,
    outsideSafeArea = false;
  const stop = () => {
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
  };
  const closed = new Promise<number>((resolve) => {
    child.once("error", (cause) => {
      failure = cause;
    });
    child.once("close", (code) => resolve(code ?? -1));
  });
  child.stdout.on("data", (chunk: Buffer) => {
    for (const [index, value] of chunk.entries())
      if (value) {
        const pixel = stdoutBytes + index,
          x = pixel % 1080,
          y = Math.floor(pixel / 1080);
        inkPixels++;
        if (x < 96 || x >= 984 || y < 1344 || y >= 1824) outsideSafeArea = true;
      }
    stdoutBytes += chunk.length;
    if (stdoutBytes > 1080 * 1920) {
      failure ??= new SubtitlePreparationError(
        "Subtitle measuring raster exceeded its frame budget",
      );
      stop();
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (Buffer.byteLength(stderr) + Buffer.byteLength(chunk) > 64 * 1024) {
      failure ??= new SubtitlePreparationError(
        "Subtitle measuring log exceeded its byte budget",
      );
      stop();
    } else stderr += chunk;
  });
  input.signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(() => {
    failure ??= new SubtitlePreparationError(
      "Subtitle measuring process timed out",
    );
    stop();
  }, 30_000);
  try {
    if (input.signal.aborted) stop();
    const code = await closed;
    input.signal.throwIfAborted();
    if (/\bUsing\s+"/u.test(stderr))
      throw new SubtitlePreparationError(
        "Native drawtext attempted a fontconfig substitute; exact-font rendering is required",
      );
    if (failure || code !== 0 || stdoutBytes !== 1080 * 1920)
      throw new SubtitlePreparationError(
        "Actual font rasterizer could not prove subtitle geometry",
        { cause: failure },
      );
    if (!inkPixels || outsideSafeArea)
      throw new SubtitlePreparationError(
        "Actual subtitle ink exceeds the P0 safe area or has no visible raster; no clipping fallback",
      );
    const values = stderr
      .split(/\r?\n/u)
      .filter((line) => /^\d+\.\d{6}$/u.test(line.trim()))
      .map(Number);
    if (
      values.length < 2 ||
      values.some((value) => value < 1_000_000 || value >= 3_000_000)
    )
      throw new SubtitlePreparationError(
        "Actual font rasterizer returned no bounded geometry",
      );
    const widths = values
        .filter((value) => value < 2_000_000)
        .map((value) => value - 1_000_000),
      heights = values
        .filter((value) => value >= 2_000_000)
        .map((value) => value - 2_000_000);
    if (
      !widths.length ||
      !heights.length ||
      widths.some((v) => v !== widths[0]) ||
      heights.some((v) => v !== heights[0])
    )
      throw new SubtitlePreparationError(
        "Actual font rasterizer returned ambiguous geometry",
      );
    const width = widths[0]!,
      height = heights[0]!;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 888 ||
      height > 480
    )
      throw new SubtitlePreparationError(
        "Subtitle exceeds the fixed P0 safe area; no clipping, resizing or wrapping fallback",
      );
    return { width, height };
  } finally {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    input.signal.removeEventListener("abort", stop);
    input.observer(undefined);
  }
}

async function exclusive(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, "wx", 0o400);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
}

export async function prepareRenderSubtitles(input: {
  executable: string;
  directory: string;
  durationFrames: number;
  font: VerifiedRendererFont;
  fontRef: RenderSubtitleFontRef;
  cues: readonly RenderSubtitleCue[];
  signal: AbortSignal;
  observer(child: ChildProcess | undefined): void;
}): Promise<{
  filters: readonly string[];
  fontSha256: string;
  cues: readonly {
    clipId: string;
    textSha256: string;
    width: number;
    height: number;
  }[];
}> {
  input = { ...input }; // Freeze directory, executable, signal and observer references as well as the cue data.
  input.signal.throwIfAborted();
  // Freeze all caller-controlled values before the first await. Copy original verified font bytes once.
  const cues = structuredClone(input.cues),
    ref = structuredClone(input.fontRef),
    bytes = input.font.bytes();
  validateRenderSubtitleCues(input.durationFrames, cues, input.font, ref);
  const fontSha256 = createHash("sha256").update(bytes).digest("hex");
  if (fontSha256 !== ref.sha256)
    throw new SubtitlePreparationError(
      "Verified font snapshot changed before staging",
    );
  const filters = buildRenderSubtitleFilters(cues);
  await exclusive(join(input.directory, FONT_MEMBER), bytes);
  await exclusive(join(input.directory, FONTCONFIG_MEMBER), FONTCONFIG_EMPTY);
  const result: {
    clipId: string;
    textSha256: string;
    width: number;
    height: number;
  }[] = [];
  const geometry = new Map<string, { width: number; height: number }>();
  for (const [index, cue] of cues.entries()) {
    input.signal.throwIfAborted();
    const text = Buffer.from(cue.text, "utf8"),
      textSha256 = createHash("sha256").update(text).digest("hex");
    await exclusive(join(input.directory, member(index)), text);
    let dimensions = geometry.get(textSha256);
    if (!dimensions) {
      dimensions = await measure({ ...input, textMember: member(index) });
      geometry.set(textSha256, dimensions);
    }
    result.push({ clipId: cue.clipId, textSha256, ...dimensions });
  }
  input.signal.throwIfAborted();
  return {
    filters: Object.freeze(filters),
    fontSha256,
    cues: Object.freeze(result),
  };
}

/** Check complete private bytes again immediately before the supervised encoder reads them. */
export async function verifyPreparedSubtitleArtifacts(
  directory: string,
  prepared: Awaited<ReturnType<typeof prepareRenderSubtitles>>,
  signal: AbortSignal,
): Promise<void> {
  const expected = [
    {
      member: FONT_MEMBER,
      maximum: 32 * 1024 * 1024,
      sha256: prepared.fontSha256,
    },
    {
      member: FONTCONFIG_MEMBER,
      maximum: 1024,
      sha256: createHash("sha256").update(FONTCONFIG_EMPTY).digest("hex"),
    },
    ...prepared.cues.map((cue, index) => ({
      member: member(index),
      maximum: 16 * 1024,
      sha256: cue.textSha256,
    })),
  ];
  for (const artifact of expected) {
    signal.throwIfAborted();
    let bytes: Buffer;
    try {
      bytes = await readBoundedRendererFontMember(
        join(directory, artifact.member),
        artifact.maximum,
      );
    } catch (cause) {
      signal.throwIfAborted();
      throw new SubtitlePreparationError(
        "Private subtitle artifact cannot be verified before encoding",
        { cause },
      );
    }
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
      throw new SubtitlePreparationError(
        "Private subtitle font, policy or text bytes changed after preparation",
      );
  }
  signal.throwIfAborted();
}

/** Actual negative control: this renderer must reject invalid font bytes, not draw a system substitute. */
export async function verifyRendererRejectsFontFallback(input: {
  executable: string;
  signal: AbortSignal;
  observer(child: ChildProcess | undefined): void;
}): Promise<void> {
  input.signal.throwIfAborted();
  const directory = await mkdtemp(
    join(tmpdir(), "dramaip-font-negative-capability-"),
  );
  const bytes = Buffer.from("INVALID-CONTROL-FONT-NOT-A-DISTRIBUTION-ARTIFACT"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const fontRef = {
    id: randomUUID(),
    packVersion: "0.0.0-negative-control",
    sha256,
  };
  let nativePidObserved = false,
    correctlyRejected = false;
  try {
    try {
      await prepareRenderSubtitles({
        ...input,
        directory,
        durationFrames: 1,
        fontRef,
        font: {
          descriptor: {
            ...fontRef,
            label: "Internal negative control",
            sizeBytes: bytes.length,
            license: "NOT-A-FONT",
            sourceUrl: "https://fixtures.invalid/internal-negative-control",
          },
          glyph: (cp) => (cp === 65 ? 1 : 0),
          bytes: () => Buffer.from(bytes),
        },
        cues: [
          { clipId: randomUUID(), startFrame: 0, durationFrames: 1, text: "A" },
        ],
        observer: (child) => {
          if (child?.pid) nativePidObserved = true;
          input.observer(child);
        },
      });
    } catch (cause) {
      input.signal.throwIfAborted();
      correctlyRejected =
        nativePidObserved &&
        cause instanceof SubtitlePreparationError &&
        cause.message ===
          "Actual font rasterizer could not prove subtitle geometry";
      if (!correctlyRejected) throw cause;
    }
    if (!correctlyRejected)
      throw new SubtitlePreparationError(
        "Renderer did not reject the actual invalid-font control; no subtitle capability is certified",
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
