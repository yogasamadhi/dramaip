import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import {
  canonicalJson,
  sha256,
  signCanonical,
  verifyCanonical,
} from "./crypto.js";
import { parseExtensionManifest, type ExtensionManifest } from "./manifest.js";

export interface ExtensionPackageFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface ExtensionPackageSignature {
  readonly publisherId: string;
  readonly keyId: string;
  readonly signature: string;
}

export interface VerifiedExtensionPackage {
  readonly manifest: ExtensionManifest;
  readonly files: readonly ExtensionPackageFile[];
  readonly contentHash: string;
  readonly bundle: string;
  readonly signature: ExtensionPackageSignature;
}

const MAX_FILES = 5_000;
const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const PackageFileSchema = z
  .object({
    name: z.string().min(1).max(240),
    size: z.number().int().nonnegative().max(MAX_UNPACKED_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const PackageSignatureSchema = z
  .object({
    publisherId: z.string().min(1).max(100),
    keyId: z.string().min(3).max(100),
    signature: z.string().min(40).max(1_000),
  })
  .strict();

function safeName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 240 &&
    !name.startsWith("/") &&
    !name.startsWith("\\") &&
    !/^[A-Za-z]:/u.test(name) &&
    !name.split(/[\\/]/u).includes("..") &&
    !name.includes("\0")
  );
}

function inspectCentralDirectory(archive: Uint8Array): readonly string[] {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const mode = externalAttributes >>> 16;
    if ((mode & 0o170000) === 0o120000)
      throw new Error("Extension archives cannot contain symbolic links");
    const start = offset + 46;
    const end = start + nameLength;
    if (end > archive.byteLength)
      throw new Error("Invalid ZIP central directory");
    names.push(new TextDecoder().decode(archive.subarray(start, end)));
    offset = end + extraLength + commentLength - 1;
  }
  if (names.length === 0) throw new Error("Extension archive has no files");
  if (names.length > MAX_FILES)
    throw new Error("Extension archive has too many files");
  if (new Set(names).size !== names.length)
    throw new Error("Extension archive contains duplicate file names");
  if (names.some((name) => !safeName(name)))
    throw new Error("Extension archive contains an unsafe file name");
  return names;
}

function parseJson(value: Uint8Array | undefined, name: string): unknown {
  if (!value) throw new Error(`Extension archive is missing ${name}`);
  try {
    return JSON.parse(strFromU8(value));
  } catch {
    throw new Error(`Extension archive contains invalid ${name}`);
  }
}

export function verifyExtensionPackage(
  archive: Uint8Array,
  publisherPublicKeyPem: string,
): VerifiedExtensionPackage {
  if (archive.byteLength > MAX_COMPRESSED_BYTES)
    throw new Error("Extension archive exceeds the compressed size limit");
  inspectCentralDirectory(archive);
  let unpackedBytes = 0;
  const entries = unzipSync(archive, {
    filter(file) {
      unpackedBytes += file.originalSize;
      if (unpackedBytes > MAX_UNPACKED_BYTES)
        throw new Error("Extension archive exceeds the unpacked size limit");
      return true;
    },
  });
  const manifest = parseExtensionManifest(
    parseJson(entries["manifest.json"], "manifest.json"),
  );
  const files = z
    .array(PackageFileSchema)
    .max(MAX_FILES)
    .parse(parseJson(entries["files.json"], "files.json"));
  const signature = PackageSignatureSchema.parse(
    parseJson(entries["signature.json"], "signature.json"),
  );
  if (
    signature.publisherId !== manifest.publisher.id ||
    signature.keyId !== manifest.publisher.keyId
  )
    throw new Error(
      "Extension publisher identity does not match its signature",
    );
  const actualFiles = Object.entries(entries)
    .filter(([name]) => !["files.json", "signature.json"].includes(name))
    .map(([name, bytes]) => ({
      name,
      size: bytes.byteLength,
      sha256: sha256(bytes),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (canonicalJson(files) !== canonicalJson(actualFiles))
    throw new Error("Extension file manifest does not match archive contents");
  const signed = { manifest, files };
  if (!verifyCanonical(signed, signature.signature, publisherPublicKeyPem))
    throw new Error("Extension package signature is invalid");
  const bundleBytes = entries[manifest.entrypoint];
  if (!bundleBytes) throw new Error("Extension entrypoint is missing");
  return {
    manifest,
    files,
    signature,
    bundle: strFromU8(bundleBytes),
    contentHash: sha256(archive),
  };
}

export function createExtensionPackage(input: {
  readonly manifest: ExtensionManifest;
  readonly bundle: string;
  readonly privateKeyPem: string;
}): Uint8Array {
  const manifest = parseExtensionManifest(input.manifest);
  const contentEntries = {
    "manifest.json": strToU8(canonicalJson(manifest)),
    [manifest.entrypoint]: strToU8(input.bundle),
  };
  const files = Object.entries(contentEntries)
    .map(([name, bytes]) => ({
      name,
      size: bytes.byteLength,
      sha256: sha256(bytes),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const signature: ExtensionPackageSignature = {
    publisherId: manifest.publisher.id,
    keyId: manifest.publisher.keyId,
    signature: signCanonical({ manifest, files }, input.privateKeyPem),
  };
  const epoch = new Date("1980-01-01T00:00:00.000Z");
  return zipSync(
    Object.fromEntries(
      Object.entries({
        ...contentEntries,
        "files.json": strToU8(canonicalJson(files)),
        "signature.json": strToU8(canonicalJson(signature)),
      })
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, bytes]) => [name, [bytes, { mtime: epoch }]]),
    ),
    { level: 9 },
  );
}
