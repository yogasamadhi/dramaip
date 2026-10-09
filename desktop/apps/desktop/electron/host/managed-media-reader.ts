import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  HostManagedMediaReadError,
  validManagedMediaReadInput,
  type HostManagedMediaReadInput,
} from "@dramaip/desktop-host";

const chunkSize = 256 * 1024;
type Lease = { abort: AbortController; done: Promise<void> };
/** Exact opaque managed files only; no caller paths, symlinks, session-map fallback or prefix previews. */
export class ManagedMediaReader {
  private readonly reads = new Set<Lease>();
  private disposed = false;
  constructor(private readonly root: string) {}
  async dispose() {
    this.disposed = true;
    const reads = [...this.reads];
    for (const read of reads) read.abort.abort();
    await Promise.all(reads.map((read) => read.done));
  }
  async read(
    input: HostManagedMediaReadInput,
    caller: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    if (!validManagedMediaReadInput(input))
      throw new HostManagedMediaReadError(415, "INVALID_MANAGED_MEDIA_READ");
    if (this.disposed || this.reads.size >= 8)
      throw new HostManagedMediaReadError(503, "MEDIA_READER_UNAVAILABLE");
    const abort = new AbortController();
    const signal = AbortSignal.any([
      caller,
      abort.signal,
      AbortSignal.timeout(5 * 60_000),
    ]);
    let finish!: () => void;
    const lease = {
      abort,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    this.reads.add(lease);
    let handle: FileHandle | undefined;
    let closing: Promise<void> | undefined;
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    const close = () =>
      (closing ??= (async () => {
        signal.removeEventListener("abort", interrupted);
        try {
          await handle?.close();
        } finally {
          this.reads.delete(lease);
          finish();
        }
      })());
    const interrupted = () => {
      if (sink) {
        try {
          sink.error(new Error("媒体读取已中断。"));
        } catch {}
        void close().catch(() => {});
      }
    };
    try {
      signal.throwIfAborted();
      const root = await lstat(this.root, { bigint: true });
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new HostManagedMediaReadError(404, "MANAGED_MEDIA_NOT_FOUND");
      handle = await open(
        join(
          this.root,
          `${input.mediaRef}${HOST_MANAGED_MEDIA_EXTENSIONS[input.mimeType]}`,
        ),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      signal.throwIfAborted();
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.nlink !== 1n ||
        before.size !== BigInt(input.sizeBytes)
      )
        throw new HostManagedMediaReadError(409, "MANAGED_MEDIA_CHANGED");
      const unchanged = async () => {
        const currentRoot = await lstat(this.root, { bigint: true });
        if (
          !currentRoot.isDirectory() ||
          currentRoot.isSymbolicLink() ||
          currentRoot.dev !== root.dev ||
          currentRoot.ino !== root.ino
        )
          return false;
        const after = await handle!.stat({ bigint: true });
        return ["size", "dev", "ino", "mtimeNs", "ctimeNs", "nlink"].every(
          (key) =>
            after[key as keyof typeof after] ===
            before[key as keyof typeof before],
        );
      };
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(chunkSize);
      for (let offset = 0; offset < input.sizeBytes;) {
        signal.throwIfAborted();
        const result = await handle.read(
          buffer,
          0,
          Math.min(chunkSize, input.sizeBytes - offset),
          offset,
        );
        if (!result.bytesRead)
          throw new HostManagedMediaReadError(409, "MANAGED_MEDIA_CHANGED");
        hash.update(buffer.subarray(0, result.bytesRead));
        offset += result.bytesRead;
      }
      if (hash.digest("hex") !== input.sha256 || !(await unchanged()))
        throw new HostManagedMediaReadError(409, "MANAGED_MEDIA_CHANGED");
      signal.throwIfAborted();
      let offset = 0;
      const delivered = createHash("sha256");
      signal.addEventListener("abort", interrupted, { once: true });
      return new ReadableStream<Uint8Array>({
        start(controller) {
          sink = controller;
          if (signal.aborted) interrupted();
        },
        async pull(controller) {
          try {
            signal.throwIfAborted();
            if (offset === input.sizeBytes) {
              if (
                delivered.digest("hex") !== input.sha256 ||
                !(await unchanged())
              )
                throw new Error("存档文件在读取期间变化。");
              signal.throwIfAborted();
              await close();
              controller.close();
              return;
            }
            const chunk = Buffer.alloc(
              Math.min(chunkSize, input.sizeBytes - offset),
            );
            const { bytesRead } = await handle!.read(
              chunk,
              0,
              chunk.length,
              offset,
            );
            signal.throwIfAborted();
            if (!bytesRead) throw new Error("存档文件在读取期间变化。");
            const bytes = chunk.subarray(0, bytesRead);
            delivered.update(bytes);
            offset += bytesRead;
            controller.enqueue(bytes);
          } catch {
            try {
              controller.error(new Error("存档文件读取未完成或已变化。"));
            } catch {}
            await close();
          }
        },
        cancel: () => {
          abort.abort();
          return close();
        },
      });
    } catch (cause) {
      await close();
      if (cause instanceof HostManagedMediaReadError) throw cause;
      throw new HostManagedMediaReadError(
        (cause as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 503,
        "MANAGED_MEDIA_READ_UNAVAILABLE",
      );
    }
  }
}
