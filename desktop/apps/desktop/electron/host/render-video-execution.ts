import { spawn, type ChildProcess } from "node:child_process";
import { renderMediaInputOptions } from "./render-media-input";
import {
  VideoFrameHashVerifier,
  VideoFrameProofError,
  type RenderVideoProbe,
  type VideoFrameProof,
} from "./video-proof";

/** Decode every original frame and preserve its clock. A metadata-only, copy-codec or normalized-fps result cannot pass. */
export async function verifyRenderVideoFrames(input: {
  executable: string;
  path: string;
  probe: RenderVideoProbe;
  requiredRanges?: ReadonlyArray<{
    sourceOffsetFrame: number;
    durationFrames: number;
  }>;
  outputFrames?: number;
  signal: AbortSignal;
  observer(child: ChildProcess | undefined): void;
}): Promise<VideoFrameProof> {
  input.signal.throwIfAborted();
  const verifier = new VideoFrameHashVerifier(input);
  const child = spawn(
    input.executable,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-copyts",
      ...renderMediaInputOptions(input.path),
      "-i",
      input.path,
      "-map",
      `0:${input.probe.streamIndex}`,
      "-an",
      "-c:v",
      "rawvideo",
      "-enc_time_base",
      "demux",
      "-fps_mode",
      "passthrough",
      "-f",
      "framehash",
      "-hash",
      "sha256",
      "pipe:1",
    ],
    { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  input.observer(child);
  let tail = "",
    failure: Error | undefined;
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
  input.signal.addEventListener("abort", stop, { once: true });
  try {
    if (input.signal.aborted) stop();
    for await (const chunk of child.stdout) {
      input.signal.throwIfAborted();
      verifier.push(chunk as Uint8Array);
    }
    const code = await closed;
    input.signal.throwIfAborted();
    if (failure || code !== 0)
      throw Error(`Video decoder failed (${code}): ${tail.slice(-500)}`, {
        cause: failure,
      });
    return verifier.finish();
  } catch (cause) {
    stop();
    await closed;
    if (input.signal.aborted) throw cause;
    throw new VideoFrameProofError(
      cause instanceof Error ? cause.message : "Video frame proof failed",
      { cause },
    );
  } finally {
    if (killTimer) clearTimeout(killTimer);
    input.signal.removeEventListener("abort", stop);
    input.observer(undefined);
  }
}
