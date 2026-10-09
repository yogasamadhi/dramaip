import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash, verify } from "node:crypto";
import { join } from "node:path";
import { readFontGlyphMap } from "./font-cmap";
import type { HostRendererFontDescriptor } from "@dramaip/desktop-host";

export type RendererFontDescriptor = HostRendererFontDescriptor;
export interface VerifiedRendererFont {
  descriptor: RendererFontDescriptor;
  glyph(codePoint: number): number;
  /** A new private copy every time; no caller can mutate the verified source snapshot. */
  bytes(): Buffer;
}
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const semver = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;
export async function readBoundedRendererFontMember(
  path: string,
  maximum: number,
): Promise<Buffer> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1)
    throw Error("Renderer font artifact must be a single-link regular member");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const first = await handle.stat();
    if (
      !first.isFile() ||
      first.dev !== entry.dev ||
      first.ino !== entry.ino ||
      first.nlink !== 1 ||
      first.size < 1 ||
      first.size > maximum
    )
      throw Error("Renderer font artifact is not a bounded regular file");
    const bytes = Buffer.alloc(first.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) throw Error("Renderer font artifact ended early");
      offset += bytesRead;
    }
    const last = await handle.stat(),
      finalEntry = await lstat(path),
      extra = Buffer.alloc(1);
    if (
      (await handle.read(extra, 0, 1, offset)).bytesRead ||
      first.size !== last.size ||
      first.mtimeMs !== last.mtimeMs ||
      first.ctimeMs !== last.ctimeMs ||
      last.nlink !== 1 ||
      finalEntry.isSymbolicLink() ||
      finalEntry.dev !== first.dev ||
      finalEntry.ino !== first.ino
    )
      throw Error("Renderer font artifact changed while freezing");
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Operator-provided signed pack only. Never search OS fonts, download fonts or infer distribution rights. */
export async function loadVerifiedRendererFonts(input: {
  root: string;
  publicKeyPem?: string;
}): Promise<readonly VerifiedRendererFont[]> {
  if (!input.publicKeyPem?.trim()) return [];
  const rootEntry = await lstat(input.root).catch((cause: unknown) => {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return undefined;
    throw cause;
  });
  if (!rootEntry) return [];
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink())
    throw Error("Renderer font pack root is not an ordinary directory");
  let bytes: Buffer;
  try {
    bytes = await readBoundedRendererFontMember(
      join(input.root, "fonts-manifest.json"),
      256 * 1024,
    );
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return [];
    throw cause;
  }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !object(value) ||
    Object.keys(value).sort().join(",") !==
      "fonts,format,packVersion,signature,version" ||
    value.format !== "dramaip-renderer-font-pack" ||
    value.version !== 1 ||
    typeof value.packVersion !== "string" ||
    value.packVersion.length > 120 ||
    !semver.test(value.packVersion) ||
    typeof value.signature !== "string" ||
    value.signature.length > 256 ||
    !Array.isArray(value.fonts) ||
    value.fonts.length < 1 ||
    value.fonts.length > 16
  )
    throw Error("Renderer font pack manifest is invalid");
  const fonts: RendererFontDescriptor[] = [],
    ids = new Set<string>();
  let total = 0;
  for (const font of value.fonts) {
    if (
      !object(font) ||
      Object.keys(font).sort().join(",") !==
        "id,label,license,sha256,sizeBytes,sourceUrl" ||
      typeof font.id !== "string" ||
      !uuid.test(font.id) ||
      ids.has(font.id) ||
      typeof font.label !== "string" ||
      !font.label.trim() ||
      font.label.length > 120 ||
      typeof font.license !== "string" ||
      !font.license.trim() ||
      font.license.length > 2000 ||
      typeof font.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(font.sha256) ||
      !Number.isSafeInteger(font.sizeBytes) ||
      Number(font.sizeBytes) < 1 ||
      Number(font.sizeBytes) > 32 * 1024 * 1024 ||
      typeof font.sourceUrl !== "string" ||
      font.sourceUrl.length > 2000
    )
      throw Error("Renderer font descriptor is invalid");
    const url = new URL(font.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("Renderer font source declaration is invalid");
    total += Number(font.sizeBytes);
    if (total > 64 * 1024 * 1024)
      throw Error("Renderer font pack exceeds its total byte budget");
    ids.add(font.id);
    fonts.push({
      id: font.id,
      packVersion: value.packVersion,
      label: font.label,
      sha256: font.sha256,
      sizeBytes: Number(font.sizeBytes),
      license: font.license,
      sourceUrl: font.sourceUrl,
    });
  }
  const unsigned = {
    format: value.format,
    version: value.version,
    packVersion: value.packVersion,
    fonts: fonts.map(({ packVersion: _version, ...font }) => font),
  };
  if (
    !verify(
      null,
      Buffer.from(JSON.stringify(unsigned)),
      input.publicKeyPem,
      Buffer.from(value.signature, "base64"),
    )
  )
    throw Error("Renderer font pack signature is invalid");
  const result: VerifiedRendererFont[] = [];
  const memberDirectory = join(input.root, "fonts");
  const directoryEntry = await lstat(memberDirectory);
  if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink())
    throw Error("Renderer font member directory must not be a symlink");
  for (const descriptor of fonts) {
    const artifact = await readBoundedRendererFontMember(
      join(input.root, "fonts", `${descriptor.id}.ttf`),
      32 * 1024 * 1024,
    );
    if (
      artifact.length !== descriptor.sizeBytes ||
      createHash("sha256").update(artifact).digest("hex") !== descriptor.sha256
    )
      throw Error(
        "Renderer font artifact does not match its signed complete byte identity",
      );
    const glyph = readFontGlyphMap(artifact);
    result.push(
      Object.freeze({
        descriptor: Object.freeze(descriptor),
        glyph,
        bytes: () => Buffer.from(artifact),
      }),
    );
  }
  const finalRoot = await lstat(input.root),
    finalDirectory = await lstat(memberDirectory);
  if (
    finalRoot.dev !== rootEntry.dev ||
    finalRoot.ino !== rootEntry.ino ||
    finalRoot.isSymbolicLink() ||
    finalDirectory.dev !== directoryEntry.dev ||
    finalDirectory.ino !== directoryEntry.ino ||
    finalDirectory.isSymbolicLink()
  )
    throw Error("Renderer font pack directories changed while freezing");
  return Object.freeze(result);
}
