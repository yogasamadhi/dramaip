import { createHash } from "node:crypto";

export class AudioMixPeakError extends Error {
  readonly code = "AUDIO_MIX_PEAK_EXCEEDED";
  constructor() {
    super(
      "Mixed audio peak exceeds unity; saved gains were not silently normalized or clipped",
    );
  }
}

/** Consume only our private, explicitly generated 48k stereo f32le output. */
export async function verifyMixedAudioPcm(
  chunks: AsyncIterable<Uint8Array>,
  samplesPerChannel: number,
  signal: AbortSignal,
): Promise<{
  samplesPerChannel: number;
  channels: 2;
  peak: number;
  sha256: string;
}> {
  return consumePcm(chunks, samplesPerChannel, samplesPerChannel, true, signal);
}

/** Decode proof before any end padding: malformed/short sources must not become successful silence. */
export async function verifySourceAudioPcm(
  chunks: AsyncIterable<Uint8Array>,
  requiredSamples: number,
  maximumSamples: number,
  signal: AbortSignal,
): Promise<{
  samplesPerChannel: number;
  channels: 2;
  peak: number;
  sha256: string;
}> {
  return consumePcm(chunks, requiredSamples, maximumSamples, false, signal);
}

async function consumePcm(
  chunks: AsyncIterable<Uint8Array>,
  minimumSamples: number,
  maximumSamples: number,
  rejectOverUnity: boolean,
  signal: AbortSignal,
): Promise<{
  samplesPerChannel: number;
  channels: 2;
  peak: number;
  sha256: string;
}> {
  signal.throwIfAborted();
  const minimumBytes = minimumSamples * 2 * 4;
  const maximumBytes = maximumSamples * 2 * 4;
  if (
    !Number.isSafeInteger(minimumSamples) ||
    minimumSamples < 1 ||
    !Number.isSafeInteger(minimumBytes) ||
    !Number.isSafeInteger(maximumSamples) ||
    maximumSamples < minimumSamples ||
    !Number.isSafeInteger(maximumBytes)
  )
    throw new Error("Mixed PCM expected sample count is invalid");
  const digest = createHash("sha256");
  let bytes = 0;
  let carry = Buffer.alloc(0);
  let peak = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array))
      throw new Error("Mixed PCM stream is not binary");
    bytes += chunk.byteLength;
    if (bytes > maximumBytes)
      throw new Error("PCM exceeds the explicit decoded duration budget");
    digest.update(chunk);
    const data = carry.length
      ? Buffer.concat([carry, chunk])
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const complete = data.length - (data.length % 4);
    for (let index = 0; index < complete; index += 4) {
      const value = data.readFloatLE(index);
      if (!Number.isFinite(value))
        throw new Error("Mixed PCM contains a non-finite sample");
      peak = Math.max(peak, Math.abs(value));
      if (rejectOverUnity && peak > 1) throw new AudioMixPeakError();
    }
    carry = Buffer.from(data.subarray(complete));
  }
  signal.throwIfAborted();
  if (bytes < minimumBytes || bytes % 8 || carry.length)
    throw new Error(
      "PCM is shorter than the required decoded duration or lacks a complete stereo frame",
    );
  return {
    samplesPerChannel: bytes / 8,
    channels: 2,
    peak,
    sha256: digest.digest("hex"),
  };
}
