import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

const VAULT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16 * 1024;

export type LocalCredentialStorageStatus = {
  available: boolean;
  storage: "local_encrypted_file";
  message?: string;
};

/**
 * A platform-neutral vault stored entirely below Electron's userData folder.
 * It deliberately does not call Electron safeStorage, macOS Keychain, Windows
 * Credential Manager, or a Linux secret-service implementation.
 *
 * The vault key and encrypted records inherit the operating-system account
 * protection of userData. It is not a substitute for a user-provided master
 * password or full-disk encryption.
 */
export class LocalCredentialVault {
  private keyPromise: Promise<Buffer> | undefined;

  constructor(private readonly directory: string) {}

  async status(): Promise<LocalCredentialStorageStatus> {
    try {
      await this.key();
      return { available: true, storage: "local_encrypted_file" };
    } catch {
      return {
        available: false,
        storage: "local_encrypted_file",
        message: "本地凭据目录不可用，请检查应用数据目录的写入权限。",
      };
    }
  }

  async store(secret: string): Promise<{ credentialRef: string }> {
    const plaintext = Buffer.from(secret.trim(), "utf8");
    if (!plaintext.length) throw new Error("凭据不能为空");
    if (plaintext.length > MAX_SECRET_BYTES)
      throw new Error("凭据长度超过本地凭据库限制");

    const credentialRef = randomUUID();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    cipher.setAAD(Buffer.from(credentialRef, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const record = Buffer.concat([
      Buffer.from([VAULT_VERSION]),
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]);
    await this.writePrivate(this.recordPath(credentialRef), record);
    return { credentialRef };
  }

  async resolve(credentialRef: string): Promise<string | undefined> {
    if (!isCredentialRef(credentialRef)) return undefined;
    try {
      const record = await readFile(this.recordPath(credentialRef));
      if (
        record.length <= 1 + IV_BYTES + TAG_BYTES ||
        record[0] !== VAULT_VERSION
      )
        return undefined;
      const iv = record.subarray(1, 1 + IV_BYTES);
      const tag = record.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const ciphertext = record.subarray(1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", await this.key(), iv);
      decipher.setAAD(Buffer.from(credentialRef, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return undefined;
    }
  }

  async remove(credentialRef: string): Promise<void> {
    if (!isCredentialRef(credentialRef)) return;
    await rm(this.recordPath(credentialRef), { force: true });
  }

  private recordPath(credentialRef: string): string {
    return join(this.directory, `${credentialRef}.vault`);
  }

  private key(): Promise<Buffer> {
    this.keyPromise ??= this.loadOrCreateKey();
    return this.keyPromise;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700).catch(() => undefined);
    const path = join(this.directory, "vault.key");
    try {
      const key = await readFile(path);
      if (key.length !== KEY_BYTES) throw new Error("本地凭据库密钥格式无效");
      return key;
    } catch (cause) {
      if (!isMissingFile(cause)) throw cause;
    }
    const key = randomBytes(KEY_BYTES);
    await this.writePrivate(path, key);
    return key;
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
