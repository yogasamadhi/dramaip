import { spawn, type ChildProcess } from "node:child_process";
import { open } from "node:fs/promises";
import type { HostTimelineRenderInput } from "@dramaip/desktop-host";
import type { RenderAudioProbe } from "./audio-probe";
import { verifyMixedAudioPcm, verifySourceAudioPcm } from "./audio-pcm";
import { renderMediaInputOptions } from "./render-media-input";
import {
  buildTimelineAudioMix,
  type ResolvedRenderAudioClip,
} from "./render-audio";

type PcmReceipt = Awaited<ReturnType<typeof verifyMixedAudioPcm>>;
type ChildObserver = (child: ChildProcess | undefined) => void;

/** Stream finite PCM with bounded memory; every child is reaped even on validation failure. */
async function consumeDecoder(
  executable: string,
  args: string[],
  signal: AbortSignal,
  observer: ChildObserver,
  consume: (chunks: AsyncIterable<Uint8Array>) => Promise<PcmReceipt>,
): Promise<PcmReceipt> {
  signal.throwIfAborted();
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  observer(child);
  let tail = "";
  let failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
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
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    tail = `${tail}${chunk}`.slice(-2000);
  });
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) stop();
    const proof = await consume(child.stdout);
    const code = await closed;
    signal.throwIfAborted();
    if (failure || code !== 0)
      throw new Error(`Audio decoder failed (${code}): ${tail.slice(-500)}`, {
        cause: failure,
      });
    return proof;
  } catch (cause) {
    stop();
    await closed;
    throw cause;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener("abort", stop);
    observer(undefined);
  }
}

/** Decode the whole actual source before trim/apad; duration metadata alone is not proof. */
export async function verifyRenderAudioSource(input: {
  executable: string;
  path: string;
  probe: Extract<RenderAudioProbe, { hasAudio: true }>;
  requiredSamples: number;
  signal: AbortSignal;
  observer: ChildObserver;
}): Promise<PcmReceipt> {
  const { probe } = input;
  if (input.requiredSamples > probe.presentationEndSamples)
    throw new Error(
      "Actual audio presentation does not cover the frozen clip range",
    );
  const channelMap = probe.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
  return consumeDecoder(
    input.executable,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      ...renderMediaInputOptions(input.path),
      "-i",
      input.path,
      "-map",
      `0:${probe.streamIndex}`,
      "-af",
      `${channelMap}aresample=48000:async=0:first_pts=0,aformat=sample_fmts=flt:channel_layouts=stereo`,
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ],
    input.signal,
    input.observer,
    (chunks) =>
      verifySourceAudioPcm(
        chunks,
        Math.max(input.requiredSamples, probe.presentationEndSamples),
        probe.presentationEndSamples + 8192,
        input.signal,
      ),
  );
}

/** Materialize only verified, unnormalized mix bytes in this job's exclusive private directory. */
export async function renderTimelineAudioPcm(input: {
  executable: string;
  render: HostTimelineRenderInput;
  paths: ReadonlyMap<string, string>;
  probes: ReadonlyMap<string, RenderAudioProbe>;
  pcmPath: string;
  filterPath: string;
  signal: AbortSignal;
  observer: ChildObserver;
}): Promise<PcmReceipt> {
  if (!input.render.audioPlan)
    throw new Error("An explicit frozen audio policy is required");
  const args = ["-nostdin", "-v", "error", "-xerror"];
  const indices = new Map<string, number>();
  const clips: ResolvedRenderAudioClip[] = [];
  for (const clip of input.render.audioPlan.clips) {
    const probe = input.probes.get(clip.mediaRef);
    if (!probe) throw new Error("Audio source has no actual stream proof");
    if (!probe.hasAudio) {
      if (clip.kind !== "video")
        throw new Error("Standalone audio stream is missing");
      continue; // Actual video inventory proved no embedded audio; not a failed read fallback.
    }
    const path = input.paths.get(clip.mediaRef);
    if (!path) throw new Error("Audio source has no exact private snapshot");
    if (!indices.has(clip.mediaRef)) {
      indices.set(clip.mediaRef, indices.size);
      args.push(...renderMediaInputOptions(path), "-i", path);
    }
    const {
      kind,
      startFrame,
      durationFrames,
      sourceOffsetFrame,
      volume,
      fadeInFrames,
      fadeOutFrames,
      duckingGain,
    } = clip;
    clips.push({
      inputIndex: indices.get(clip.mediaRef)!,
      channels: probe.channels,
      kind,
      startFrame,
      durationFrames,
      sourceOffsetFrame,
      volume,
      fadeInFrames,
      fadeOutFrames,
      duckingGain,
    });
  }
  if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024)
    throw new Error("Audio input argv exceeds the explicit resource budget");
  const mix = buildTimelineAudioMix(input.render.durationFrames, clips);
  const graph = await open(input.filterPath, "wx", 0o400);
  try {
    await graph.writeFile(mix.filters.join(";"));
  } finally {
    await graph.close();
  }
  const output = await open(input.pcmPath, "wx", 0o600);
  async function* write(chunks: AsyncIterable<Uint8Array>) {
    for await (const chunk of chunks) {
      input.signal.throwIfAborted();
      for (let offset = 0; offset < chunk.byteLength;) {
        const { bytesWritten } = await output.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (!bytesWritten)
          throw new Error("Private mix write did not complete");
        offset += bytesWritten;
      }
      yield chunk;
    }
  }
  try {
    const proof = await consumeDecoder(
      input.executable,
      [
        ...args,
        "-filter_complex_script",
        input.filterPath,
        "-map",
        `[${mix.outputLabel}]`,
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        "pipe:1",
      ],
      input.signal,
      input.observer,
      (chunks) =>
        verifyMixedAudioPcm(write(chunks), mix.samplesPerChannel, input.signal),
    );
    await output.sync();
    await output.chmod(0o400);
    return proof;
  } finally {
    await output.close();
  }
}

/** Check the encoded output actually decodes to the requested full stereo duration, without pad. */
export async function verifyRenderedAudioOutput(input: {
  executable: string;
  path: string;
  probe: RenderAudioProbe;
  samplesPerChannel: number;
  signal: AbortSignal;
  observer: ChildObserver;
}): Promise<PcmReceipt> {
  if (
    !input.probe.hasAudio ||
    input.probe.codecName !== "aac" ||
    input.probe.channels !== 2 ||
    input.probe.sampleRate !== 48000 ||
    Math.abs(input.probe.presentationEndSamples - input.samplesPerChannel) >
      1024
  )
    throw new Error(
      "Encoded render has no matching AAC stereo presentation proof",
    );
  return consumeDecoder(
    input.executable,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      ...renderMediaInputOptions(input.path),
      "-i",
      input.path,
      "-map",
      `0:${input.probe.streamIndex}`,
      "-af",
      `aresample=48000:async=0:first_pts=0,aformat=sample_fmts=flt:channel_layouts=stereo,atrim=end_sample=${input.samplesPerChannel}`,
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ],
    input.signal,
    input.observer,
    (chunks) =>
      verifySourceAudioPcm(
        chunks,
        input.samplesPerChannel,
        input.samplesPerChannel,
        input.signal,
      ),
  );
}
