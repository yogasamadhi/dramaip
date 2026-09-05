import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  HostArchivedMedia,
  HostTimelineRenderInput,
  HostTimelineRenderJob,
} from "@dramaip/desktop-host";
import type { MediaProbeResult } from "./media-archive";

interface RenderSegment {
  kind: "clip" | "gap";
  durationFrames: number;
  sourceOffsetFrame: number;
  path?: string;
}

function seconds(frames: number): string {
  return (frames / 25).toFixed(6);
}

function renderSegments(
  input: HostTimelineRenderInput,
  resolveMedia: (mediaRef: string) => string,
): RenderSegment[] {
  if (
    input.profile.width !== 1080 ||
    input.profile.height !== 1920 ||
    input.profile.frameRate.numerator !== 25 ||
    input.profile.frameRate.denominator !== 1 ||
    input.profile.frameRate.dropFrame ||
    input.profile.audioSampleRate !== 48_000 ||
    input.profile.channels !== 2
  )
    throw new Error("Renderer only certifies the P0 1080x1920/25fps profile");
  const clips = [...input.clips].sort(
    (left, right) => left.startFrame - right.startFrame,
  );
  if (!clips.length) throw new Error("Timeline has no archived video clips");
  const result: RenderSegment[] = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.startFrame < cursor)
      throw new Error(
        "Overlapping video clips are not supported by this renderer",
      );
    if (clip.startFrame > cursor)
      result.push({
        kind: "gap",
        durationFrames: clip.startFrame - cursor,
        sourceOffsetFrame: 0,
      });
    result.push({
      kind: "clip",
      durationFrames: clip.durationFrames,
      sourceOffsetFrame: clip.sourceOffsetFrame,
      path: resolveMedia(clip.mediaRef),
    });
    cursor = clip.startFrame + clip.durationFrames;
  }
  if (input.durationFrames > cursor)
    result.push({
      kind: "gap",
      durationFrames: input.durationFrames - cursor,
      sourceOffsetFrame: 0,
    });
  return result;
}

export function buildRenderArguments(
  input: HostTimelineRenderInput,
  outputPath: string,
  resolveMedia: (mediaRef: string) => string,
): string[] {
  const segments = renderSegments(input, resolveMedia);
  const args = ["-nostdin", "-y"];
  for (const segment of segments) {
    if (segment.kind === "gap") {
      args.push(
        "-f",
        "lavfi",
        "-t",
        seconds(segment.durationFrames),
        "-i",
        "color=c=black:s=1080x1920:r=25",
      );
    } else {
      args.push(
        "-ss",
        seconds(segment.sourceOffsetFrame),
        "-t",
        seconds(segment.durationFrames),
        "-i",
        segment.path!,
      );
    }
  }
  const audioInput = segments.length;
  args.push(
    "-f",
    "lavfi",
    "-t",
    seconds(input.durationFrames),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
  );
  const filters = segments.map(
    (_segment, index) =>
      `[${index}:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=25,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`,
  );
  filters.push(
    `${segments.map((_segment, index) => `[v${index}]`).join("")}concat=n=${segments.length}:v=1:a=0[vout]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${audioInput}:a:0`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-shortest",
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  );
  return args;
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

interface InternalJob extends HostTimelineRenderJob {
  child?: ChildProcess;
  temporaryDirectory?: string;
}

function publicJob(job: InternalJob): HostTimelineRenderJob {
  const { child: _child, temporaryDirectory: _temporary, ...value } = job;
  return structuredClone(value);
}

export class RenderSupervisor {
  readonly #jobs = new Map<string, InternalJob>();

  constructor(
    private readonly options: {
      ffmpegPath: string;
      rendererVersion: string;
      mediaRoot: string;
      probe(path: string): Promise<MediaProbeResult>;
    },
  ) {}

  start(input: HostTimelineRenderInput): HostTimelineRenderJob {
    if (this.#jobs.has(input.jobId))
      return publicJob(this.#jobs.get(input.jobId)!);
    // Build once before creating state so invalid media refs and unsupported
    // timeline shapes fail synchronously without a fabricated queued job.
    buildRenderArguments(input, "staging.mp4", (mediaRef) =>
      this.mediaPath(mediaRef),
    );
    const now = new Date().toISOString();
    const job: InternalJob = {
      jobId: input.jobId,
      status: "queued",
      progress: 0,
      rendererVersion: this.options.rendererVersion,
      sidecarArtifactVersion: this.options.rendererVersion,
      createdAt: now,
      updatedAt: now,
    };
    this.#jobs.set(job.jobId, job);
    void this.execute(job, input);
    return publicJob(job);
  }

  get(jobId: string): HostTimelineRenderJob | undefined {
    const job = this.#jobs.get(jobId);
    return job ? publicJob(job) : undefined;
  }

  cancel(jobId: string): HostTimelineRenderJob | undefined {
    const job = this.#jobs.get(jobId);
    if (!job) return undefined;
    if (!["queued", "running"].includes(job.status)) return publicJob(job);
    job.status = "canceled";
    job.updatedAt = new Date().toISOString();
    job.child?.kill("SIGTERM");
    return publicJob(job);
  }

  private mediaPath(mediaRef: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        mediaRef,
      )
    )
      throw new Error("Renderer received an invalid opaque media reference");
    return join(this.options.mediaRoot, `${mediaRef}.mp4`);
  }

  private async execute(
    job: InternalJob,
    input: HostTimelineRenderInput,
  ): Promise<void> {
    const temporaryDirectory = join(
      this.options.mediaRoot,
      "render-jobs",
      input.jobId,
    );
    const staging = join(temporaryDirectory, "output.staging.mp4");
    job.temporaryDirectory = temporaryDirectory;
    try {
      await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
      for (const clip of input.clips) await stat(this.mediaPath(clip.mediaRef));
      const args = buildRenderArguments(input, staging, (mediaRef) =>
        this.mediaPath(mediaRef),
      );
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      const child = spawn(this.options.ffmpegPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;
      let progressBuffer = "";
      let errorTail = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/u);
        progressBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const [key, value] = line.split("=", 2);
          if (key !== "out_time_us") continue;
          const rendered = Number(value);
          if (Number.isFinite(rendered)) {
            const total = (input.durationFrames / 25) * 1_000_000;
            job.progress = Math.max(0, Math.min(0.99, rendered / total));
            job.updatedAt = new Date().toISOString();
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        errorTail = `${errorTail}${chunk}`.slice(-4_000);
      });
      const exit = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? -1));
      });
      delete job.child;
      if ((job.status as HostTimelineRenderJob["status"]) === "canceled")
        return;
      if (exit !== 0)
        throw new Error(
          `Renderer exited with ${exit}: ${errorTail.slice(-500)}`,
        );
      const probe = await this.options.probe(staging);
      const size = (await stat(staging)).size;
      const sha256 = await sha256File(staging);
      const mediaRef = randomUUID();
      await rename(staging, this.mediaPath(mediaRef));
      const output: HostArchivedMedia = {
        mediaRef,
        kind: "video",
        mimeType: "video/mp4",
        extension: ".mp4",
        sizeBytes: size,
        sha256,
        width: probe.width,
        height: probe.height,
        durationFrames: probe.durationFrames,
        frameRate: probe.frameRate,
        status: "archived",
      };
      job.output = output;
      job.progress = 1;
      job.status = "succeeded";
      job.updatedAt = new Date().toISOString();
    } catch (cause) {
      if (job.status !== "canceled") {
        job.status = "failed";
        job.failureCode =
          cause instanceof Error && cause.message.includes("ENOENT")
            ? "MEDIA_UNAVAILABLE"
            : "RENDER_FAILED";
        job.updatedAt = new Date().toISOString();
      }
    } finally {
      delete job.child;
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      delete job.temporaryDirectory;
    }
  }
}
