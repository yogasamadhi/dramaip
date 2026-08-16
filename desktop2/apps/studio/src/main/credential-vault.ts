import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface EncryptedCredential {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialVault {
  private readonly keyPath: string;
  private readonly recordsPath: string;

  constructor(root: string) {
    this.keyPath = join(root, "master-key.bin");
    this.recordsPath = join(root, "records");
  }

  async store(secret: string): Promise<{ credentialRef: string }> {
    if (!secret || secret.length > 100_000)
      throw new Error("invalid credential secret");
    const key = await this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const record: EncryptedCredential = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const credentialRef = randomUUID();
    await mkdir(this.recordsPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.recordsPath, `${credentialRef}.json`),
      JSON.stringify(record),
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
    return { credentialRef };
  }

  async resolve(credentialRef: string): Promise<string | undefined> {
    this.validateRef(credentialRef);
    let raw: string;
    try {
      raw = await readFile(
        join(this.recordsPath, `${credentialRef}.json`),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const record = JSON.parse(raw) as EncryptedCredential;
    if (record.version !== 1) throw new Error("unsupported credential record");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.key(),
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  async remove(credentialRef: string): Promise<void> {
    this.validateRef(credentialRef);
    await unlink(join(this.recordsPath, `${credentialRef}.json`)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }

  private async key(): Promise<Buffer> {
    try {
      const key = await readFile(this.keyPath);
      if (key.length !== 32)
        throw new Error("credential master key has an invalid size");
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const key = randomBytes(32);
      await mkdir(join(this.keyPath, ".."), { recursive: true, mode: 0o700 });
      try {
        await writeFile(this.keyPath, key, { mode: 0o600, flag: "wx" });
        return key;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST")
          throw writeError;
        return readFile(this.keyPath);
      }
    }
  }

  private validateRef(credentialRef: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(credentialRef))
      throw new Error("invalid credentialRef");
  }
}
