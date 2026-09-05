import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

const LEGACY_RECORD_VERSION = 1;
const RECORD_VERSION = 2;
const KEY_ENVELOPE_VERSION = 2;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16 * 1024;
const KEY_ENVELOPE_FILE = "vault.key.json";
const LEGACY_KEY_FILE = "vault.key";
const MASTER_KEY_AAD = Buffer.from("dramaip-vault-kek-v2", "utf8");
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export type LocalCredentialStorageStatus = {
  available: boolean;
  storage: "os_safe_storage" | "master_password" | "unavailable";
  backend: string;
  locked: boolean;
  migrationState: "none" | "migrating" | "complete" | "failed";
  message?: string;
};

export interface VaultKeyProtectorStatus {
  readonly available: boolean;
  readonly secure: boolean;
  readonly backend: string;
}

/** Implemented by Electron Main with safeStorage. Plaintext key material never leaves Main. */
export interface VaultKeyProtector {
  status(): Promise<VaultKeyProtectorStatus>;
  protect(value: Buffer): Promise<Buffer>;
  unprotect(value: Buffer): Promise<Buffer>;
}

export interface LocalCredentialVaultOptions {
  readonly keyProtector?: VaultKeyProtector;
}

export interface CredentialPolicy {
  readonly policyId?: string;
  readonly allowedOrigin?: string;
  readonly purpose: string;
  readonly createdAt: string;
  readonly reauthorizationRequired?: boolean;
}

export interface CredentialUse {
  readonly policyId?: string;
  readonly origin?: string;
  readonly purpose?: string;
}

interface WrappedKey {
  ciphertext: string;
  iv?: string;
  tag?: string;
}

interface KeyEnvelope {
  version: typeof KEY_ENVELOPE_VERSION;
  mechanism: "os_safe_storage" | "master_password";
  backend: string;
  active: WrappedKey;
  legacy?: WrappedKey;
  migrationState: "none" | "migrating" | "complete";
  kdf?: {
    algorithm: "scrypt";
    salt: string;
    n: typeof SCRYPT_N;
    r: typeof SCRYPT_R;
    p: typeof SCRYPT_P;
  };
  updatedAt: string;
}

class VaultLockedError extends Error {
  constructor(message = "凭据保险库尚未解锁") {
    super(message);
    this.name = "VaultLockedError";
  }
}

/**
 * Version-two credential vault. The record key is wrapped by Electron
 * safeStorage when a real OS secret store is available. On platforms without
 * one, the caller must unlock the vault with a per-launch master password.
 */
export class LocalCredentialVault {
  private keyPromise: Promise<Buffer> | undefined;
  private pendingMasterPassword: Buffer | undefined;
  private migrationState: LocalCredentialStorageStatus["migrationState"] =
    "none";

  constructor(
    private readonly directory: string,
    private readonly options: LocalCredentialVaultOptions = {},
  ) {}

  async status(): Promise<LocalCredentialStorageStatus> {
    const envelope = await this.readEnvelope().catch(() => undefined);
    const protectorStatus = await this.protectorStatus();
    const mechanism = envelope?.mechanism;
    const storage =
      mechanism ??
      (protectorStatus.secure ? "os_safe_storage" : "master_password");
    try {
      await this.key();
      return {
        available: true,
        storage,
        backend:
          envelope?.backend ??
          (storage === "master_password"
            ? "scrypt-aes-256-gcm"
            : protectorStatus.backend),
        locked: false,
        migrationState: this.migrationState,
      };
    } catch (cause) {
      const locked = cause instanceof VaultLockedError;
      this.keyPromise = undefined;
      if (!locked) this.migrationState = "failed";
      return {
        available: false,
        storage: locked ? storage : "unavailable",
        backend: envelope?.backend ?? protectorStatus.backend,
        locked,
        migrationState: this.migrationState,
        message: locked
          ? storage === "master_password"
            ? "系统安全存储不可用，请使用本次启动的主密码解锁凭据保险库。"
            : "操作系统安全存储当前不可用，凭据保险库保持锁定。"
          : "凭据保险库不可用，请检查应用数据目录和系统安全存储。",
      };
    }
  }

  async unlock(masterPassword: string): Promise<void> {
    if (masterPassword.length < 8) throw new Error("主密码至少需要 8 个字符");
    await this.lock();
    this.pendingMasterPassword = Buffer.from(masterPassword, "utf8");
    try {
      await this.key();
    } catch (cause) {
      this.keyPromise = undefined;
      throw cause;
    } finally {
      this.pendingMasterPassword?.fill(0);
      this.pendingMasterPassword = undefined;
    }
  }

  async lock(): Promise<void> {
    const pending = this.keyPromise;
    this.keyPromise = undefined;
    if (pending) {
      const key = await pending.catch(() => undefined);
      key?.fill(0);
    }
    this.pendingMasterPassword?.fill(0);
    this.pendingMasterPassword = undefined;
  }

  async store(
    secret: string,
    policy?: Omit<CredentialPolicy, "createdAt">,
  ): Promise<{ credentialRef: string }> {
    const plaintext = Buffer.from(secret.trim(), "utf8");
    if (!plaintext.length) throw new Error("凭据不能为空");
    if (plaintext.length > MAX_SECRET_BYTES)
      throw new Error("凭据长度超过本地凭据库限制");

    const credentialRef = randomUUID();
    const record = encryptRecord(
      credentialRef,
      plaintext,
      await this.key(),
      RECORD_VERSION,
    );
    plaintext.fill(0);
    await this.writePrivate(this.recordPath(credentialRef), record);
    if (policy) {
      const allowedOrigin = policy.allowedOrigin
        ? new URL(policy.allowedOrigin).origin
        : undefined;
      await this.writePrivate(
        this.policyPath(credentialRef),
        Buffer.from(
          `${JSON.stringify({
            ...policy,
            ...(allowedOrigin ? { allowedOrigin } : {}),
            createdAt: new Date().toISOString(),
          } satisfies CredentialPolicy)}\n`,
          "utf8",
        ),
      );
    }
    return { credentialRef };
  }

  async resolve(
    credentialRef: string,
    use?: CredentialUse,
  ): Promise<string | undefined> {
    if (!isCredentialRef(credentialRef)) return undefined;
    try {
      const policy = await this.readPolicy(credentialRef);
      if (policy) {
        if (policy.reauthorizationRequired) return undefined;
        if (use?.policyId && policy.policyId !== use.policyId) return undefined;
        if (use?.purpose && policy.purpose !== use.purpose) return undefined;
        if (use?.origin && policy.allowedOrigin !== new URL(use.origin).origin)
          return undefined;
      }
      // Loading the key may resume a crash-interrupted v1 migration, so read
      // the record only after the active key and record set are consistent.
      const key = await this.key();
      const plaintext = decryptRecord(
        credentialRef,
        await readFile(this.recordPath(credentialRef)),
        key,
        RECORD_VERSION,
      );
      const value = plaintext.toString("utf8");
      plaintext.fill(0);
      return value;
    } catch {
      return undefined;
    }
  }

  async remove(credentialRef: string): Promise<void> {
    if (!isCredentialRef(credentialRef)) return;
    await Promise.all([
      rm(this.recordPath(credentialRef), { force: true }),
      rm(this.policyPath(credentialRef), { force: true }),
    ]);
  }

  private recordPath(credentialRef: string): string {
    return join(this.directory, `${credentialRef}.vault`);
  }

  private policyPath(credentialRef: string): string {
    return join(this.directory, `${credentialRef}.policy.json`);
  }

  private async readPolicy(
    credentialRef: string,
  ): Promise<CredentialPolicy | undefined> {
    try {
      const value = JSON.parse(
        await readFile(this.policyPath(credentialRef), "utf8"),
      ) as Partial<CredentialPolicy>;
      if (
        typeof value.purpose !== "string" ||
        typeof value.createdAt !== "string" ||
        (value.allowedOrigin !== undefined &&
          typeof value.allowedOrigin !== "string") ||
        (value.policyId !== undefined && typeof value.policyId !== "string")
      )
        return undefined;
      return value as CredentialPolicy;
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      throw cause;
    }
  }

  private key(): Promise<Buffer> {
    this.keyPromise ??= this.loadOrCreateKey();
    return this.keyPromise;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700).catch(() => undefined);
    const existing = await this.readEnvelope();
    if (existing) {
      const active = await this.unwrap(existing, existing.active);
      if (existing.migrationState === "migrating" && existing.legacy) {
        const legacy = await this.unwrap(existing, existing.legacy);
        try {
          await this.resumeLegacyMigration(existing, active, legacy);
        } finally {
          legacy.fill(0);
        }
      } else {
        this.migrationState = "complete";
      }
      return active;
    }

    const legacy = await this.readLegacyKey();
    if (legacy) {
      try {
        return await this.beginLegacyMigration(legacy);
      } finally {
        legacy.fill(0);
      }
    }

    const key = randomBytes(KEY_BYTES);
    const envelope = await this.createEnvelope(key, "none");
    await this.writeEnvelope(envelope);
    this.migrationState = "complete";
    return key;
  }

  private async readLegacyKey(): Promise<Buffer | undefined> {
    try {
      const key = await readFile(join(this.directory, LEGACY_KEY_FILE));
      if (key.length !== KEY_BYTES) throw new Error("旧凭据保险库密钥格式无效");
      return key;
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      throw cause;
    }
  }

  private async beginLegacyMigration(legacy: Buffer): Promise<Buffer> {
    this.migrationState = "migrating";
    const active = randomBytes(KEY_BYTES);
    const envelope = await this.createEnvelope(active, "migrating", legacy);
    await this.writeEnvelope(envelope);
    await this.resumeLegacyMigration(envelope, active, legacy);
    return active;
  }

  private async resumeLegacyMigration(
    envelope: KeyEnvelope,
    active: Buffer,
    legacy: Buffer,
  ): Promise<void> {
    this.migrationState = "migrating";
    const backupDirectory = join(this.directory, "vault-v1-backup");
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const legacyKeyPath = join(this.directory, LEGACY_KEY_FILE);
    await copyFile(legacyKeyPath, join(backupDirectory, LEGACY_KEY_FILE)).catch(
      (cause) => {
        if (!isMissingFile(cause)) throw cause;
      },
    );
    const entries = await readdir(this.directory);
    for (const entry of entries.filter((value) => value.endsWith(".vault"))) {
      const credentialRef = entry.slice(0, -".vault".length);
      if (!isCredentialRef(credentialRef)) continue;
      const path = join(this.directory, entry);
      const current = await readFile(path);
      if (current[0] === RECORD_VERSION) {
        decryptRecord(credentialRef, current, active, RECORD_VERSION).fill(0);
        continue;
      }
      await copyFile(path, join(backupDirectory, entry));
      const plaintext = decryptRecord(
        credentialRef,
        current,
        legacy,
        LEGACY_RECORD_VERSION,
      );
      const migrated = encryptRecord(
        credentialRef,
        plaintext,
        active,
        RECORD_VERSION,
      );
      plaintext.fill(0);
      await this.writePrivate(path, migrated);
      decryptRecord(
        credentialRef,
        await readFile(path),
        active,
        RECORD_VERSION,
      ).fill(0);
    }
    const completed: KeyEnvelope = {
      ...envelope,
      migrationState: "complete",
      updatedAt: new Date().toISOString(),
    };
    delete completed.legacy;
    await this.writeEnvelope(completed);
    await rm(legacyKeyPath, { force: true });
    this.migrationState = "complete";
  }

  private async createEnvelope(
    active: Buffer,
    migrationState: KeyEnvelope["migrationState"],
    legacy?: Buffer,
  ): Promise<KeyEnvelope> {
    const protector = await this.protectorStatus();
    if (protector.secure && this.options.keyProtector) {
      return {
        version: KEY_ENVELOPE_VERSION,
        mechanism: "os_safe_storage",
        backend: protector.backend,
        active: {
          ciphertext: (
            await this.options.keyProtector.protect(active)
          ).toString("base64"),
        },
        ...(legacy
          ? {
              legacy: {
                ciphertext: (
                  await this.options.keyProtector.protect(legacy)
                ).toString("base64"),
              },
            }
          : {}),
        migrationState,
        updatedAt: new Date().toISOString(),
      };
    }
    if (!this.pendingMasterPassword) throw new VaultLockedError();
    const salt = randomBytes(16);
    const wrappingKey = await deriveMasterKey(this.pendingMasterPassword, salt);
    try {
      return {
        version: KEY_ENVELOPE_VERSION,
        mechanism: "master_password",
        backend: "scrypt-aes-256-gcm",
        active: wrapWithMasterKey(active, wrappingKey),
        ...(legacy ? { legacy: wrapWithMasterKey(legacy, wrappingKey) } : {}),
        migrationState,
        kdf: {
          algorithm: "scrypt",
          salt: salt.toString("base64"),
          n: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
        },
        updatedAt: new Date().toISOString(),
      };
    } finally {
      wrappingKey.fill(0);
    }
  }

  private async unwrap(
    envelope: KeyEnvelope,
    wrapped: WrappedKey,
  ): Promise<Buffer> {
    if (envelope.mechanism === "os_safe_storage") {
      const status = await this.protectorStatus();
      if (!status.secure || !this.options.keyProtector)
        throw new VaultLockedError(
          "创建保险库时使用的操作系统安全存储当前不可用",
        );
      const value = await this.options.keyProtector.unprotect(
        Buffer.from(wrapped.ciphertext, "base64"),
      );
      if (value.length !== KEY_BYTES) throw new Error("保险库密钥格式无效");
      return value;
    }
    if (!this.pendingMasterPassword || !envelope.kdf)
      throw new VaultLockedError();
    const wrappingKey = await deriveMasterKey(
      this.pendingMasterPassword,
      Buffer.from(envelope.kdf.salt, "base64"),
    );
    try {
      return unwrapWithMasterKey(wrapped, wrappingKey);
    } finally {
      wrappingKey.fill(0);
    }
  }

  private async protectorStatus(): Promise<VaultKeyProtectorStatus> {
    if (!this.options.keyProtector)
      return { available: false, secure: false, backend: "none" };
    return this.options.keyProtector.status();
  }

  private async readEnvelope(): Promise<KeyEnvelope | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.directory, KEY_ENVELOPE_FILE), "utf8"),
      ) as Partial<KeyEnvelope>;
      if (
        value.version !== KEY_ENVELOPE_VERSION ||
        !["os_safe_storage", "master_password"].includes(
          String(value.mechanism),
        ) ||
        !value.active ||
        typeof value.active.ciphertext !== "string" ||
        typeof value.backend !== "string" ||
        !["none", "migrating", "complete"].includes(
          String(value.migrationState),
        )
      )
        throw new Error("凭据保险库 key envelope 格式无效");
      return value as KeyEnvelope;
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      throw cause;
    }
  }

  private async writeEnvelope(envelope: KeyEnvelope): Promise<void> {
    await this.writePrivate(
      join(this.directory, KEY_ENVELOPE_FILE),
      Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8"),
    );
  }

  private async writePrivate(path: string, contents: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      this.directory,
      `.${basename(path)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, contents, { mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => undefined);
      await rename(temporary, path);
      await chmod(path, 0o600).catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function encryptRecord(
  credentialRef: string,
  plaintext: Buffer,
  key: Buffer,
  version: number,
): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(credentialRef, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    Buffer.from([version]),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}

function decryptRecord(
  credentialRef: string,
  record: Buffer,
  key: Buffer,
  expectedVersion: number,
): Buffer {
  if (
    record.length <= 1 + IV_BYTES + TAG_BYTES ||
    record[0] !== expectedVersion
  )
    throw new Error("凭据记录版本或长度无效");
  const iv = record.subarray(1, 1 + IV_BYTES);
  const tag = record.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = record.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(credentialRef, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function wrapWithMasterKey(value: Buffer, wrappingKey: Buffer): WrappedKey {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  cipher.setAAD(MASTER_KEY_AAD);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function unwrapWithMasterKey(wrapped: WrappedKey, wrappingKey: Buffer): Buffer {
  if (!wrapped.iv || !wrapped.tag)
    throw new Error("主密码 key envelope 格式无效");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    wrappingKey,
    Buffer.from(wrapped.iv, "base64"),
  );
  decipher.setAAD(MASTER_KEY_AAD);
  decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
  const value = Buffer.concat([
    decipher.update(Buffer.from(wrapped.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (value.length !== KEY_BYTES) throw new Error("保险库密钥格式无效");
  return value;
}

function deriveMasterKey(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolvePromise(Buffer.from(derived));
      },
    );
  });
}

function isCredentialRef(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
