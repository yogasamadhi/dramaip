import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  validNleCopyInput,
  NleCopyJobError,
  type NleCopyJob,
} from "@dramaip/desktop-host";
import {
  copyNleMediaPackage,
  NleCopyError,
  type NleCopyInput,
} from "./nle-copy";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
type CopyResult = Awaited<ReturnType<typeof copyNleMediaPackage>>;
type Scope = Pick<
  NleCopyInput,
  | "projectId"
  | "episodeId"
  | "timelineId"
  | "timelineVersion"
  | "sourceFingerprint"
>;
type Stored = {
  job: NleCopyJob;
  input: NleCopyInput;
  writeGrantRef: string;
  outputDirectory?: string;
  outputBinding?: CopyResult["binding"];
};
type Flight = {
  abort: AbortController;
  stop?: "canceled" | "interrupted";
  done: Promise<void>;
};
type WriteGrant = {
  path: string;
  permission: "write-directory";
  generation: number;
  expiresAt: number;
};
type Options = {
  journalRoot: string;
  hostGeneration: number;
  reader: Parameters<typeof copyNleMediaPackage>[2];
  resolveWriteGrant(ref: string): Promise<WriteGrant | undefined>;
  copy?: typeof copyNleMediaPackage;
  beforePersist?: (job: NleCopyJob) => Promise<void>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sameInode = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino;
const privateToCurrentUser = (stat: BigIntStats) =>
  process.platform === "win32" ||
  ((stat.mode & 0o077n) === 0n && stat.uid === BigInt(process.getuid!()));
const keysAre = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );
function scopeOf(input: NleCopyInput): Scope {
  return {
    projectId: input.projectId,
    episodeId: input.episodeId,
    timelineId: input.timelineId,
    timelineVersion: input.timelineVersion,
    sourceFingerprint: input.sourceFingerprint,
  };
}
function requestHash(input: NleCopyInput, writeGrantRef: string) {
  return digest(canonical({ input, writeGrantRef }));
}
function validateStored(raw: unknown, id: string): Stored {
  if (
    !object(raw) ||
    !keysAre(raw, ["format", "record", "sha256"]) ||
    raw.format !== "dramaip-nle-copy-job-v1" ||
    !object(raw.record) ||
    raw.sha256 !== digest(raw.record)
  )
    throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  const record = raw.record;
  if (
    !keysAre(
      record,
      ["job", "input", "writeGrantRef"],
      ["outputDirectory", "outputBinding"],
    ) ||
    !validNleCopyInput(record.input) ||
    typeof record.writeGrantRef !== "string" ||
    !uuid.test(record.writeGrantRef) ||
    !object(record.job)
  )
    throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  const job = record.job,
    input = record.input;
  if (
    !keysAre(
      job,
      [
        "id",
        "version",
        "status",
        "requestSha256",
        "scope",
        "createdAt",
        "updatedAt",
      ],
      ["copy", "failureCode", "scratchState"],
    ) ||
    job.id !== id ||
    !Number.isSafeInteger(job.version) ||
    Number(job.version) < 0 ||
    ![
      "queued",
      "running",
      "completed",
      "failed",
      "canceled",
      "interrupted",
    ].includes(String(job.status)) ||
    job.requestSha256 !== requestHash(input, record.writeGrantRef) ||
    JSON.stringify(canonical(job.scope)) !==
      JSON.stringify(canonical(scopeOf(input))) ||
    typeof job.createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT/u.test(job.createdAt) ||
    !Number.isFinite(Date.parse(job.createdAt)) ||
    typeof job.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(job.updatedAt)) ||
    Date.parse(job.updatedAt) < Date.parse(job.createdAt)
  )
    throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  const completed = job.status === "completed";
  if (
    completed !== Object.hasOwn(job, "copy") ||
    completed !== Object.hasOwn(record, "outputDirectory") ||
    (!completed && Object.hasOwn(record, "outputBinding")) ||
    (completed &&
      (Object.hasOwn(job, "failureCode") || Object.hasOwn(job, "scratchState")))
  )
    throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  if (["failed", "canceled", "interrupted"].includes(String(job.status))) {
    if (
      ![
        "COPY_ABORTED",
        "COPY_INTERRUPTED",
        "COPY_FAILED",
        "COPY_JOURNAL_UNAVAILABLE",
      ].includes(String(job.failureCode)) ||
      !["not-created", "cleaned", "retained-unpublished"].includes(
        String(job.scratchState),
      )
    )
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    if (
      (job.status === "canceled" && job.failureCode !== "COPY_ABORTED") ||
      (job.status === "interrupted" &&
        job.failureCode !== "COPY_INTERRUPTED") ||
      (job.status === "failed" &&
        !["COPY_FAILED", "COPY_JOURNAL_UNAVAILABLE"].includes(
          String(job.failureCode),
        ))
    )
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  } else if (
    !completed &&
    (Object.hasOwn(job, "failureCode") || Object.hasOwn(job, "scratchState"))
  )
    throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
  if (completed) {
    if (
      !object(job.copy) ||
      !keysAre(
        job.copy,
        ["receipt", "receiptSha256", "receiptBytes"],
        ["artifactRef"],
      ) ||
      !object(job.copy.receipt) ||
      typeof record.outputDirectory !== "string" ||
      !isAbsolute(record.outputDirectory)
    )
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    const receipt = job.copy.receipt;
    if (Object.hasOwn(job.copy, "artifactRef")) {
      const binding = record.outputBinding;
      if (
        job.copy.artifactRef !== receipt.packageRef ||
        !object(binding) ||
        !keysAre(binding, [
          "root",
          "rootDev",
          "rootIno",
          "directoryDev",
          "directoryIno",
        ]) ||
        typeof binding.root !== "string" ||
        !isAbsolute(binding.root) ||
        dirname(record.outputDirectory) !== binding.root ||
        !new RegExp(
          `^DramaIP-NLE-${receipt.packageRef}-[a-zA-Z0-9]{6}$`,
          "u",
        ).test(basename(record.outputDirectory)) ||
        ["rootDev", "rootIno", "directoryDev", "directoryIno"].some(
          (key) =>
            typeof binding[key] !== "string" ||
            !/^\d+$/u.test(String(binding[key])),
        )
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    } else if (Object.hasOwn(record, "outputBinding"))
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    const content = Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
    if (
      !keysAre(receipt, [
        "format",
        "schemaVersion",
        "packageRef",
        "projectId",
        "episodeId",
        "timelineId",
        "timelineVersion",
        "sourceFingerprint",
        "verifiedAt",
        "evidence",
        "qualityState",
        "rightsState",
        "billingState",
        "files",
      ]) ||
      receipt.format !== "dramaip-nle-media-copy-receipt" ||
      receipt.schemaVersion !== 1 ||
      typeof receipt.packageRef !== "string" ||
      !uuid.test(receipt.packageRef) ||
      receipt.projectId !== input.projectId ||
      receipt.episodeId !== input.episodeId ||
      receipt.timelineId !== input.timelineId ||
      receipt.timelineVersion !== input.timelineVersion ||
      receipt.sourceFingerprint !== input.sourceFingerprint ||
      typeof receipt.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
      receipt.evidence !==
        "complete-copy-and-destination-re-read-at-recorded-time" ||
      receipt.qualityState !== "unverified" ||
      receipt.rightsState !== "unverified" ||
      receipt.billingState !== "unknown" ||
      !Array.isArray(receipt.files) ||
      receipt.files.length !== input.media.length + input.documents.length ||
      job.copy.receiptBytes !== content.byteLength ||
      job.copy.receiptSha256 !==
        createHash("sha256").update(content).digest("hex")
    )
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    const paths = new Set<string>();
    for (const file of receipt.files) {
      if (
        !object(file) ||
        !keysAre(
          file,
          ["relativePath", "sizeBytes", "sha256", "kind"],
          ["source"],
        ) ||
        typeof file.relativePath !== "string" ||
        paths.has(file.relativePath)
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      paths.add(file.relativePath);
      if (file.kind === "document") {
        const original = input.documents.find(
          (item) => item.relativePath === file.relativePath,
        );
        if (
          !original ||
          Object.hasOwn(file, "source") ||
          file.sizeBytes !== Buffer.byteLength(original.content, "utf8") ||
          file.sha256 !==
            createHash("sha256").update(original.content, "utf8").digest("hex")
        )
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      } else if (file.kind === "media") {
        if (
          !object(file.source) ||
          !keysAre(file.source, ["assetId", "recordVersion", "artifactId"])
        )
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
        const original = input.media.find(
          (item) =>
            item.assetId === (file.source as Record<string, unknown>).assetId,
        );
        if (
          !original ||
          file.source.recordVersion !== original.recordVersion ||
          file.source.artifactId !== original.artifactId ||
          file.sizeBytes !== original.sizeBytes ||
          file.sha256 !== original.sha256 ||
          file.relativePath !==
            `media/${original.assetId}${HOST_MANAGED_MEDIA_EXTENSIONS[original.mimeType]}`
        )
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      } else throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    }
  }
  return record as unknown as Stored;
}

/** Single Host-owned persistent copy supervisor; no automatic retry, grant reopening or latest-source fallback. */
export class NleCopySupervisor {
  private disposed = false;
  private root?: BigIntStats;
  private initialization?: Promise<boolean>;
  private readonly starts = new Map<
    string,
    { hash: string; promise: Promise<NleCopyJob> }
  >();
  private readonly active = new Map<string, Flight>();
  private readonly acceptingNew = new Set<string>();
  private readonly journalLeases = new Map<string, Promise<unknown>>();
  constructor(private readonly options: Options) {}
  private async journalLease<T>(
    id: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const prior = this.journalLeases.get(id);
    const current = (async () => {
      await prior?.catch(() => {});
      return work();
    })();
    this.journalLeases.set(id, current);
    try {
      return await current;
    } finally {
      if (this.journalLeases.get(id) === current) this.journalLeases.delete(id);
    }
  }
  private async directory(create = true): Promise<boolean> {
    try {
      return await this.checkedDirectory(create);
    } catch {
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    }
  }
  private async checkedDirectory(create: boolean): Promise<boolean> {
    if (!this.initialization)
      this.initialization = (async () => {
        if (create)
          await mkdir(this.options.journalRoot, { mode: 0o700 }).catch(
            (cause) => {
              if (cause.code !== "EEXIST") throw cause;
            },
          );
        const root = await lstat(this.options.journalRoot, {
          bigint: true,
        }).catch((cause) => {
          if (!create && cause.code === "ENOENT") return undefined;
          throw cause;
        });
        if (!root) return false;
        if (
          !root.isDirectory() ||
          root.isSymbolicLink() ||
          !privateToCurrentUser(root)
        )
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
        this.root = root;
        return true;
      })();
    if (!(await this.initialization)) {
      this.initialization = undefined;
      return false;
    }
    const actual = await lstat(this.options.journalRoot, { bigint: true });
    if (
      !actual.isDirectory() ||
      actual.isSymbolicLink() ||
      !privateToCurrentUser(actual) ||
      !sameInode(actual, this.root!)
    )
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    return true;
  }
  private async read(id: string): Promise<Stored | undefined> {
    return this.journalLease(id, () => this.readLocked(id));
  }
  private async readLocked(id: string): Promise<Stored | undefined> {
    if (!(await this.directory(false))) return undefined;
    let handle;
    try {
      handle = await open(
        join(this.options.journalRoot, `${id}.json`),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.nlink !== 1n ||
        !privateToCurrentUser(before) ||
        before.size > 24n * 1024n * 1024n
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const name = await lstat(join(this.options.journalRoot, `${id}.json`), {
        bigint: true,
      });
      await this.directory();
      if (
        !sameInode(before, after) ||
        !sameInode(before, name) ||
        name.isSymbolicLink() ||
        ["size", "mtimeNs", "ctimeNs", "nlink"].some(
          (key) =>
            before[key as keyof BigIntStats] !==
            after[key as keyof BigIntStats],
        )
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      return validateStored(
        JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
        id,
      );
    } catch {
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    } finally {
      await handle.close();
    }
  }
  private async persist(record: Stored, initial = false, signal?: AbortSignal) {
    await this.directory();
    await this.options.beforePersist?.(structuredClone(record.job));
    signal?.throwIfAborted();
    return this.journalLease(record.job.id, () =>
      this.persistLocked(record, initial, signal),
    );
  }
  private async persistLocked(
    record: Stored,
    initial: boolean,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const content = Buffer.from(
      JSON.stringify({
        format: "dramaip-nle-copy-job-v1",
        record,
        sha256: digest(record),
      }),
      "utf8",
    );
    if (content.byteLength > 24 * 1024 * 1024)
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    validateStored(JSON.parse(content.toString("utf8")), record.job.id);
    const final = join(this.options.journalRoot, `${record.job.id}.json`);
    const path = initial
      ? final
      : join(this.options.journalRoot, `.${record.job.id}-${randomUUID()}.tmp`);
    const handle = await open(
      path,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    const identity = await handle.stat({ bigint: true });
    let renamed = false;
    let committed = false;
    try {
      let offset = 0;
      while (offset < content.byteLength) {
        const write = await handle.write(
          content,
          offset,
          content.byteLength - offset,
        );
        if (write.bytesWritten <= 0)
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
        offset += write.bytesWritten;
      }
      await handle.sync();
      const read = Buffer.alloc(content.byteLength);
      let readOffset = 0;
      while (readOffset < read.byteLength) {
        const chunk = await handle.read(
          read,
          readOffset,
          read.byteLength - readOffset,
          readOffset,
        );
        if (chunk.bytesRead <= 0)
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
        readOffset += chunk.bytesRead;
      }
      if (!read.equals(content))
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      await this.directory();
      const current = await lstat(path, { bigint: true });
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.nlink !== 1n ||
        !sameInode(current, identity)
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      if (!initial) {
        const prior = await this.readLocked(record.job.id);
        if (
          !prior ||
          prior.job.version + 1 !== record.job.version ||
          prior.job.requestSha256 !== record.job.requestSha256 ||
          ["completed", "failed", "canceled", "interrupted"].includes(
            prior.job.status,
          )
        )
          throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
        signal?.throwIfAborted();
        await rename(path, final);
        renamed = true;
      }
      committed = true;
    } finally {
      await handle.close();
      if (!renamed && (!initial || !committed)) {
        const file = await lstat(path, { bigint: true }).catch(() => undefined);
        if (file && sameInode(file, identity)) await unlink(path);
      }
    }
  }
  private public(record: Stored): NleCopyJob {
    return structuredClone(record.job);
  }
  async get(id: string, projectId: string): Promise<NleCopyJob | undefined> {
    if (!uuid.test(id) || !uuid.test(projectId))
      throw new NleCopyJobError("INVALID_COPY_REQUEST");
    const record = await this.read(id);
    if (!record || record.input.projectId !== projectId) return undefined;
    const job = this.public(record);
    // A read after restart never continues a partial copy, writes its journal, reopens a grant, or rechecks output bytes.
    if (
      ["queued", "running"].includes(job.status) &&
      !this.active.has(id) &&
      !this.acceptingNew.has(id)
    )
      return {
        ...job,
        status: "interrupted",
        failureCode: "COPY_INTERRUPTED",
        scratchState: "retained-unpublished",
      };
    return job;
  }
  start(
    id: string,
    input: NleCopyInput,
    writeGrantRef: string,
  ): Promise<NleCopyJob> {
    if (
      this.disposed ||
      !uuid.test(id) ||
      !uuid.test(writeGrantRef) ||
      !validNleCopyInput(input)
    )
      return Promise.reject(new NleCopyJobError("INVALID_COPY_REQUEST"));
    const frozen: NleCopyInput = JSON.parse(JSON.stringify(input));
    const hash = requestHash(frozen, writeGrantRef),
      existing = this.starts.get(id);
    if (existing)
      return existing.hash === hash
        ? existing.promise.then((value) => structuredClone(value))
        : Promise.reject(new NleCopyJobError("COPY_REQUEST_CONFLICT"));
    const promise = this.accept(id, frozen, writeGrantRef, hash).catch(
      (cause) => {
        if (cause instanceof NleCopyJobError) throw cause;
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      },
    );
    this.starts.set(id, { hash, promise });
    void promise
      .finally(() => {
        if (this.starts.get(id)?.promise === promise) this.starts.delete(id);
      })
      .catch(() => {});
    return promise;
  }
  private async accept(
    id: string,
    input: NleCopyInput,
    writeGrantRef: string,
    hash: string,
  ) {
    const prior = await this.read(id);
    if (prior) {
      if (prior.job.requestSha256 !== hash)
        throw new NleCopyJobError("COPY_REQUEST_CONFLICT");
      return (await this.get(id, input.projectId))!;
    }
    if (this.disposed || this.active.size + this.acceptingNew.size >= 2)
      throw new NleCopyJobError("COPY_BUSY");
    const grant = await this.options
      .resolveWriteGrant(writeGrantRef)
      .catch(() => {
        throw new NleCopyJobError("COPY_GRANT_UNAVAILABLE");
      });
    if (
      !grant ||
      grant.permission !== "write-directory" ||
      grant.generation !== this.options.hostGeneration ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now() ||
      !isAbsolute(grant.path)
    )
      throw new NleCopyJobError("COPY_GRANT_UNAVAILABLE");
    if (this.disposed || this.active.size + this.acceptingNew.size >= 2)
      throw new NleCopyJobError("COPY_BUSY");
    const createdAt = new Date().toISOString();
    const record: Stored = {
      input,
      writeGrantRef,
      job: {
        id,
        version: 0,
        status: "queued",
        requestSha256: hash,
        scope: scopeOf(input),
        createdAt,
        updatedAt: createdAt,
      },
    };
    this.acceptingNew.add(id);
    try {
      await this.persist(record, true);
      const accepted = this.public(record);
      const abort = new AbortController();
      const flight: Flight = { abort, done: Promise.resolve() };
      this.active.set(id, flight);
      flight.done = this.run(record, grant.path, flight).finally(() => {
        this.active.delete(id);
      });
      // Keep the background promise owned even if the HTTP start reply is lost.
      void flight.done.catch(() => {});
      return accepted;
    } finally {
      this.acceptingNew.delete(id);
    }
  }
  private async run(record: Stored, root: string, flight: Flight) {
    let result: CopyResult | undefined;
    const signal = flight.abort.signal;
    const timeout = setTimeout(() => flight.abort.abort(), 30 * 60_000);
    timeout.unref();
    try {
      signal.throwIfAborted();
      record.job = {
        ...record.job,
        version: 1,
        status: "running",
        updatedAt: new Date().toISOString(),
      };
      await this.persist(record);
      signal.throwIfAborted();
      result = await (this.options.copy ?? copyNleMediaPackage)(
        record.input,
        root,
        this.options.reader,
        signal,
      );
      signal.throwIfAborted();
      const next: Stored = {
        ...record,
        outputDirectory: result.directory,
        outputBinding: result.binding,
        job: {
          ...record.job,
          version: 2,
          status: "completed",
          updatedAt: new Date().toISOString(),
          copy: {
            artifactRef: result.receipt.packageRef,
            receipt: result.receipt,
            receiptSha256: result.receiptSha256,
            receiptBytes: result.receiptBytes,
          },
        },
      };
      await this.persist(next, false, signal);
    } catch (cause) {
      const prior = await this.read(record.job.id).catch(() => undefined);
      if (
        !prior ||
        ["completed", "failed", "canceled", "interrupted"].includes(
          prior.job.status,
        )
      )
        return;
      const stop = flight.stop;
      const failed: Stored = {
        ...prior,
        job: {
          ...prior.job,
          version: prior.job.version + 1,
          status: stop ?? "failed",
          updatedAt: new Date().toISOString(),
          failureCode:
            stop === "canceled"
              ? "COPY_ABORTED"
              : stop === "interrupted"
                ? "COPY_INTERRUPTED"
                : cause instanceof NleCopyJobError
                  ? "COPY_JOURNAL_UNAVAILABLE"
                  : "COPY_FAILED",
          scratchState: result
            ? "retained-unpublished"
            : cause instanceof NleCopyError
              ? cause.scratchState
              : "not-created",
        },
      };
      await this.persist(failed).catch(() => {});
    } finally {
      clearTimeout(timeout);
    }
  }
  async cancel(id: string, projectId: string): Promise<NleCopyJob | undefined> {
    await this.starts.get(id)?.promise.catch(() => {});
    const current = await this.get(id, projectId);
    if (!current) return undefined;
    const flight = this.active.get(id);
    if (flight && ["queued", "running"].includes(current.status)) {
      flight.stop = "canceled";
      flight.abort.abort();
      await flight.done;
    }
    return this.get(id, projectId);
  }
  /** Explicit reveal only. Historical GET never performs these filesystem reads or reopens a write grant. */
  async resolveArtifact(
    id: string,
    projectId: string,
    artifactRef: string,
  ): Promise<string | undefined> {
    if (!uuid.test(id) || !uuid.test(projectId) || !uuid.test(artifactRef))
      throw new NleCopyJobError("INVALID_COPY_REQUEST");
    const record = await this.read(id);
    if (
      !record ||
      record.input.projectId !== projectId ||
      record.job.status !== "completed" ||
      record.job.copy?.artifactRef !== artifactRef ||
      !record.outputBinding ||
      !record.outputDirectory
    )
      return undefined;
    try {
      const root = await lstat(record.outputBinding.root, { bigint: true });
      const directory = await lstat(record.outputDirectory, { bigint: true });
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        String(root.dev) !== record.outputBinding.rootDev ||
        String(root.ino) !== record.outputBinding.rootIno ||
        String(directory.dev) !== record.outputBinding.directoryDev ||
        String(directory.ino) !== record.outputBinding.directoryIno
      )
        throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
      return record.outputDirectory;
    } catch {
      throw new NleCopyJobError("COPY_JOURNAL_UNAVAILABLE");
    }
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled(
      [...this.starts.values()].map((item) => item.promise),
    );
    const flights = [...this.active.values()];
    for (const flight of flights) {
      flight.stop ??= "interrupted";
      flight.abort.abort();
    }
    await Promise.allSettled(flights.map((flight) => flight.done));
  }
}

export { NleCopyJobError, validNleCopyInput } from "@dramaip/desktop-host";
export type { NleCopyJob } from "@dramaip/desktop-host";
