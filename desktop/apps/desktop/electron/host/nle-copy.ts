import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rmdir,
  statfs,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  validNleCopyInput,
  type HostManagedMediaReadInput,
  type NleCopyInput,
  type NleCopyReceipt,
} from "@dramaip/desktop-host";

export type { NleCopyInput, NleCopyReceipt } from "@dramaip/desktop-host";
const chunkSize = 256 * 1024;
type Directory = { path: string; stat: BigIntStats };
type OwnedFile = { path: string; stat: BigIntStats };
type ReceiptFile = NleCopyReceipt["files"][number];
export class NleCopyError extends Error {
  readonly name = "NleCopyError";
  constructor(
    readonly code:
      | "INVALID_COPY_INPUT"
      | "COPY_ABORTED"
      | "COPY_UNAVAILABLE"
      | "COPY_SOURCE_OR_DESTINATION_CHANGED"
      | "COPY_DISK_SPACE_UNAVAILABLE",
    readonly scratchState:
      "not-created" | "cleaned" | "retained-unpublished" = "not-created",
  ) {
    super("媒体包复制未完成；没有新的交付通过证明。");
  }
}

type Reader = {
  read(
    input: HostManagedMediaReadInput,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
};
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function unchangedIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino;
}
async function checkDirectory(directory: Directory) {
  const actual = await lstat(directory.path, { bigint: true });
  if (
    !actual.isDirectory() ||
    actual.isSymbolicLink() ||
    !unchangedIdentity(actual, directory.stat)
  )
    throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
}
async function writeFully(handle: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new NleCopyError("COPY_UNAVAILABLE");
    offset += result.bytesWritten;
  }
}
async function verifyHandle(
  handle: FileHandle,
  path: string,
  expected: { sizeBytes: number; sha256: string },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const before = await handle.stat({ bigint: true });
  const name = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size !== BigInt(expected.sizeBytes) ||
    !name.isFile() ||
    name.isSymbolicLink() ||
    !unchangedIdentity(before, name)
  )
    throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(chunkSize);
  let offset = 0;
  while (offset < expected.sizeBytes) {
    signal.throwIfAborted();
    const chunk = await handle.read(
      buffer,
      0,
      Math.min(chunkSize, expected.sizeBytes - offset),
      offset,
    );
    if (chunk.bytesRead === 0)
      throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
    hash.update(buffer.subarray(0, chunk.bytesRead));
    offset += chunk.bytesRead;
  }
  if (
    (await handle.read(buffer, 0, 1, offset)).bytesRead !== 0 ||
    hash.digest("hex") !== expected.sha256
  )
    throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
  const after = await handle.stat({ bigint: true });
  const finalName = await lstat(path, { bigint: true });
  if (
    !unchangedIdentity(before, finalName) ||
    finalName.isSymbolicLink() ||
    ["size", "dev", "ino", "mtimeNs", "ctimeNs", "nlink"].some(
      (key) =>
        before[key as keyof BigIntStats] !== after[key as keyof BigIntStats],
    )
  )
    throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
  signal.throwIfAborted();
}
async function cleanupOwned(
  parent: Directory,
  directories: readonly Directory[],
  files: readonly OwnedFile[],
) {
  try {
    await checkDirectory(parent);
    for (const directory of directories) await checkDirectory(directory);
    for (const file of [...files].reverse()) {
      const actual = await lstat(file.path, { bigint: true }).catch(
        () => undefined,
      );
      if (
        actual &&
        (!actual.isFile() ||
          actual.isSymbolicLink() ||
          !unchangedIdentity(actual, file.stat))
      )
        return false;
      if (actual) await unlink(file.path);
    }
    for (const directory of [...directories].reverse())
      await rmdir(directory.path);
    return true;
  } catch {
    return false;
  }
}

/** Host-only copy kernel. The supervisor owns the explicit write grant and persistent original request.
 * This receipt proves the copy at recorded time, not current bytes, rights, quality or NLE import semantics.
 */
export async function copyNleMediaPackage(
  input: NleCopyInput,
  destinationRoot: string,
  reader: Reader,
  signal: AbortSignal,
  hooks: {
    availableBytes?: () => Promise<bigint>;
    afterFile?: (file: ReceiptFile, packageDirectory: string) => Promise<void>;
  } = {},
): Promise<{
  directory: string;
  receipt: NleCopyReceipt;
  receiptSha256: string;
  receiptBytes: number;
  binding: {
    root: string;
    rootDev: string;
    rootIno: string;
    directoryDev: string;
    directoryIno: string;
  };
}> {
  if (!validNleCopyInput(input)) throw new NleCopyError("INVALID_COPY_INPUT");
  // Freeze caller arrays/objects before the first await; later mutations cannot alter the selected copy.
  const frozen: NleCopyInput = JSON.parse(JSON.stringify(input));
  const ownedDirectories: Directory[] = [];
  const ownedFiles: OwnedFile[] = [];
  let parent: Directory | undefined;
  try {
    signal.throwIfAborted();
    parent = {
      path: destinationRoot,
      stat: await lstat(destinationRoot, { bigint: true }),
    };
    await checkDirectory(parent);
    const bytes =
      frozen.media.reduce((total, file) => total + BigInt(file.sizeBytes), 0n) +
      BigInt(
        frozen.documents.reduce(
          (total, file) => total + Buffer.byteLength(file.content, "utf8"),
          0,
        ),
      ) +
      16n * 1024n * 1024n;
    const available = hooks.availableBytes
      ? await hooks.availableBytes()
      : await statfs(destinationRoot, { bigint: true }).then(
          (fs) => fs.bavail * fs.bsize,
        );
    if (available < bytes)
      throw new NleCopyError("COPY_DISK_SPACE_UNAVAILABLE");
    signal.throwIfAborted();
    await checkDirectory(parent);
    const packageRef = randomUUID();
    const directory = await mkdtemp(
      join(destinationRoot, `DramaIP-NLE-${packageRef}-`),
    );
    ownedDirectories.push({
      path: directory,
      stat: await lstat(directory, { bigint: true }),
    });
    await checkDirectory(parent);
    const mediaDirectory = join(directory, "media");
    await mkdir(mediaDirectory, { mode: 0o700 });
    ownedDirectories.push({
      path: mediaDirectory,
      stat: await lstat(mediaDirectory, { bigint: true }),
    });
    const checkDirectories = async () => {
      await checkDirectory(parent!);
      for (const owned of ownedDirectories) await checkDirectory(owned);
      signal.throwIfAborted();
    };
    const files: ReceiptFile[] = [];
    const createFile = async (
      relativePath: string,
      source: ReadableStream<Uint8Array>,
      expected: ReceiptFile,
    ) => {
      let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let handle: FileHandle | undefined;
      try {
        await checkDirectories();
        const path = join(directory, relativePath);
        handle = await open(
          path,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        ownedFiles.push({ path, stat: await handle.stat({ bigint: true }) });
        stream = source.getReader();
        let count = 0;
        const hash = createHash("sha256");
        for (;;) {
          signal.throwIfAborted();
          const chunk = await stream.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          count += chunk.value.byteLength;
          if (count > expected.sizeBytes)
            throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
          hash.update(chunk.value);
          await writeFully(handle, chunk.value);
        }
        if (
          count !== expected.sizeBytes ||
          hash.digest("hex") !== expected.sha256
        )
          throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
        await handle.sync();
        await verifyHandle(handle, path, expected, signal);
        await checkDirectories();
      } finally {
        if (stream) {
          await stream.cancel().catch(() => {});
          stream.releaseLock();
        } else await source.cancel().catch(() => {});
        await handle?.close();
      }
    };
    const byteStream = (bytes: Uint8Array) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    for (const file of frozen.media) {
      await checkDirectories();
      const relativePath = `media/${file.assetId}${HOST_MANAGED_MEDIA_EXTENSIONS[file.mimeType]}`;
      const entry: ReceiptFile = {
        relativePath,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        kind: "media",
        source: {
          assetId: file.assetId,
          recordVersion: file.recordVersion,
          artifactId: file.artifactId,
        },
      };
      const source = await reader.read(
        {
          mediaRef: file.mediaRef,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        },
        signal,
      );
      await createFile(relativePath, source, entry);
      files.push(entry);
      await hooks.afterFile?.(entry, directory);
    }
    for (const file of frozen.documents) {
      const bytes = Buffer.from(file.content, "utf8");
      const entry: ReceiptFile = {
        relativePath: file.relativePath,
        sizeBytes: bytes.byteLength,
        sha256: digest(bytes),
        kind: "document",
      };
      await createFile(file.relativePath, byteStream(bytes), entry);
      files.push(entry);
      await hooks.afterFile?.(entry, directory);
    }
    // Re-read the entire destination set after all copies; earlier successes cannot hide later tampering.
    for (const file of files) {
      await checkDirectories();
      const path = join(directory, file.relativePath);
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        await verifyHandle(handle, path, file, signal);
      } finally {
        await handle.close();
      }
    }
    const receipt: NleCopyReceipt = {
      format: "dramaip-nle-media-copy-receipt",
      schemaVersion: 1,
      packageRef,
      projectId: frozen.projectId,
      episodeId: frozen.episodeId,
      timelineId: frozen.timelineId,
      timelineVersion: frozen.timelineVersion,
      sourceFingerprint: frozen.sourceFingerprint,
      verifiedAt: new Date().toISOString(),
      evidence: "complete-copy-and-destination-re-read-at-recorded-time",
      qualityState: "unverified",
      rightsState: "unverified",
      billingState: "unknown",
      files: files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, "en"),
      ),
    };
    const receiptContent = Buffer.from(
      JSON.stringify(receipt, null, 2),
      "utf8",
    );
    const receiptSha256 = digest(receiptContent);
    await createFile("copied-media.json", byteStream(receiptContent), {
      relativePath: "copied-media.json",
      sizeBytes: receiptContent.byteLength,
      sha256: receiptSha256,
      kind: "document",
    });
    await checkDirectories();
    const rootNames = (await readdir(directory)).sort();
    const expectedRootNames = [
      ...frozen.documents.map((file) => file.relativePath),
      "media",
      "copied-media.json",
    ].sort();
    const actualMediaNames = (await readdir(mediaDirectory)).sort();
    const expectedMediaNames = frozen.media
      .map(
        (file) =>
          `${file.assetId}${HOST_MANAGED_MEDIA_EXTENSIONS[file.mimeType]}`,
      )
      .sort();
    if (
      JSON.stringify(rootNames) !== JSON.stringify(expectedRootNames) ||
      JSON.stringify(actualMediaNames) !== JSON.stringify(expectedMediaNames)
    )
      throw new NleCopyError("COPY_SOURCE_OR_DESTINATION_CHANGED");
    await checkDirectories();
    return {
      directory,
      receipt,
      receiptSha256,
      receiptBytes: receiptContent.byteLength,
      binding: {
        root: destinationRoot,
        rootDev: String(parent.stat.dev),
        rootIno: String(parent.stat.ino),
        directoryDev: String(ownedDirectories[0]!.stat.dev),
        directoryIno: String(ownedDirectories[0]!.stat.ino),
      },
    };
  } catch (cause) {
    const cleaned =
      ownedDirectories.length > 0 && parent
        ? await cleanupOwned(parent, ownedDirectories, ownedFiles)
        : true;
    throw new NleCopyError(
      signal.aborted
        ? "COPY_ABORTED"
        : cause instanceof NleCopyError
          ? cause.code
          : "COPY_UNAVAILABLE",
      ownedDirectories.length === 0
        ? "not-created"
        : cleaned
          ? "cleaned"
          : "retained-unpublished",
    );
  }
}
