/**
 * File access through Host-held grants (D8): the shell's native dialogs pick
 * paths, the Host keeps them behind opaque grant ids, and business plugins
 * read or reveal only what a grant names. No path crosses to the browser.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type {
  HostFileGrant,
  HostGrantedDocument,
  HostTextFileSaveResult,
  HostWriteDirectoryGrant,
} from "@dramaip/host-contracts";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import { extractGrantedDocument } from "./document-import.ts";

/** Grants expire; a picked path is never readable for longer than this. */
const GRANT_TTL_MS = 10 * 60_000;

/** Grant ids of one Host process carry this generation. */
export const HOST_GENERATION = 1;

/** Largest file a grant read may return. */
const MAXIMUM_GRANT_READ_BYTES = 32 * 1024 * 1024;

interface FileGrant {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly expiresAt: number;
}

interface WriteDirectoryGrant {
  readonly path: string;
  readonly generation: number;
  readonly expiresAt: number;
}

function displayName(path: string, fallback: string): string {
  return path.split(/[\\/]/u).pop() || fallback;
}

function checkedLimit(maximumBytes: number): number {
  if (
    !Number.isInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAXIMUM_GRANT_READ_BYTES
  )
    throw new Error("文件读取上限无效");
  return maximumBytes;
}

function safeSuggestedName(name: string, fallback: string): string {
  return name.replace(/[\\/]/gu, "-").slice(0, 180) || fallback;
}

/** Grants, native file dialogs and the artifacts the Host saved. */
export class HostFiles {
  private readonly grants = new Map<string, FileGrant>();
  private readonly writeDirectories = new Map<string, WriteDirectoryGrant>();
  private readonly artifacts = new Map<string, string>();

  /** @param shell - the shell bridge that shows native dialogs. */
  constructor(private readonly shell: ShellBridge) {}

  private issue(path: string, kind: FileGrant["kind"]): HostFileGrant {
    const grantId = randomUUID();
    const expiresAt = Date.now() + GRANT_TTL_MS;
    this.grants.set(grantId, { path, kind, expiresAt });
    return {
      grantId,
      kind,
      displayName: displayName(path, kind === "file" ? "选中文件" : "选中目录"),
      expiresAt: new Date(expiresAt).toISOString(),
      generation: HOST_GENERATION,
    };
  }

  /**
   * The path of a live read grant.
   * @param grantId - the grant.
   * @param kind - the grant kind the caller needs, when it matters.
   * @param message - the error shown when the grant is not usable.
   * @returns the granted path.
   */
  grantedPath(
    grantId: string,
    kind?: FileGrant["kind"],
    message = "文件授权无效或已过期",
  ): string {
    const grant = this.grants.get(grantId);
    if (
      grant === undefined ||
      grant.expiresAt <= Date.now() ||
      (kind !== undefined && grant.kind !== kind)
    )
      throw new Error(message);
    return grant.path;
  }

  async pickFiles(
    options: { multiple?: boolean; extensions?: readonly string[] } = {},
  ): Promise<readonly HostFileGrant[] | null> {
    const extensions = (options.extensions ?? [])
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 50);
    const { paths } = await this.shell.request("dialog.open", {
      purpose: "files",
      multiple: options.multiple === true,
      extensions,
    });
    if (paths.length === 0) return null;
    return paths.map((path) => this.issue(path, "file"));
  }

  async pickDirectory(): Promise<HostFileGrant | null> {
    const { paths } = await this.shell.request("dialog.open", {
      purpose: "directory",
    });
    const path = paths[0];
    return path === undefined ? null : this.issue(path, "directory");
  }

  /** A dedicated write capability; read grants are never upgraded to it. */
  async pickNleCopyDirectory(): Promise<HostWriteDirectoryGrant | null> {
    const { paths } = await this.shell.request("dialog.open", {
      purpose: "nle-copy-directory",
      title: "选择仅用于本次原媒体包复制的输出目录",
    });
    const path = paths[0];
    if (path === undefined) return null;
    const grantId = randomUUID();
    const expiresAt = Date.now() + GRANT_TTL_MS;
    this.writeDirectories.set(grantId, {
      path,
      generation: HOST_GENERATION,
      expiresAt,
    });
    return {
      grantId,
      permission: "write-directory",
      displayName: displayName(path, "选中输出目录"),
      expiresAt: new Date(expiresAt).toISOString(),
      generation: HOST_GENERATION,
    };
  }

  /**
   * The write-directory grant an NLE copy names.
   * @param ref - the grant id.
   * @returns the grant, or undefined.
   */
  writeDirectory(
    ref: string,
  ): (WriteDirectoryGrant & { permission: "write-directory" }) | undefined {
    const grant = this.writeDirectories.get(ref);
    return grant ? { ...grant, permission: "write-directory" } : undefined;
  }

  async readGrantedText(
    grantId: string,
    maximumBytes: number,
  ): Promise<{ name: string; content: string; size: number }> {
    const limit = checkedLimit(maximumBytes);
    const path = this.grantedPath(grantId);
    const content = await readFile(path);
    if (content.byteLength > limit) throw new Error("文件超过允许的大小");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error("文件不是有效的 UTF-8 文本");
    }
    return {
      name: displayName(path, "导入文件"),
      content: text,
      size: content.byteLength,
    };
  }

  async readGrantedDocument(
    grantId: string,
    maximumBytes: number,
  ): Promise<HostGrantedDocument> {
    const limit = checkedLimit(maximumBytes);
    const path = this.grantedPath(grantId, "file");
    const source = await readFile(path);
    return extractGrantedDocument(displayName(path, "导入文件"), source, {
      maximumBytes: limit,
    });
  }

  private async saveVerified(
    path: string,
    bytes: Buffer,
    integrityMessage: string,
  ): Promise<HostTextFileSaveResult> {
    await writeFile(path, bytes);
    // Verify the bytes actually written, not merely the requested content.
    const saved = await readFile(path);
    if (!saved.equals(bytes)) throw new Error(integrityMessage);
    const artifactRef = randomUUID();
    this.artifacts.set(artifactRef, path);
    return {
      saved: true,
      artifactRef,
      sha256: createHash("sha256").update(saved).digest("hex"),
      byteSize: saved.byteLength,
      savedAt: new Date().toISOString(),
    };
  }

  async saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<HostTextFileSaveResult> {
    const { path } = await this.shell.request("dialog.save", {
      title: "导出项目文件",
      defaultPath: safeSuggestedName(
        input.suggestedName,
        "尽意-DramaIP-导出文件.txt",
      ),
    });
    if (path === null) return { saved: false };
    return this.saveVerified(
      path,
      Buffer.from(input.content, "utf8"),
      "导出文件完整性校验失败，未记录成功交付。",
    );
  }

  async saveBinaryFile(input: {
    suggestedName: string;
    contentBase64: string;
    mimeType: "application/zip";
  }): Promise<HostTextFileSaveResult> {
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (
      bytes.length > 33_554_432 ||
      bytes.subarray(0, 4).toString("hex") !== "504b0304"
    )
      throw new Error("试制包不是有效的受支持 ZIP 文件。");
    const { path } = await this.shell.request("dialog.save", {
      title: "保存内部试制包",
      defaultPath: safeSuggestedName(input.suggestedName, "DramaIP-pilot.zip"),
      filters: [{ name: "ZIP 试制包", extensions: ["zip"] }],
    });
    if (path === null) return { saved: false };
    return this.saveVerified(path, bytes, "试制包写入完整性校验失败。");
  }

  async revealGrant(grantId: string): Promise<void> {
    const grant = this.grants.get(grantId);
    if (grant === undefined || grant.expiresAt <= Date.now())
      throw new Error("文件授权无效或已过期");
    await this.shell.request("shell.showItemInFolder", { path: grant.path });
  }

  async revealArtifact(artifactRef: string): Promise<void> {
    const path = this.artifacts.get(artifactRef);
    if (path === undefined) throw new Error("导出产物引用无效");
    await this.shell.request("shell.showItemInFolder", { path });
  }
}
