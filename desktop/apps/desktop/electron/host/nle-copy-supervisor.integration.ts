import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  createDesktopHost,
  DesktopHostClient,
  type DesktopHostActions,
} from "@dramaip/desktop-host";
import { ManagedMediaReader } from "./managed-media-reader.js";
import { copyNleMediaPackage, type NleCopyInput } from "./nle-copy.js";
import {
  NleCopySupervisor,
  NleCopyJobError,
  type NleCopyJob,
} from "./nle-copy-supervisor.js";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
type Options = ConstructorParameters<typeof NleCopySupervisor>[0];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(work: () => Promise<boolean>) {
  const end = Date.now() + 5000;
  while (!(await work())) {
    assert(Date.now() < end, "bounded actual job wait expired");
    await new Promise((done) => setTimeout(done, 5));
  }
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-nle-journal-test-"));
  const archive = join(root, "archive"),
    output = join(root, "output"),
    journal = join(root, "journal");
  await mkdir(archive, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const reader = new ManagedMediaReader(archive),
    supervisors: NleCopySupervisor[] = [];
  t.after(async () => {
    await Promise.all(supervisors.map((item) => item.dispose()));
    await reader.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const bytes = Buffer.from(
    "PRIVATE actual frozen source, not NLE decoding or quality evidence",
  );
  const media = {
    assetId: randomUUID(),
    recordVersion: 3,
    artifactId: randomUUID(),
    mediaRef: randomUUID(),
    sizeBytes: bytes.byteLength,
    sha256: hash(bytes),
    mimeType: "audio/wav",
  };
  await writeFile(join(archive, `${media.mediaRef}.wav`), bytes, {
    mode: 0o600,
  });
  const input: NleCopyInput = {
    projectId: randomUUID(),
    episodeId: randomUUID(),
    timelineId: randomUUID(),
    timelineVersion: 8,
    sourceFingerprint: "c".repeat(64),
    media: [media],
    documents: [
      {
        relativePath: "timeline-manifest.json",
        content: '{"PRIVATE":"original exact document"}',
      },
      {
        relativePath: "subtitles.srt",
        content: "1\n00:00:00,000 --> 00:00:01,000\n原字幕\n",
      },
    ],
  };
  const id = randomUUID(),
    grantRef = randomUUID();
  const counters = { reads: 0, grants: 0, copies: 0 };
  const options: Options = {
    journalRoot: journal,
    hostGeneration: 4,
    reader: {
      read: async (value, signal) => {
        counters.reads++;
        return reader.read(value, signal);
      },
    },
    resolveWriteGrant: async (ref) => {
      counters.grants++;
      return ref === grantRef
        ? {
            path: output,
            permission: "write-directory",
            generation: 4,
            expiresAt: Date.now() + 60_000,
          }
        : undefined;
    },
    copy: async (...args) => {
      counters.copies++;
      return copyNleMediaPackage(...args);
    },
  };
  const create = (patch: Partial<Options> = {}) => {
    const item = new NleCopySupervisor({ ...options, ...patch });
    supervisors.push(item);
    return item;
  };
  const journalFile = join(journal, `${id}.json`);
  return {
    root,
    archive,
    output,
    journal,
    journalFile,
    reader,
    bytes,
    media,
    input,
    id,
    grantRef,
    counters,
    options,
    create,
  };
}
async function terminal(
  supervisor: NleCopySupervisor,
  id: string,
  project: string,
) {
  let job: NleCopyJob | undefined;
  await until(async () => {
    job = await supervisor.get(id, project);
    return !!job && !["queued", "running"].includes(job.status);
  });
  return job!;
}
async function rejected(work: Promise<unknown>, code: NleCopyJobError["code"]) {
  await assert.rejects(work, (cause: unknown) => {
    assert(cause instanceof NleCopyJobError);
    assert.equal(cause.code, code);
    assert(!String(cause).includes("PRIVATE"));
    return true;
  });
}

test("actual reply-loss recovery publishes only journaled full copy; completed GET is historical and contains no private references", async (t) => {
  const f = await fixture(t),
    s = f.create();
  const accepted = await s.start(f.id, f.input, f.grantRef);
  assert.equal(accepted.status, "queued");
  assert.equal(accepted.version, 0);
  assert.equal(accepted.copy, undefined);
  // Discard the start reply; only the original GET identifies this job.
  const done = await terminal(s, f.id, f.input.projectId);
  assert.equal(done.status, "completed");
  assert.equal(done.version, 2);
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
  const publicText = JSON.stringify(done);
  for (const privateValue of [f.root, f.media.mediaRef, f.grantRef, "PRIVATE"])
    assert(!publicText.includes(privateValue));
  assert.equal(done.copy!.receipt.qualityState, "unverified");
  assert.equal(done.copy!.receipt.rightsState, "unverified");
  assert.equal(done.copy!.receipt.billingState, "unknown");
  const directories = await readdir(f.output);
  assert.equal(directories.length, 1);
  const copied = join(
    f.output,
    directories[0],
    "media",
    `${f.media.assetId}.wav`,
  );
  assert.deepEqual(await readFile(copied), f.bytes);
  assert.equal(
    hash(await readFile(join(f.output, directories[0], "copied-media.json"))),
    done.copy!.receiptSha256,
  );
  // Later equal-size changes do not rewrite or upgrade the historical receipt.
  await writeFile(copied, Buffer.alloc(f.bytes.length, 0x21));
  await writeFile(
    join(f.archive, `${f.media.mediaRef}.wav`),
    Buffer.alloc(f.bytes.length, 0x22),
  );
  assert.deepEqual(await s.get(f.id, f.input.projectId), done);
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
});

test("same original request concurrently coalesces exactly one copy and replays after restart without a current grant", async (t) => {
  const f = await fixture(t),
    s = f.create();
  const [a, b] = await Promise.all([
    s.start(f.id, f.input, f.grantRef),
    s.start(f.id, structuredClone(f.input), f.grantRef),
  ]);
  assert.deepEqual(a, b);
  a.scope.timelineVersion = 999;
  assert.equal(b.scope.timelineVersion, 8);
  const done = await terminal(s, f.id, f.input.projectId);
  await s.dispose();
  const original = await readFile(f.journalFile);
  const restarted = f.create({
    hostGeneration: 5,
    resolveWriteGrant: async () => {
      throw new Error("PRIVATE must not resolve expired grant");
    },
    copy: async () => {
      throw new Error("PRIVATE must not recopy");
    },
  });
  assert.deepEqual(await restarted.get(f.id, f.input.projectId), done);
  assert.deepEqual(
    await restarted.start(f.id, structuredClone(f.input), f.grantRef),
    done,
  );
  assert.deepEqual(await readFile(f.journalFile), original);
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
  assert.equal((await readdir(f.output)).length, 1);
});

test("request digest is canonical by object keys but changing any exact input, source order or original grant conflicts", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  const done = await terminal(s, f.id, f.input.projectId);
  const reordered = Object.fromEntries(
    Object.entries(f.input).reverse(),
  ) as NleCopyInput;
  reordered.media = f.input.media.map(
    (item) => Object.fromEntries(Object.entries(item).reverse()) as typeof item,
  );
  assert.deepEqual(await s.start(f.id, reordered, f.grantRef), done);
  for (const input of [
    { ...f.input, projectId: randomUUID() },
    { ...f.input, episodeId: randomUUID() },
    { ...f.input, timelineId: randomUUID() },
    { ...f.input, timelineVersion: 9 },
    { ...f.input, sourceFingerprint: "d".repeat(64) },
    { ...f.input, media: [{ ...f.media, artifactId: randomUUID() }] },
    { ...f.input, media: [{ ...f.media, mediaRef: randomUUID() }] },
    { ...f.input, media: [{ ...f.media, recordVersion: 4 }] },
    { ...f.input, media: [{ ...f.media, sha256: "e".repeat(64) }] },
    { ...f.input, documents: [...f.input.documents].reverse() },
    {
      ...f.input,
      documents: [{ ...f.input.documents[0], content: "changed" }],
    },
  ])
    await rejected(s.start(f.id, input, f.grantRef), "COPY_REQUEST_CONFLICT");
  await rejected(s.start(f.id, f.input, randomUUID()), "COPY_REQUEST_CONFLICT");
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
});

test("missing and foreign-project GET/cancel do not create directories or disclose original job", async (t) => {
  const f = await fixture(t),
    s = f.create();
  assert.equal(await s.get(f.id, f.input.projectId), undefined);
  assert.equal(await s.cancel(f.id, f.input.projectId), undefined);
  assert(!(await readdir(f.root)).includes("journal"));
  assert.equal(f.counters.grants, 0);
  await s.start(f.id, f.input, f.grantRef);
  await terminal(s, f.id, f.input.projectId);
  const before = await readFile(f.journalFile);
  assert.equal(await s.get(f.id, randomUUID()), undefined);
  assert.equal(await s.cancel(f.id, randomUUID()), undefined);
  assert.deepEqual(await readFile(f.journalFile), before);
});

test("strict original input is frozen before awaits and malformed requests never obtain a grant", async (t) => {
  const f = await fixture(t),
    ready = deferred(),
    release = deferred();
  t.after(release.resolve);
  const s = f.create({
    resolveWriteGrant: async (ref) => {
      ready.resolve();
      await release.promise;
      return f.options.resolveWriteGrant(ref);
    },
  });
  const mutable = structuredClone(f.input),
    work = s.start(f.id, mutable, f.grantRef);
  await ready.promise;
  mutable.timelineVersion = 100;
  mutable.media = [{ ...f.media, sha256: "e".repeat(64) }];
  mutable.documents = [];
  release.resolve();
  await work;
  const done = await terminal(s, f.id, f.input.projectId);
  assert.equal(done.status, "completed");
  assert.equal(done.scope.timelineVersion, 8);
  for (const input of [
    { ...f.input, path: "/PRIVATE" },
    { ...f.input, media: [] },
    { ...f.input, documents: [{ relativePath: "../escape", content: "" }] },
  ])
    await rejected(
      s.start(randomUUID(), input as NleCopyInput, f.grantRef),
      "INVALID_COPY_REQUEST",
    );
  assert.equal(f.counters.grants, 1);
});

test("read-only, expired, foreign-generation, relative or absent grants fail before any persistent request or output", async (t) => {
  const f = await fixture(t);
  const valid = {
    path: f.output,
    permission: "write-directory" as const,
    generation: 4,
    expiresAt: Date.now() + 60_000,
  };
  for (const grant of [
    undefined,
    { ...valid, permission: "read" },
    { ...valid, expiresAt: Date.now() - 1 },
    { ...valid, generation: 3 },
    { ...valid, path: "relative" },
  ]) {
    const s = f.create({
      resolveWriteGrant: async () =>
        grant as Awaited<ReturnType<Options["resolveWriteGrant"]>>,
    });
    await rejected(
      s.start(randomUUID(), f.input, f.grantRef),
      "COPY_GRANT_UNAVAILABLE",
    );
  }
  assert(!(await readdir(f.root)).includes("journal"));
  assert.deepEqual(await readdir(f.output), []);
  assert.equal(f.counters.copies, 0);
});

test("initial persistence reservations enforce two jobs even while asynchronous acceptance is blocked", async (t) => {
  const f = await fixture(t),
    release = deferred();
  t.after(release.resolve);
  let accepting = 0;
  const s = f.create({
    beforePersist: async (job) => {
      if (job.version === 0) {
        accepting++;
        await release.promise;
      }
    },
  });
  const a = s.start(f.id, f.input, f.grantRef),
    b = s.start(randomUUID(), f.input, f.grantRef);
  await until(async () => accepting === 2);
  const third = randomUUID();
  await rejected(s.start(third, f.input, f.grantRef), "COPY_BUSY");
  assert.equal(await s.get(third, f.input.projectId), undefined);
  release.resolve();
  const jobs = await Promise.all([a, b]);
  for (const job of jobs)
    assert.equal(
      (await terminal(s, job.id, f.input.projectId)).status,
      "completed",
    );
  assert.equal(f.counters.copies, 2);
  assert.equal((await readdir(f.output)).length, 2);
});

test("cancel during real first-file copy awaits cleanup, preserves original key and releases the actual reader", async (t) => {
  const f = await fixture(t),
    entered = deferred();
  const s = f.create({
    copy: (input, root, reader, signal) =>
      copyNleMediaPackage(input, root, reader, signal, {
        afterFile: async () => {
          entered.resolve();
          await new Promise<void>((done) => {
            if (signal.aborted) done();
            else signal.addEventListener("abort", () => done(), { once: true });
          });
        },
      }),
  });
  await s.start(f.id, f.input, f.grantRef);
  await entered.promise;
  assert.equal(await s.cancel(f.id, randomUUID()), undefined);
  assert.equal((await s.get(f.id, f.input.projectId))!.status, "running");
  const stopped = await s.cancel(f.id, f.input.projectId);
  assert.equal(stopped!.status, "canceled");
  assert.equal(stopped!.failureCode, "COPY_ABORTED");
  assert.equal(stopped!.scratchState, "cleaned");
  assert.equal(stopped!.copy, undefined);
  assert.deepEqual(await readdir(f.output), []);
  assert.deepEqual(await s.start(f.id, f.input, f.grantRef), stopped);
  const real = await f.reader.read(
    {
      mediaRef: f.media.mediaRef,
      sha256: f.media.sha256,
      sizeBytes: f.media.sizeBytes,
      mimeType: f.media.mimeType,
    },
    new AbortController().signal,
  );
  assert.deepEqual(
    Buffer.from(await new Response(real).arrayBuffer()),
    f.bytes,
  );
});

test("disposal owns in-flight copies, awaits cleanup and rejects new jobs without stealing foreground resources", async (t) => {
  const f = await fixture(t),
    entered = deferred();
  const s = f.create({
    copy: (input, root, reader, signal) =>
      copyNleMediaPackage(input, root, reader, signal, {
        afterFile: async () => {
          entered.resolve();
          await new Promise<void>((done) =>
            signal.addEventListener("abort", () => done(), { once: true }),
          );
        },
      }),
  });
  await s.start(f.id, f.input, f.grantRef);
  await entered.promise;
  await s.dispose();
  const stopped = await s.get(f.id, f.input.projectId);
  assert.equal(stopped!.status, "interrupted");
  assert.equal(stopped!.failureCode, "COPY_INTERRUPTED");
  assert.equal(stopped!.scratchState, "cleaned");
  assert.deepEqual(await readdir(f.output), []);
  await rejected(
    s.start(randomUUID(), f.input, f.grantRef),
    "INVALID_COPY_REQUEST",
  );
});

test("cancel in completion-persist window cannot publish a success; completed physical bytes remain explicitly unpublished", async (t) => {
  const f = await fixture(t),
    entered = deferred(),
    release = deferred();
  t.after(release.resolve);
  let copySignal: AbortSignal | undefined;
  const s = f.create({
    copy: (...args) => {
      copySignal = args[3];
      return copyNleMediaPackage(...args);
    },
    beforePersist: async (job) => {
      if (job.status === "completed") {
        entered.resolve();
        await release.promise;
      }
    },
  });
  await s.start(f.id, f.input, f.grantRef);
  await entered.promise;
  const stopping = s.cancel(f.id, f.input.projectId);
  // Observe the actual owned abort, not an assumed scheduling delay.
  await until(async () => copySignal?.aborted === true);
  release.resolve();
  const result = await stopping;
  assert.equal(result!.status, "canceled");
  assert.equal(result!.scratchState, "retained-unpublished");
  assert.equal(result!.copy, undefined);
  assert.equal((await readdir(f.output)).length, 1);
  const bytes = await readFile(f.journalFile);
  assert(!bytes.toString().includes('"status":"completed"'));
});

test("completion journal failure never invents a proof or automatically recopies a physically finished package", async (t) => {
  const f = await fixture(t);
  const s = f.create({
    beforePersist: async (job) => {
      if (job.status === "completed")
        throw new Error("PRIVATE disk write failed");
    },
  });
  await s.start(f.id, f.input, f.grantRef);
  const failed = await terminal(s, f.id, f.input.projectId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.scratchState, "retained-unpublished");
  assert.equal(failed.copy, undefined);
  assert.equal((await readdir(f.output)).length, 1);
  assert.deepEqual(await s.start(f.id, f.input, f.grantRef), failed);
  assert.equal(f.counters.copies, 1);
});

test("loss of all updates after original acceptance recovers original queued row as interrupted without rewriting it", async (t) => {
  const f = await fixture(t);
  const s = f.create({
    beforePersist: async (job) => {
      if (job.version > 0) throw new Error("PRIVATE disk unavailable");
    },
  });
  await s.start(f.id, f.input, f.grantRef);
  const interrupted = await terminal(s, f.id, f.input.projectId);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.version, 0);
  assert.equal(interrupted.copy, undefined);
  assert.equal(f.counters.copies, 0);
  const original = await readFile(f.journalFile);
  assert.equal(JSON.parse(original.toString()).record.job.status, "queued");
  const restart = f.create();
  assert.deepEqual(await restart.get(f.id, f.input.projectId), interrupted);
  assert.deepEqual(await restart.start(f.id, f.input, f.grantRef), interrupted);
  assert.deepEqual(await readFile(f.journalFile), original);
  assert.equal(f.counters.grants, 1);
});

test("corrupted journal is read every time and fails closed instead of cached success, latest fallback or a new copy", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  await terminal(s, f.id, f.input.projectId);
  await writeFile(f.journalFile, "PRIVATE invalid json");
  await rejected(s.get(f.id, f.input.projectId), "COPY_JOURNAL_UNAVAILABLE");
  await rejected(
    s.start(f.id, f.input, f.grantRef),
    "COPY_JOURNAL_UNAVAILABLE",
  );
  assert.equal(f.counters.copies, 1);
});

test("strict stored completion binding rejects changed exact file metadata even if local unkeyed journal checksum is recomputed", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  await terminal(s, f.id, f.input.projectId);
  const original = await readFile(f.journalFile),
    raw = JSON.parse(original.toString());
  const receipt = raw.record.job.copy.receipt;
  const file = receipt.files.find(
    (item: { kind: string }) => item.kind === "media",
  );
  file.relativePath = `media/${f.media.assetId}.mp4`;
  const bytes = JSON.stringify(receipt, null, 2);
  raw.record.job.copy.receiptBytes = Buffer.byteLength(bytes);
  raw.record.job.copy.receiptSha256 = hash(bytes);
  raw.sha256 = hash(JSON.stringify(raw.record));
  await writeFile(f.journalFile, JSON.stringify(raw));
  await rejected(s.get(f.id, f.input.projectId), "COPY_JOURNAL_UNAVAILABLE");
  assert.equal(f.counters.copies, 1);
});

test("explicit exact artifact resolution survives restart without reopening grants or recopying", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  const done = await terminal(s, f.id, f.input.projectId);
  const directory = join(f.output, (await readdir(f.output))[0]);
  const original = await readFile(f.journalFile);
  await s.dispose();
  const restart = f.create({
    hostGeneration: 5,
    resolveWriteGrant: async () => {
      throw Error("PRIVATE cannot reopen a grant");
    },
  });
  assert.equal(
    await restart.resolveArtifact(
      f.id,
      f.input.projectId,
      done.copy!.artifactRef!,
    ),
    directory,
  );
  assert.equal(
    await restart.resolveArtifact(f.id, randomUUID(), done.copy!.artifactRef!),
    undefined,
  );
  assert.equal(
    await restart.resolveArtifact(f.id, f.input.projectId, randomUUID()),
    undefined,
  );
  assert.deepEqual(await restart.get(f.id, f.input.projectId), done);
  assert.deepEqual(await readFile(f.journalFile), original);
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
});

for (const target of ["output", "root", "symlink"] as const)
  test(`explicit artifact reveal rejects substituted ${target} without changing historical receipt or foreign bytes`, async (t) => {
    const f = await fixture(t),
      s = f.create();
    await s.start(f.id, f.input, f.grantRef);
    const done = await terminal(s, f.id, f.input.projectId);
    const directory = join(f.output, (await readdir(f.output))[0]);
    if (target === "root") {
      await rename(f.output, join(f.root, "original-output"));
      await mkdir(f.output);
      await mkdir(directory);
    } else {
      await rename(directory, join(f.root, "original-directory"));
      if (target === "symlink")
        await symlink(join(f.root, "original-directory"), directory);
      else await mkdir(directory);
    }
    const marker = join(directory, "PRIVATE-foreign.txt");
    await writeFile(marker, "PRIVATE foreign bytes must survive");
    await rejected(
      s.resolveArtifact(f.id, f.input.projectId, done.copy!.artifactRef!),
      "COPY_JOURNAL_UNAVAILABLE",
    );
    assert.equal(
      await readFile(marker, "utf8"),
      "PRIVATE foreign bytes must survive",
    );
    assert.deepEqual(await s.get(f.id, f.input.projectId), done);
    assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
  });

test("legacy completed receipt stays historical but does not acquire an invented reveal capability", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  const done = await terminal(s, f.id, f.input.projectId);
  await s.dispose();
  const raw = JSON.parse(await readFile(f.journalFile, "utf8"));
  delete raw.record.outputBinding;
  delete raw.record.job.copy.artifactRef;
  raw.sha256 = hash(JSON.stringify(raw.record));
  await writeFile(f.journalFile, JSON.stringify(raw));
  const restart = f.create();
  const historical = await restart.get(f.id, f.input.projectId);
  assert.equal(historical!.status, "completed");
  assert.equal(historical!.copy!.artifactRef, undefined);
  assert.equal(
    await restart.resolveArtifact(
      f.id,
      f.input.projectId,
      done.copy!.artifactRef!,
    ),
    undefined,
  );
  assert.deepEqual(f.counters, { reads: 1, grants: 1, copies: 1 });
});

test("symlink or hardlink journal substitution preserves foreign files and exposes no private cause", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  await terminal(s, f.id, f.input.projectId);
  const foreign = join(f.root, "PRIVATE-foreign.json");
  await writeFile(foreign, await readFile(f.journalFile), { mode: 0o600 });
  await unlink(f.journalFile);
  await symlink(foreign, f.journalFile);
  await rejected(s.get(f.id, f.input.projectId), "COPY_JOURNAL_UNAVAILABLE");
  await unlink(f.journalFile);
  await link(foreign, f.journalFile);
  await rejected(s.get(f.id, f.input.projectId), "COPY_JOURNAL_UNAVAILABLE");
  assert.equal((await readFile(foreign)).length > 0, true);
  assert.equal(f.counters.copies, 1);
});

test(
  "existing nonprivate journal root and later nonprivate receipt file are rejected on POSIX",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await mkdir(f.journal, { mode: 0o755 });
    const s = f.create();
    await rejected(
      s.start(f.id, f.input, f.grantRef),
      "COPY_JOURNAL_UNAVAILABLE",
    );
    assert.deepEqual(await readdir(f.output), []);
    await chmod(f.journal, 0o700);
    const fresh = f.create();
    await fresh.start(f.id, f.input, f.grantRef);
    await terminal(fresh, f.id, f.input.projectId);
    await chmod(f.journalFile, 0o644);
    await rejected(
      fresh.get(f.id, f.input.projectId),
      "COPY_JOURNAL_UNAVAILABLE",
    );
  },
);

test("real isolated Node process exits after acceptance; a fresh supervisor only projects interruption and never resumes partial media", async (t) => {
  const f = await fixture(t);
  const moduleUrl = pathToFileURL(
    join(import.meta.dirname, "nle-copy-supervisor.ts"),
  ).href;
  const readerUrl = pathToFileURL(
    join(import.meta.dirname, "./managed-media-reader.js"),
  ).href;
  const source = `import { NleCopySupervisor } from ${JSON.stringify(moduleUrl)}; import { ManagedMediaReader } from ${JSON.stringify(readerUrl)};
    const a=JSON.parse(process.argv[1]); const s=new NleCopySupervisor({journalRoot:a.journal,hostGeneration:4,reader:new ManagedMediaReader(a.archive),resolveWriteGrant:async()=>({path:a.output,permission:'write-directory',generation:4,expiresAt:Date.now()+60000}),beforePersist:async job=>{if(job.version>0)await new Promise(()=>{});}});
    const accepted=await s.start(a.id,a.input,a.grantRef); if(accepted.status!=='queued')process.exit(2); process.exit(0);`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      source,
      JSON.stringify({
        journal: f.journal,
        archive: f.archive,
        output: f.output,
        id: f.id,
        input: f.input,
        grantRef: f.grantRef,
      }),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const errors: Buffer[] = [];
  child.stderr.on("data", (bytes) => errors.push(bytes));
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((done, fail) => {
    child.once("error", fail);
    child.once("close", (code, signal) => done({ code, signal }));
  });
  assert.deepEqual(
    result,
    { code: 0, signal: null },
    Buffer.concat(errors).toString(),
  );
  const original = await readFile(f.journalFile),
    s = f.create({
      resolveWriteGrant: async () => {
        throw new Error("PRIVATE cannot reopen grant");
      },
    });
  const interrupted = await s.get(f.id, f.input.projectId);
  assert.equal(interrupted!.status, "interrupted");
  assert.equal(interrupted!.version, 0);
  assert.equal(interrupted!.copy, undefined);
  assert.deepEqual(await s.start(f.id, f.input, f.grantRef), interrupted);
  assert.deepEqual(await readFile(f.journalFile), original);
  assert.deepEqual(await readdir(f.output), []);
  assert.deepEqual(f.counters, { reads: 0, grants: 0, copies: 0 });
});

test("native Host HTTP authenticates original inputs and copy grant, persists actual bytes, and recovers only the scoped original job", async (t) => {
  const f = await fixture(t),
    supervisor = f.create();
  let picks = 0;
  const host = createDesktopHost({
    accessToken: "nle-copy-controlled-native",
    capabilities: [],
    actions: {
      pickNleCopyDirectory: async () => {
        picks++;
        return {
          grantId: f.grantRef,
          permission: "write-directory",
          displayName: "选中目录",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          generation: 4,
        };
      },
      startNleMediaCopy: (id: string, input: NleCopyInput, grant: string) =>
        supervisor.start(id, input, grant),
      getNleMediaCopy: (id: string, project: string) =>
        supervisor.get(id, project),
      cancelNleMediaCopy: (id: string, project: string) =>
        supervisor.cancel(id, project),
    } as unknown as DesktopHostActions,
  });
  const server = await host.start({ hostname: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const baseUrl = `http://${server.hostname}:${server.port}`,
    token = "nle-copy-controlled-native";
  const client = new DesktopHostClient({ baseUrl, accessToken: token });
  const body = { id: f.id, input: f.input, writeGrantRef: f.grantRef };
  const post = (value: unknown, auth = true) =>
    fetch(`${baseUrl}/host/v1/nle-media-copies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(value),
    });
  assert.equal((await post(body, false)).status, 401);
  for (const invalid of [
    { ...body, path: "/PRIVATE" },
    { ...body, id: "../escape" },
    { ...body, input: { ...f.input, path: "/PRIVATE" } },
    {
      ...body,
      input: {
        ...f.input,
        media: [{ ...f.media, sizeBytes: String(f.media.sizeBytes) }],
      },
    },
  ]) {
    const result = await post(invalid);
    assert.equal(result.status, 400);
    assert.equal(
      result.headers.get("Content-Type"),
      "application/problem+json",
    );
    assert(!(await result.text()).includes("PRIVATE"));
  }
  assert.equal(f.counters.grants, 0);
  assert.equal(picks, 0);
  const grant = await client.pickNleCopyDirectory();
  assert.equal(grant!.grantId, f.grantRef);
  assert.equal(grant!.permission, "write-directory");
  assert.equal(grant!.generation, 4);
  assert(Number.isFinite(Date.parse(grant!.expiresAt)));
  assert.equal(picks, 1);
  assert(!JSON.stringify(grant).includes(f.output));
  // Request the real copy, then discard the response rather than substituting another id.
  const result = await post(body);
  assert.equal(result.status, 202);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  await result.arrayBuffer();
  let done!: NleCopyJob;
  await until(async () => {
    done = await client.getNleMediaCopy(f.id, f.input.projectId);
    return done.status === "completed";
  });
  assert.equal(done.copy!.receipt.files.length, 3);
  assert.equal(f.counters.copies, 1);
  const replay = await post(body);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), done);
  assert.deepEqual(
    await client.cancelNleMediaCopy(f.id, f.input.projectId),
    done,
  );
  const conflict = await post({
    ...body,
    input: { ...f.input, timelineVersion: 9 },
  });
  assert.equal(conflict.status, 409);
  const scoped = (query: string) =>
    fetch(`${baseUrl}/host/v1/nle-media-copies/${f.id}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.equal((await scoped(`projectId=${randomUUID()}`)).status, 404);
  assert.equal(
    (await scoped(`projectId=${f.input.projectId}&path=PRIVATE`)).status,
    400,
  );
  assert.equal(
    (
      await scoped(
        `projectId=${f.input.projectId}&projectId=${f.input.projectId}`,
      )
    ).status,
    400,
  );
  assert.equal(f.counters.copies, 1);
  await writeFile(f.journalFile, "PRIVATE damaged journal");
  const broken = await scoped(`projectId=${f.input.projectId}`);
  assert.equal(broken.status, 503);
  assert(!(await broken.text()).includes("PRIVATE"));
});

test("journal directory replacement and underlying resolver errors are sanitized, preserving both exact original and foreign files", async (t) => {
  const f = await fixture(t),
    s = f.create();
  await s.start(f.id, f.input, f.grantRef);
  await terminal(s, f.id, f.input.projectId);
  const moved = join(f.root, "PRIVATE-original-journal");
  await rename(f.journal, moved);
  await mkdir(f.journal, { mode: 0o700 });
  await writeFile(f.journalFile, "PRIVATE user file", { mode: 0o600 });
  await rejected(s.get(f.id, f.input.projectId), "COPY_JOURNAL_UNAVAILABLE");
  await rejected(
    s.start(f.id, f.input, f.grantRef),
    "COPY_JOURNAL_UNAVAILABLE",
  );
  assert.equal((await readFile(f.journalFile)).toString(), "PRIVATE user file");
  assert.equal(
    JSON.parse((await readFile(join(moved, `${f.id}.json`))).toString()).record
      .job.status,
    "completed",
  );
  const fresh = f.create({
    journalRoot: join(f.root, "missing"),
    resolveWriteGrant: async () => {
      throw new Error("PRIVATE provider/native picker failure");
    },
  });
  await rejected(
    fresh.start(randomUUID(), f.input, f.grantRef),
    "COPY_GRANT_UNAVAILABLE",
  );
  assert.equal(f.counters.copies, 1);
});

test("JSON-escaped private documents cannot exceed the bounded journal and produce an accepted but unreadable request", async (t) => {
  const f = await fixture(t),
    s = f.create();
  const input = {
    ...f.input,
    documents: [
      {
        relativePath: "timeline-manifest.json",
        content: "\\".repeat(13 * 1024 * 1024),
      },
    ],
  };
  await rejected(s.start(f.id, input, f.grantRef), "COPY_JOURNAL_UNAVAILABLE");
  assert.deepEqual(await readdir(f.journal), []);
  assert.deepEqual(await readdir(f.output), []);
  assert.equal(f.counters.copies, 0);
  assert.equal(await s.get(f.id, f.input.projectId), undefined);
});
