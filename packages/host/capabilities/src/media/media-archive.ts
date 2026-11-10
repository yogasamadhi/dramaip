import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { safeHttpRequest } from "./safe-http-transport";

export interface MediaProbeResult {
  kind: "video";
  mimeType: "video/mp4";
  extension: ".mp4";
  width: number;
  height: number;
  durationFrames: number;
  frameRate: { numerator: number; denominator: number; dropFrame: boolean };
}

export interface ArchivedRemoteMedia {
  mediaRef: string;
  kind: "video";
  mimeType: "video/mp4";
  extension: ".mp4";
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  durationFrames: number;
  frameRate: { numerator: number; denominator: number; dropFrame: boolean };
  status: "archived";
}

export interface MediaArchiveDependencies {
  root: string;
  probe(path: string): Promise<MediaProbeResult>;
  request?: typeof safeHttpRequest;
  createMediaRef?: () => string;
}

export async function archiveRemoteVideo(
  input: {
    url: string;
    authorization: string;
    maximumBytes: number;
    timeoutMs: number;
    expectedSha256?: string;
  },
  dependencies: MediaArchiveDependencies,
): Promise<ArchivedRemoteMedia> {
  if (
    !Number.isInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.maximumBytes > 2 * 1024 * 1024 * 1024
  )
    throw new Error("Media archive size limit is invalid");
  if (input.expectedSha256 && !/^[a-f0-9]{64}$/u.test(input.expectedSha256))
    throw new Error("Media archive checksum is invalid");

  await mkdir(dependencies.root, { recursive: true, mode: 0o700 });
  const capacity = await statfs(dependencies.root);
  const availableBytes = Number(capacity.bavail) * Number(capacity.bsize);
  if (availableBytes < input.maximumBytes + 64 * 1024 * 1024)
    throw new Error("Media archive does not have enough free disk space");

  const mediaRef = (dependencies.createMediaRef ?? randomUUID)();
  const temporary = join(dependencies.root, `.${mediaRef}.download`);
  const target = join(dependencies.root, `${mediaRef}.mp4`);
  const digest = createHash("sha256");
  let signature = Buffer.alloc(0);
  const handle = await open(temporary, "wx", 0o600);
  try {
    const response = await (dependencies.request ?? safeHttpRequest)({
      url: input.url,
      method: "GET",
      accept: "binary",
      maximumBytes: input.maximumBytes,
      timeoutMs: input.timeoutMs,
      authorization: input.authorization,
      onChunk: async (chunk) => {
        if (signature.byteLength < 16)
          signature = Buffer.concat([signature, chunk]).subarray(0, 16);
        digest.update(chunk);
        await handle.write(chunk);
      },
    });
    await handle.sync();
    await handle.close();
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Media archive download returned ${response.status}`);
    if (!response.contentType.toLowerCase().startsWith("video/"))
      throw new Error("Media archive response is not a video MIME type");
    if (
      signature.byteLength < 12 ||
      signature.subarray(4, 8).toString("ascii") !== "ftyp"
    )
      throw new Error("Media archive payload is not an ISO BMFF/MP4 file");
    const sha256 = digest.digest("hex");
    if (input.expectedSha256 && sha256 !== input.expectedSha256)
      throw new Error("Media archive checksum mismatch");
    const probe = await dependencies.probe(temporary);
    if (
      probe.kind !== "video" ||
      probe.mimeType !== "video/mp4" ||
      probe.extension !== ".mp4" ||
      !Number.isInteger(probe.width) ||
      probe.width < 1 ||
      !Number.isInteger(probe.height) ||
      probe.height < 1 ||
      !Number.isInteger(probe.durationFrames) ||
      probe.durationFrames < 1 ||
      !Number.isInteger(probe.frameRate.numerator) ||
      probe.frameRate.numerator < 1 ||
      !Number.isInteger(probe.frameRate.denominator) ||
      probe.frameRate.denominator < 1
    )
      throw new Error("Media archive probe returned invalid metadata");
    await rename(temporary, target);
    return {
      mediaRef,
      kind: "video",
      mimeType: "video/mp4",
      extension: ".mp4",
      sizeBytes: response.sizeBytes,
      sha256,
      width: probe.width,
      height: probe.height,
      durationFrames: probe.durationFrames,
      frameRate: probe.frameRate,
      status: "archived",
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
