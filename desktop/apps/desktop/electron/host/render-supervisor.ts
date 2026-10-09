import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rename, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import {
  validTimelineRenderInput,
  HOST_MANAGED_MEDIA_EXTENSIONS,
  type HostTimelineRenderInput,
  type HostTimelineRenderJob,
  type HostArchivedMedia,
  type HostRendererFontDescriptor,
} from "@dramaip/desktop-host";
import { ManagedMediaReader } from "./managed-media-reader";
import type { MediaProbeResult } from "./media-archive";
import type { RenderAudioProbe } from "./audio-probe";
import { AudioMixPeakError } from "./audio-pcm";
import { VideoFrameProofError, type RenderVideoProbe } from "./video-proof";
import { verifyRenderVideoFrames } from "./render-video-execution";
import {
  prepareRenderSubtitles,
  buildRenderSubtitleFilters,
  SubtitlePreparationError,
  renderSubtitleEnvironment,
  verifyPreparedSubtitleArtifacts,
  verifyRendererRejectsFontFallback,
} from "./render-subtitles";
import type { VerifiedRendererFont } from "./renderer-fonts";
import {
  renderTimelineAudioPcm,
  verifyRenderAudioSource,
  verifyRenderedAudioOutput,
} from "./render-audio-execution";

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
  if (!validTimelineRenderInput(input))
    throw new Error(
      "Renderer requires exact opaque archive refs, sizes and checksums",
    );
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
  mixedPcmPath?: string,
  subtitles?: Awaited<ReturnType<typeof prepareRenderSubtitles>>,
): string[] {
  const segments = renderSegments(input, resolveMedia);
  if (input.audioPlan && !mixedPcmPath)
    throw new Error(
      "Frozen audio mix requires a verified private PCM artifact; no silent fallback",
    );
  const subtitlePlan = input.subtitlePlan;
  const burning = subtitlePlan?.mode === "burn-in";
  if (
    burning &&
    (!subtitles ||
      subtitles.fontSha256 !== subtitlePlan.font.sha256 ||
      JSON.stringify(subtitles.filters) !==
        JSON.stringify(buildRenderSubtitleFilters(subtitlePlan.cues)))
  )
    throw new SubtitlePreparationError(
      "Frozen burn-in requires exact verified private subtitle preparation; no omit fallback",
    );
  if (!burning && subtitles)
    throw new SubtitlePreparationError(
      "An absent or omitted subtitle policy cannot adopt burn-in artifacts",
    );
  const args = ["-nostdin", "-y"];
  if (burning) args.push("-v", "verbose");
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
        "-protocol_whitelist",
        "file",
        "-f",
        "mov",
        "-enable_drefs",
        "0",
        "-use_absolute_path",
        "0",
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
  if (input.audioPlan)
    args.push("-f", "f32le", "-ar", "48000", "-ac", "2", "-i", mixedPcmPath!);
  else
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
    `${segments.map((_segment, index) => `[v${index}]`).join("")}concat=n=${segments.length}:v=1:a=0[${burning ? "vbase" : "vout"}]`,
  );
  if (burning) filters.push(`[vbase]${subtitles!.filters.join(",")}[vout]`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${audioInput}:a:0`,
    "-c:v",
    "libx264",
    "-r",
    "25",
    "-fps_mode",
    "cfr",
    "-frames:v",
    String(input.durationFrames),
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

/** Verify every complete source and copy into a private, exclusive job snapshot before FFmpeg reads it. */
export async function stageRenderSources(
  input: HostTimelineRenderInput,
  directory: string,
  reader: ManagedMediaReader,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  if (!validTimelineRenderInput(input))
    throw new Error("Invalid frozen render sources");
  const paths = new Map<string, string>();
  const descriptors = new Map<string, string>();
  for (const clip of [...input.clips, ...(input.audioPlan?.clips ?? [])]) {
    signal.throwIfAborted();
    const descriptor = JSON.stringify({
      mediaRef: clip.mediaRef,
      sha256: clip.sha256,
      sizeBytes: clip.sizeBytes,
      mimeType: clip.mimeType,
    });
    if (paths.has(clip.mediaRef)) {
      if (descriptors.get(clip.mediaRef) !== descriptor)
        throw new Error("Conflicting frozen archive descriptors");
      continue;
    }
    const stream = (await reader.read(clip, signal)).getReader();
    const path = join(
      directory,
      `${clip.mediaRef}.input${HOST_MANAGED_MEDIA_EXTENSIONS[clip.mimeType]}`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, "wx", 0o400);
      let size = 0;
      const hash = createHash("sha256");
      while (true) {
        signal.throwIfAborted();
        const chunk = await stream.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > clip.sizeBytes)
          throw new Error("Frozen source grew during read");
        hash.update(chunk.value);
        for (let offset = 0; offset < chunk.value.byteLength;) {
          signal.throwIfAborted();
          const { bytesWritten } = await handle.write(
            chunk.value,
            offset,
            chunk.value.byteLength - offset,
          );
          if (!bytesWritten)
            throw new Error("Frozen source write did not complete");
          offset += bytesWritten;
        }
      }
      if (size !== clip.sizeBytes || hash.digest("hex") !== clip.sha256)
        throw new Error("Frozen source did not match complete bytes");
      signal.throwIfAborted();
      paths.set(clip.mediaRef, path);
      descriptors.set(clip.mediaRef, descriptor);
    } finally {
      await stream.cancel().catch(() => {});
      stream.releaseLock();
      await handle?.close();
    }
  }
  return paths;
}

interface InternalJob extends HostTimelineRenderJob {
  child?: ChildProcess;
  temporaryDirectory?: string;
  abort: AbortController;
  done?: Promise<void>;
  inputHash: string;
}

function publicJob(job: InternalJob): HostTimelineRenderJob {
  const {
    child: _child,
    temporaryDirectory: _temporary,
    abort: _abort,
    done: _done,
    inputHash: _inputHash,
    ...value
  } = job;
  return structuredClone(value);
}

export class RenderSupervisor {
  readonly #jobs = new Map<string, InternalJob>();
  private disposed = false;
  private readonly configuredFonts: readonly VerifiedRendererFont[];
  private readonly verifiedFonts = new Map<string, VerifiedRendererFont>();
  private readonly fontAbort = new AbortController();
  private fontChild: ChildProcess | undefined;
  private fontVerification: Promise<void> | undefined;

  constructor(
    private readonly options: {
      ffmpegPath: string;
      rendererVersion: string;
      mediaRoot: string;
      probe(path: string): Promise<MediaProbeResult>;
      /** Only a verified sidecar's audio probe plus its exercised mixer capability enable new-policy jobs. */
      probeAudio?(
        path: string,
        kind: "audio" | "video",
      ): Promise<RenderAudioProbe>;
      audioMixAvailable?: boolean;
      probeVideo?(
        path: string,
        output?: { width: number; height: number; durationFrames: number },
      ): Promise<RenderVideoProbe>;
      videoProofAvailable?: boolean;
      /** Already signature/complete-byte verified. Actual native rasterization is still required. */
      rendererFonts?: readonly VerifiedRendererFont[];
    },
  ) {
    this.configuredFonts = Object.freeze([...(options.rendererFonts ?? [])]);
  }

  get subtitleBurnInAvailable(): boolean {
    return (
      !this.disposed && this.audioMixAvailable && this.verifiedFonts.size > 0
    );
  }
  get subtitleFonts(): readonly HostRendererFontDescriptor[] {
    return this.subtitleBurnInAvailable
      ? [...this.verifiedFonts.values()].map((font) => ({ ...font.descriptor }))
      : [];
  }
  /** Supervisor owns startup capability processes too; shutdown cancels and awaits the original verification. */
  verifySubtitleCapability(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Renderer is disposed"));
    return (this.fontVerification ??= this.verifyFonts());
  }
  private async verifyFonts(): Promise<void> {
    if (!this.audioMixAvailable || !this.configuredFonts.length) return;
    if (this.configuredFonts.length > 16)
      throw new SubtitlePreparationError(
        "Font capability exceeds the explicit pack budget",
      );
    const verified = new Map<string, VerifiedRendererFont>();
    const timeout = setTimeout(() => this.fontAbort.abort(), 30_000);
    try {
      await verifyRendererRejectsFontFallback({
        executable: this.options.ffmpegPath,
        signal: this.fontAbort.signal,
        observer: (child) => {
          this.fontChild = child;
        },
      });
      for (const font of this.configuredFonts) {
        this.fontAbort.signal.throwIfAborted();
        if (verified.has(font.descriptor.id))
          throw new SubtitlePreparationError(
            "Duplicate font capability identity",
          );
        const text = ["A", "字", "א", "م", "あ", "가", "ก", "Ж"].find((char) =>
          font.glyph(char.codePointAt(0)!),
        );
        if (!text)
          throw new SubtitlePreparationError(
            "Exact font has no supported native capability probe glyph",
          );
        const directory = await mkdtemp(
          join(tmpdir(), "dramaip-font-capability-"),
        );
        try {
          await prepareRenderSubtitles({
            executable: this.options.ffmpegPath,
            directory,
            durationFrames: 1,
            font,
            fontRef: {
              id: font.descriptor.id,
              packVersion: font.descriptor.packVersion,
              sha256: font.descriptor.sha256,
            },
            cues: [
              { clipId: randomUUID(), startFrame: 0, durationFrames: 1, text },
            ],
            signal: this.fontAbort.signal,
            observer: (child) => {
              this.fontChild = child;
            },
          });
          verified.set(font.descriptor.id, font);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
      this.fontAbort.signal.throwIfAborted();
      if (this.disposed)
        throw new SubtitlePreparationError(
          "Renderer was disposed during font verification",
        );
      for (const [id, font] of verified) this.verifiedFonts.set(id, font);
    } finally {
      clearTimeout(timeout);
      this.fontChild = undefined;
    }
  }

  get audioMixAvailable(): boolean {
    return (
      this.options.audioMixAvailable === true &&
      Boolean(this.options.probeAudio) &&
      this.options.videoProofAvailable === true &&
      Boolean(this.options.probeVideo)
    );
  }
  get rendererVersion(): string {
    return this.options.rendererVersion;
  }

  start(input: HostTimelineRenderInput): HostTimelineRenderJob {
    if (this.disposed) throw new Error("Renderer is disposed");
    // Clone before any await; caller mutations must not change queued work.
    input = structuredClone(input);
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    if (this.#jobs.has(input.jobId)) {
      const previous = this.#jobs.get(input.jobId)!;
      if (previous.inputHash !== inputHash)
        throw new Error("Render job is bound to different frozen input");
      return publicJob(previous);
    }
    if (
      [...this.#jobs.values()].filter(
        (job) => job.status === "queued" || job.status === "running",
      ).length >= 2
    )
      throw new Error("Renderer concurrent job limit reached");
    // Build once before creating state so invalid media refs and unsupported
    // timeline shapes fail synchronously without a fabricated queued job.
    if (input.audioPlan && !this.audioMixAvailable)
      throw new Error(
        "Verified audio mix capability is unavailable; no legacy silent fallback",
      );
    if (input.audioPlan && input.durationFrames > 1_000_000)
      throw new Error(
        "Render output exceeds the explicit one-million-frame verification budget",
      );
    renderSegments(input, (mediaRef) => this.mediaPath(mediaRef));
    if (input.subtitlePlan?.mode === "burn-in") {
      const font = this.verifiedFonts.get(input.subtitlePlan.font.id);
      if (
        !this.subtitleBurnInAvailable ||
        !font ||
        font.descriptor.packVersion !== input.subtitlePlan.font.packVersion ||
        font.descriptor.sha256 !== input.subtitlePlan.font.sha256
      )
        throw new SubtitlePreparationError(
          "Exact verified subtitle capability or frozen font is unavailable; no omit fallback",
        );
    }
    const now = new Date().toISOString();
    const job: InternalJob = {
      jobId: input.jobId,
      status: "queued",
      progress: 0,
      rendererVersion: this.options.rendererVersion,
      sidecarArtifactVersion: this.options.rendererVersion,
      createdAt: now,
      updatedAt: now,
      abort: new AbortController(),
      inputHash,
    };
    this.#jobs.set(job.jobId, job);
    job.done = this.execute(job, input);
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
    job.abort.abort();
    return publicJob(job);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.fontChild?.kill("SIGTERM");
    this.fontAbort.abort();
    const jobs = [...this.#jobs.values()];
    for (const job of jobs) this.cancel(job.jobId);
    await Promise.all([
      this.fontVerification?.catch(() => undefined),
      ...jobs.map((job) => job.done),
    ]);
    this.verifiedFonts.clear();
  }

  private mediaPath(mediaRef: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
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
    let temporaryDirectory: string | undefined;
    const reader = new ManagedMediaReader(this.options.mediaRoot);
    const signal = job.abort.signal;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = () => {
      job.child?.kill("SIGTERM");
      if (job.child)
        killTimer = setTimeout(() => job.child?.kill("SIGKILL"), 2_000);
    };
    signal.addEventListener("abort", interrupted, { once: true });
    const timeout = setTimeout(() => {
      job.failureCode = "RENDER_TIMEOUT";
      job.abort.abort();
    }, 30 * 60_000);
    try {
      signal.throwIfAborted();
      const capacity = await statfs(this.options.mediaRoot);
      const unique = new Map(
        [...input.clips, ...(input.audioPlan?.clips ?? [])].map((clip) => [
          clip.mediaRef,
          clip.sizeBytes,
        ]),
      );
      const needed = [...unique.values()].reduce(
        (sum, size) => sum + size,
        64 * 1024 * 1024 +
          (input.audioPlan ? input.durationFrames * 1920 * 8 : 0),
      );
      if (!Number.isSafeInteger(needed))
        throw new Error(
          "Private render capacity exceeds the exact byte budget",
        );
      if (Number(capacity.bavail) * Number(capacity.bsize) < needed)
        throw new Error("Insufficient private snapshot capacity");
      temporaryDirectory = await mkdtemp(
        join(this.options.mediaRoot, "render-job-"),
      );
      job.temporaryDirectory = temporaryDirectory;
      const staging = join(temporaryDirectory, "output.staging.mp4");
      const paths = await stageRenderSources(
        input,
        temporaryDirectory,
        reader,
        signal,
      );
      const observer = (child: ChildProcess | undefined) => {
        job.child = child;
      };
      let subtitles:
        Awaited<ReturnType<typeof prepareRenderSubtitles>> | undefined;
      if (input.subtitlePlan?.mode === "burn-in") {
        const font = this.verifiedFonts.get(input.subtitlePlan.font.id);
        if (!font)
          throw new SubtitlePreparationError(
            "Original verified font is no longer available",
          );
        subtitles = await prepareRenderSubtitles({
          executable: this.options.ffmpegPath,
          directory: temporaryDirectory,
          durationFrames: input.durationFrames,
          font,
          fontRef: input.subtitlePlan.font,
          cues: input.subtitlePlan.cues,
          signal,
          observer,
        });
      }
      if (input.audioPlan) {
        // Each unique frozen video is fully decoded once before clipping. No rounded format-duration fallback.
        for (const mediaRef of new Set(
          input.clips.map((clip) => clip.mediaRef),
        )) {
          const path = paths.get(mediaRef)!;
          const probe = await this.options.probeVideo!(path);
          signal.throwIfAborted();
          await verifyRenderVideoFrames({
            executable: this.options.ffmpegPath,
            path,
            probe,
            requiredRanges: input.clips.filter(
              (clip) => clip.mediaRef === mediaRef,
            ),
            signal,
            observer,
          });
        }
      }
      // Preserve legacy duration semantics only for explicitly absent legacy audio policy.
      for (const clip of input.audioPlan ? [] : input.clips) {
        const source = await this.options.probe(paths.get(clip.mediaRef)!);
        const sourceSeconds =
          (source.durationFrames * source.frameRate.denominator) /
          source.frameRate.numerator;
        if (
          !Number.isFinite(sourceSeconds) ||
          sourceSeconds <= 0 ||
          (clip.sourceOffsetFrame + clip.durationFrames) / 25 >
            sourceSeconds + 0.001
        )
          throw new Error("Frozen source duration does not cover clip range");
        signal.throwIfAborted();
      }
      let mixedPcmPath: string | undefined;
      if (input.audioPlan) {
        const probes = new Map<string, RenderAudioProbe>();
        for (const clip of input.audioPlan.clips) {
          if (probes.has(clip.mediaRef)) continue;
          const source = await this.options.probeAudio!(
            paths.get(clip.mediaRef)!,
            clip.kind === "video" ? "video" : "audio",
          );
          signal.throwIfAborted();
          if (source.hasAudio) {
            const requiredSamples = Math.max(
              ...input.audioPlan.clips
                .filter((item) => item.mediaRef === clip.mediaRef)
                .map(
                  (item) =>
                    (item.sourceOffsetFrame + item.durationFrames) * 1920,
                ),
            );
            await verifyRenderAudioSource({
              executable: this.options.ffmpegPath,
              path: paths.get(clip.mediaRef)!,
              probe: source,
              requiredSamples,
              signal,
              observer,
            });
          } else if (clip.kind !== "video")
            throw new Error("Standalone audio source is missing its stream");
          probes.set(clip.mediaRef, source);
        }
        mixedPcmPath = join(temporaryDirectory, "mix.verified.f32le");
        const mix = await renderTimelineAudioPcm({
          executable: this.options.ffmpegPath,
          render: input,
          paths,
          probes,
          pcmPath: mixedPcmPath,
          filterPath: join(temporaryDirectory, "audio-filter.txt"),
          signal,
          observer,
        });
        if ((await sha256File(mixedPcmPath)) !== mix.sha256)
          throw new Error("Private mix bytes changed after verification");
      }
      if (subtitles)
        await verifyPreparedSubtitleArtifacts(
          temporaryDirectory,
          subtitles,
          signal,
        );
      const args = buildRenderArguments(
        input,
        staging,
        (mediaRef) => paths.get(mediaRef)!,
        mixedPcmPath,
        subtitles,
      );
      signal.throwIfAborted();
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      const child = spawn(this.options.ffmpegPath, args, {
        cwd: temporaryDirectory,
        ...(subtitles
          ? { env: renderSubtitleEnvironment(temporaryDirectory) }
          : {}),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;
      let progressBuffer = "";
      let errorTail = "";
      let nativeFontFallback = false;
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
        if (subtitles && /\bUsing\s+"/u.test(`${errorTail}${chunk}`))
          nativeFontFallback = true;
        errorTail = `${errorTail}${chunk}`.slice(-4_000);
      });
      const exit = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? -1));
      });
      delete job.child;
      if ((job.status as HostTimelineRenderJob["status"]) === "canceled")
        return;
      if (nativeFontFallback)
        throw new SubtitlePreparationError(
          "Native encoder attempted a fontconfig substitute; no output is published",
        );
      if (exit !== 0)
        throw new Error(
          `Renderer exited with ${exit}: ${errorTail.slice(-500)}`,
        );
      let probe: MediaProbeResult;
      signal.throwIfAborted();
      if (input.audioPlan) {
        const video = await this.options.probeVideo!(staging, {
          width: input.profile.width,
          height: input.profile.height,
          durationFrames: input.durationFrames,
        });
        await verifyRenderVideoFrames({
          executable: this.options.ffmpegPath,
          path: staging,
          probe: video,
          outputFrames: input.durationFrames,
          signal,
          observer,
        });
        probe = {
          kind: "video",
          mimeType: "video/mp4",
          extension: ".mp4",
          width: video.width,
          height: video.height,
          durationFrames: input.durationFrames,
          frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        };
        await verifyRenderedAudioOutput({
          executable: this.options.ffmpegPath,
          path: staging,
          probe: await this.options.probeAudio!(staging, "video"),
          samplesPerChannel: input.durationFrames * 1920,
          signal,
          observer,
        });
      } else probe = await this.options.probe(staging);
      if (
        probe.width !== input.profile.width ||
        probe.height !== input.profile.height ||
        probe.durationFrames !== input.durationFrames ||
        probe.frameRate.numerator !== 25 ||
        probe.frameRate.denominator !== 1 ||
        probe.frameRate.dropFrame
      )
        throw new Error(
          "Rendered output did not match requested profile and frame duration",
        );
      const size = (await stat(staging)).size;
      const sha256 = await sha256File(staging);
      signal.throwIfAborted();
      const mediaRef = randomUUID();
      await rename(staging, this.mediaPath(mediaRef));
      if (signal.aborted) {
        await rm(this.mediaPath(mediaRef), { force: true });
        signal.throwIfAborted();
      }
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
        job.failureCode ??=
          cause instanceof AudioMixPeakError
            ? cause.code
            : cause instanceof SubtitlePreparationError
              ? cause.code
              : cause instanceof VideoFrameProofError
                ? cause.code
                : cause instanceof Error && cause.message.includes("ENOENT")
                  ? "MEDIA_UNAVAILABLE"
                  : "RENDER_FAILED";
        job.updatedAt = new Date().toISOString();
      }
    } finally {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", interrupted);
      await reader.dispose();
      delete job.child;
      if (temporaryDirectory)
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(
          () => undefined,
        );
      delete job.temporaryDirectory;
    }
  }
}
