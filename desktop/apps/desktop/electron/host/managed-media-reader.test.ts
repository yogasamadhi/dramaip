import { afterEach, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  symlink,
  link,
  truncate,
  open,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedMediaReader } from "./managed-media-reader";
const directories: string[] = [];
const readers: ManagedMediaReader[] = [];
afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.dispose();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture(bytes = Buffer.alloc(768 * 1024 + 17, 7)) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-managed-reader-"));
  directories.push(root);
  const input = {
    mediaRef: randomUUID(),
    mimeType: "audio/wav",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const file = join(root, `${input.mediaRef}.wav`);
  await writeFile(file, bytes, { mode: 0o600 });
  const reader = new ManagedMediaReader(root);
  readers.push(reader);
  return { reader, input, root, file, bytes };
}
test("完整受控存档读取可跨 Reader 重建，不修改文件且不依赖会话映射", async () => {
  const f = await fixture();
  const stream = await f.reader.read(f.input, new AbortController().signal);
  expect(Buffer.from(await new Response(stream).arrayBuffer())).toEqual(
    f.bytes,
  );
  await f.reader.dispose();
  const restarted = new ManagedMediaReader(f.root);
  readers.push(restarted);
  expect(
    Buffer.from(
      await new Response(
        await restarted.read(f.input, new AbortController().signal),
      ).arrayBuffer(),
    ),
  ).toEqual(f.bytes);
  expect(await readFile(f.file)).toEqual(f.bytes);
});
test("路径注入、未知 MIME、错误全文件哈希／大小与缺失文件都安全拒绝", async () => {
  const f = await fixture();
  for (const patch of [
    { mediaRef: "../secret" },
    { mimeType: "text/html" },
    { sizeBytes: 0 },
    { sizeBytes: 2 ** 31 + 1 },
    { sha256: "a".repeat(64) },
    { sizeBytes: f.input.sizeBytes - 1 },
    { mediaRef: randomUUID() },
  ]) {
    const error = await f.reader
      .read({ ...f.input, ...patch }, new AbortController().signal)
      .catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(f.root);
  }
});
test("拒绝文件和根目录符号链接及硬链接，不允许越出受控根", async () => {
  const f = await fixture();
  const alternate = randomUUID();
  await symlink(f.file, join(f.root, `${alternate}.wav`));
  await expect(
    f.reader.read(
      { ...f.input, mediaRef: alternate },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  const hard = randomUUID();
  await link(f.file, join(f.root, `${hard}.wav`));
  await expect(
    f.reader.read({ ...f.input, mediaRef: hard }, new AbortController().signal),
  ).rejects.toThrow();
  const outer = await mkdtemp(join(tmpdir(), "dramaip-managed-root-"));
  directories.push(outer);
  await symlink(f.root, join(outer, "linked"));
  const reader = new ManagedMediaReader(join(outer, "linked"));
  readers.push(reader);
  await expect(
    reader.read(f.input, new AbortController().signal),
  ).rejects.toThrow();
});
test("流中截断或等长篡改不会产生完整成功 EOF", async () => {
  for (const mutation of ["truncate", "same-size"]) {
    const f = await fixture();
    const stream = await f.reader.read(f.input, new AbortController().signal);
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);
    if (mutation === "truncate") await truncate(f.file, 16);
    else {
      const handle = await open(f.file, "r+");
      await handle.write(Buffer.from([8]), 0, 1, f.bytes.length - 1);
      await handle.close();
    }
    await expect(
      (async () => {
        while (!(await reader.read()).done) {}
      })(),
    ).rejects.toThrow("读取未完成或已变化");
  }
});
test("调用方取消、Reader 停用与并发上限都释放读句柄，不删除文件", async () => {
  const f = await fixture();
  const abort = new AbortController();
  const stream = await f.reader.read(f.input, abort.signal);
  const reader = stream.getReader();
  await reader.read();
  abort.abort();
  await expect(reader.read()).rejects.toThrow();
  await f.reader.dispose();
  const concurrent = await fixture();
  const streams = await Promise.all(
    Array.from({ length: 8 }, () =>
      concurrent.reader.read(concurrent.input, new AbortController().signal),
    ),
  );
  await expect(
    concurrent.reader.read(concurrent.input, new AbortController().signal),
  ).rejects.toThrow();
  await Promise.all(streams.map((stream) => stream.cancel()));
  const active = await concurrent.reader.read(
    concurrent.input,
    new AbortController().signal,
  );
  await concurrent.reader.dispose();
  await expect(new Response(active).arrayBuffer()).rejects.toThrow();
  await expect(
    f.reader.read(f.input, new AbortController().signal),
  ).rejects.toThrow();
  expect(await readFile(f.file)).toEqual(f.bytes);
});
