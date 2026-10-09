import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagedMediaReader } from "./managed-media-reader.js";
import {
  copyNleMediaPackage,
  NleCopyError,
  type NleCopyInput,
} from "./nle-copy.js";

import { validNleCopyInput } from "@dramaip/desktop-host";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-nle-copy-test-"));
  const archive = join(root, "archive"),
    output = join(root, "output");
  await mkdir(archive);
  await mkdir(output);
  const reader = new ManagedMediaReader(archive);
  t.after(async () => {
    await reader.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const original = Buffer.from(
    "controlled exact source, not decoded media or quality proof",
  );
  const media = {
    assetId: randomUUID(),
    recordVersion: 4,
    artifactId: randomUUID(),
    mediaRef: randomUUID(),
    sha256: hash(original),
    sizeBytes: original.byteLength,
    mimeType: "audio/wav",
  };
  await writeFile(join(archive, `${media.mediaRef}.wav`), original);
  const input: NleCopyInput = {
    projectId: randomUUID(),
    episodeId: randomUUID(),
    timelineId: randomUUID(),
    timelineVersion: 9,
    sourceFingerprint: "c".repeat(64),
    media: [media],
    documents: [
      {
        relativePath: "timeline-manifest.json",
        content: '{"source":"frozen fixture only"}',
      },
      {
        relativePath: "subtitles.srt",
        content: "1\n00:00:00,000 --> 00:00:01,000\n原字幕\n",
      },
    ],
  };
  return { root, archive, output, reader, original, media, input };
}
async function failure(
  work: Promise<unknown>,
  code?: NleCopyError["code"],
  scratch?: NleCopyError["scratchState"],
) {
  await assert.rejects(work, (error: unknown) => {
    assert(error instanceof NleCopyError);
    if (code) assert.equal(error.code, code);
    if (scratch) assert.equal(error.scratchState, scratch);
    assert(!String(error).includes("PRIVATE"));
    return true;
  });
}
const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

test("Host copy validates exact original scope, media identity, byte quotas and a fixed path whitelist before touching any destination", async (t) => {
  const f = await fixture(t);
  assert.equal(validNleCopyInput(f.input), true);
  for (const input of [
    null,
    { ...f.input, path: "/PRIVATE/root" },
    { ...f.input, projectId: "invalid" },
    { ...f.input, timelineVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...f.input, media: [] },
    { ...f.input, media: [f.media, f.media] },
    { ...f.input, media: [{ ...f.media, path: "/PRIVATE/file.wav" }] },
    { ...f.input, media: [{ ...f.media, recordVersion: -1 }] },
    { ...f.input, media: [{ ...f.media, mediaRef: "../PRIVATE" }] },
    { ...f.input, media: [{ ...f.media, sizeBytes: 2 * 1024 ** 3 + 1 }] },
    { ...f.input, media: [{ ...f.media, mimeType: "application/javascript" }] },
    { ...f.input, media: [{ ...f.media, sha256: "wrong" }] },
    {
      ...f.input,
      media: Array.from({ length: 1001 }, () => ({
        ...f.media,
        assetId: randomUUID(),
      })),
    },
    {
      ...f.input,
      media: Array.from({ length: 5 }, () => ({
        ...f.media,
        assetId: randomUUID(),
        sizeBytes: 2 * 1024 ** 3,
      })),
    },
    {
      ...f.input,
      documents: [{ relativePath: "../timeline.otio", content: "" }],
    },
    {
      ...f.input,
      documents: [{ relativePath: "/PRIVATE/subtitles.srt", content: "" }],
    },
    { ...f.input, documents: [{ relativePath: "CON", content: "" }] },
    { ...f.input, documents: [f.input.documents[0], f.input.documents[0]] },
    {
      ...f.input,
      documents: [
        {
          relativePath: "relink.json",
          content: "a".repeat(16 * 1024 ** 2 + 1),
        },
      ],
    },
  ]) {
    assert.equal(validNleCopyInput(input), false);
    await failure(
      copyNleMediaPackage(input as NleCopyInput, f.output, f.reader, signal()),
      "INVALID_COPY_INPUT",
      "not-created",
    );
  }
  assert.deepEqual(await readdir(f.output), []);
});
test("Host copy performs an actual exact complete media copy and destination reread, with UTF-8 document checksums and separate historical receipt", async (t) => {
  const f = await fixture(t),
    before = JSON.stringify(f.input);
  const result = await copyNleMediaPackage(
    f.input,
    f.output,
    f.reader,
    signal(),
  );
  assert.equal(JSON.stringify(f.input), before);
  const receiptBytes = await readFile(
    join(result.directory, "copied-media.json"),
  );
  assert.deepEqual(JSON.parse(receiptBytes.toString()), result.receipt);
  assert.equal(hash(receiptBytes), result.receiptSha256);
  assert.equal(receiptBytes.byteLength, result.receiptBytes);
  const copy = result.receipt.files.find((file) => file.kind === "media")!;
  assert.deepEqual(
    await readFile(join(result.directory, copy.relativePath)),
    f.original,
  );
  for (const file of result.receipt.files) {
    const bytes = await readFile(join(result.directory, file.relativePath));
    assert.equal(bytes.byteLength, file.sizeBytes);
    assert.equal(hash(bytes), file.sha256);
  }
  assert.deepEqual(copy.source, {
    assetId: f.media.assetId,
    recordVersion: 4,
    artifactId: f.media.artifactId,
  });
  assert.equal(result.receipt.sourceFingerprint, f.input.sourceFingerprint);
  assert.equal(result.receipt.timelineVersion, 9);
  assert.equal(result.receipt.qualityState, "unverified");
  assert.equal(result.receipt.rightsState, "unverified");
  assert.equal(result.receipt.billingState, "unknown");
  assert(!receiptBytes.includes(Buffer.from(f.media.mediaRef)));
  assert(!receiptBytes.includes(Buffer.from(f.root)));
  assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(join(result.directory, copy.relativePath))).mode & 0o777,
    0o600,
  );
});
test("Host copy never overwrites existing destination contents; repeated raw kernel copies have distinct private output identities", async (t) => {
  const f = await fixture(t);
  const userFile = join(f.output, "timeline-manifest.json");
  await writeFile(userFile, "pre-existing user file");
  const first = await copyNleMediaPackage(
    f.input,
    f.output,
    f.reader,
    signal(),
  );
  const second = await copyNleMediaPackage(
    f.input,
    f.output,
    f.reader,
    signal(),
  );
  assert.notEqual(first.directory, second.directory);
  assert.notEqual(first.receipt.packageRef, second.receipt.packageRef);
  assert.equal(await readFile(userFile, "utf8"), "pre-existing user file");
  assert.equal((await readdir(f.output)).length, 3);
  // Persistent original-key coordination is still required above this kernel; raw copies are not idempotency acceptance.
});
for (const change of ["hash", "truncated", "extra"] as const) {
  test(`Host copy refuses ${change} stream bytes and cleans only its exclusive output; no receipt survives`, async (t) => {
    const f = await fixture(t);
    const bytes =
      change === "hash"
        ? Buffer.alloc(f.original.byteLength)
        : change === "truncated"
          ? f.original.subarray(0, -1)
          : Buffer.concat([f.original, Buffer.from("x")]);
    await failure(
      copyNleMediaPackage(
        f.input,
        f.output,
        { read: async () => stream(bytes) },
        signal(),
      ),
      "COPY_SOURCE_OR_DESTINATION_CHANGED",
      "cleaned",
    );
    assert.deepEqual(await readdir(f.output), []);
    assert.deepEqual(
      await readFile(join(f.archive, `${f.media.mediaRef}.wav`)),
      f.original,
    );
  });
}
test("Host copy sanitizes an underlying failure with a private path and leaves no false receipt or leaked source handles", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(
      f.input,
      f.output,
      {
        read: async () => {
          throw new Error("PRIVATE /absolute/secret/source.wav");
        },
      },
      signal(),
    ),
    "COPY_UNAVAILABLE",
    "cleaned",
  );
  assert.deepEqual(await readdir(f.output), []);
});
test("Host copy uses the real managed reader and refuses equal-length archive tampering before copying", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.archive, `${f.media.mediaRef}.wav`),
    Buffer.alloc(f.original.byteLength),
  );
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal()),
    "COPY_UNAVAILABLE",
    "cleaned",
  );
  assert.deepEqual(await readdir(f.output), []);
});
test("Host copy rereads the entire destination set so an earlier verified file cannot hide later equal-length tampering", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
      afterFile: async (file, directory) => {
        if (file.kind === "media")
          await writeFile(
            join(directory, file.relativePath),
            Buffer.alloc(file.sizeBytes),
          );
      },
    }),
    "COPY_SOURCE_OR_DESTINATION_CHANGED",
    "cleaned",
  );
  assert.deepEqual(await readdir(f.output), []);
});
for (const replacement of ["symlink", "hardlink"] as const) {
  test(`Host copy refuses a destination ${replacement}, preserves the outside user target and retains replaced staging rather than deleting it`, async (t) => {
    const f = await fixture(t),
      target = join(f.root, "outside-user-file");
    await writeFile(target, f.original);
    await failure(
      copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
        afterFile: async (file, directory) => {
          if (file.kind !== "media") return;
          const path = join(directory, file.relativePath);
          await unlink(path);
          if (replacement === "symlink") await symlink(target, path);
          else await link(target, path);
        },
      }),
      undefined,
      "retained-unpublished",
    );
    assert.deepEqual(await readFile(target), f.original);
    const directories = await readdir(f.output);
    assert.equal(directories.length, 1);
    assert(
      !(await readdir(join(f.output, directories[0]!))).includes(
        "copied-media.json",
      ),
    );
  });
}
test("Host copy rejects a symlink destination root without copying or changing files in its target", async (t) => {
  const f = await fixture(t),
    alias = join(f.root, "output-link");
  await symlink(f.output, alias);
  await failure(
    copyNleMediaPackage(f.input, alias, f.reader, signal()),
    "COPY_SOURCE_OR_DESTINATION_CHANGED",
    "not-created",
  );
  assert.deepEqual(await readdir(f.output), []);
});
test("Host copy rejects a replaced media directory and will not recursively remove an unknown replacement", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
      afterFile: async (file, directory) => {
        if (file.kind !== "media") return;
        await rename(
          join(directory, "media"),
          join(f.root, "moved-owned-media"),
        );
        await mkdir(join(directory, "media"));
        await writeFile(
          join(directory, "media", "user-added-file"),
          "do not delete",
        );
      },
    }),
    "COPY_SOURCE_OR_DESTINATION_CHANGED",
    "retained-unpublished",
  );
  const name = (await readdir(f.output))[0]!;
  assert.equal(
    await readFile(join(f.output, name, "media", "user-added-file"), "utf8"),
    "do not delete",
  );
});
test("Host copy cancellation before work creates nothing; cancellation after a real file releases the reader and cleans the partial output", async (t) => {
  const f = await fixture(t),
    before = new AbortController();
  before.abort();
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, before.signal),
    "COPY_ABORTED",
    "not-created",
  );
  const midway = new AbortController();
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, midway.signal, {
      afterFile: async () => {
        midway.abort();
      },
    }),
    "COPY_ABORTED",
    "cleaned",
  );
  assert.deepEqual(await readdir(f.output), []);
  // A fresh exact read after cancellation proves the fixture reader remains available; no disposed/latest fallback.
  const body = await f.reader.read(f.media, signal());
  assert.deepEqual(
    Buffer.from(await new Response(body).arrayBuffer()),
    f.original,
  );
});
test("Host copy freezes the original arrays and document bytes before awaits; caller mutation cannot switch the asset or file contents", async (t) => {
  const f = await fixture(t);
  let release!: () => void, accepted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const work = copyNleMediaPackage(
    f.input,
    f.output,
    {
      read: async (input, readSignal) => {
        accepted();
        await gate;
        return f.reader.read(input, readSignal);
      },
    },
    signal(),
  );
  await ready;
  const originalAsset = f.media.assetId;
  f.media.assetId = randomUUID();
  f.input.documents[0]!.content = "PRIVATE replaced caller bytes";
  release();
  const result = await work;
  assert(
    result.receipt.files.some((file) => file.source?.assetId === originalAsset),
  );
  assert.equal(
    await readFile(join(result.directory, "timeline-manifest.json"), "utf8"),
    '{"source":"frozen fixture only"}',
  );
});
test("Host copy rejects insufficient reported disk space before creating output and does not turn disk failures into saved packages", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
      availableBytes: async () => 0n,
    }),
    "COPY_DISK_SPACE_UNAVAILABLE",
    "not-created",
  );
  assert.deepEqual(await readdir(f.output), []);
});
test("Host copy rejects unexpected user-added files in staging without deleting them or leaving a success sidecar", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
      afterFile: async (file, directory) => {
        if (file.kind === "media")
          await writeFile(join(directory, "user-added-file"), "preserve this");
      },
    }),
    "COPY_SOURCE_OR_DESTINATION_CHANGED",
    "retained-unpublished",
  );
  const name = (await readdir(f.output))[0]!;
  assert.equal(
    await readFile(join(f.output, name, "user-added-file"), "utf8"),
    "preserve this",
  );
  assert(!(await readdir(join(f.output, name))).includes("copied-media.json"));
});
test(
  "Host copy actually streams and verifies a 129 MiB source beyond the existing Blob/save-binary limits without buffering the whole media",
  { timeout: 120_000 },
  async (t) => {
    const f = await fixture(t),
      chunk = Buffer.alloc(1024 * 1024, 71),
      hashState = createHash("sha256");
    const handle = await open(join(f.archive, `${f.media.mediaRef}.wav`), "w");
    try {
      for (let index = 0; index < 129; index++) {
        await handle.write(chunk);
        hashState.update(chunk);
      }
    } finally {
      await handle.close();
    }
    f.media.sizeBytes = 129 * 1024 * 1024;
    f.media.sha256 = hashState.digest("hex");
    const result = await copyNleMediaPackage(
      f.input,
      f.output,
      f.reader,
      signal(),
    );
    const actual = result.receipt.files.find((file) => file.kind === "media")!;
    assert.equal(actual.sizeBytes, 129 * 1024 * 1024);
    assert.equal(
      (await stat(join(result.directory, actual.relativePath))).size,
      actual.sizeBytes,
    );
    assert.equal(actual.sha256, f.media.sha256);
    assert.equal(
      result.receipt.evidence,
      "complete-copy-and-destination-re-read-at-recorded-time",
    );
    assert.equal(result.receipt.qualityState, "unverified");
  },
);

test("Host copy copies a real 32-file mixed-kind set and every whitelisted NLE document using unique relative asset paths", async (t) => {
  const f = await fixture(t);
  const extensions = [
    ["audio/wav", ".wav"],
    ["image/png", ".png"],
    ["video/mp4", ".mp4"],
  ] as const;
  const media = [];
  for (let index = 0; index < 32; index++) {
    const [mimeType, extension] = extensions[index % extensions.length]!;
    const bytes = Buffer.from(
      `controlled source ${index}; only byte-copy proof, not decoded ${mimeType}`,
    );
    const entry = {
      assetId: randomUUID(),
      recordVersion: index,
      artifactId: randomUUID(),
      mediaRef: randomUUID(),
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256: hash(bytes),
    };
    await writeFile(join(f.archive, `${entry.mediaRef}${extension}`), bytes);
    media.push(entry);
  }
  const documents = [
    "timeline.fcpxml",
    "timeline.otio",
    "timeline.edl",
    "subtitles.srt",
    "subtitles.vtt",
    "relink.json",
    "timeline-manifest.json",
  ].map((relativePath) => ({
    relativePath,
    content: `original controlled ${relativePath}\n原内容`,
  }));
  const result = await copyNleMediaPackage(
    { ...f.input, media, documents },
    f.output,
    f.reader,
    signal(),
  );
  assert.equal(result.receipt.files.length, 39);
  assert.equal(
    new Set(result.receipt.files.map((file) => file.relativePath)).size,
    39,
  );
  for (const file of result.receipt.files) {
    const bytes = await readFile(join(result.directory, file.relativePath));
    assert.equal(bytes.byteLength, file.sizeBytes);
    assert.equal(hash(bytes), file.sha256);
    if (file.source)
      assert(
        media.some(
          (entry) =>
            entry.assetId === file.source!.assetId &&
            entry.recordVersion === file.source!.recordVersion &&
            entry.artifactId === file.source!.artifactId,
        ),
      );
  }
  assert.equal((await readdir(join(result.directory, "media"))).length, 32);
  assert.equal(result.receipt.rightsState, "unverified");
});

test("Host copy cancellation during a native managed byte stream closes the actual reader and removes the partial destination", async (t) => {
  const f = await fixture(t),
    controller = new AbortController(),
    bytes = Buffer.alloc(600 * 1024, 19);
  f.media.sizeBytes = bytes.byteLength;
  f.media.sha256 = hash(bytes);
  await writeFile(join(f.archive, `${f.media.mediaRef}.wav`), bytes);
  let reads = 0;
  await failure(
    copyNleMediaPackage(
      f.input,
      f.output,
      {
        read: async (input, readSignal) => {
          const original = (await f.reader.read(input, readSignal)).getReader();
          const close = async () => {
            await original.cancel().catch(() => {});
            original.releaseLock();
          };
          return new ReadableStream<Uint8Array>(
            {
              async pull(sink) {
                try {
                  const chunk = await original.read();
                  reads++;
                  if (reads === 2) controller.abort();
                  if (chunk.done) {
                    sink.close();
                    await close();
                  } else sink.enqueue(chunk.value);
                } catch (cause) {
                  sink.error(cause);
                  await close();
                }
              },
              cancel: close,
            },
            { highWaterMark: 0 },
          );
        },
      },
      controller.signal,
    ),
    "COPY_ABORTED",
    "cleaned",
  );
  assert.equal(reads, 2);
  assert.deepEqual(await readdir(f.output), []);
  const original = await f.reader.read(f.media, signal());
  assert.equal(
    (await new Response(original).arrayBuffer()).byteLength,
    bytes.byteLength,
  );
});

test("Host copy real exclusive-open collision preserves a newly inserted user file and cannot publish a successful copy receipt", async (t) => {
  const f = await fixture(t);
  await failure(
    copyNleMediaPackage(f.input, f.output, f.reader, signal(), {
      afterFile: async (file, directory) => {
        if (file.kind === "media")
          await writeFile(
            join(directory, "timeline-manifest.json"),
            "user file inserted before exclusive open",
          );
      },
    }),
    "COPY_UNAVAILABLE",
    "retained-unpublished",
  );
  const name = (await readdir(f.output))[0]!;
  assert.equal(
    await readFile(join(f.output, name, "timeline-manifest.json"), "utf8"),
    "user file inserted before exclusive open",
  );
  assert(!(await readdir(join(f.output, name))).includes("copied-media.json"));
});
