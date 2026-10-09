import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Synthetic cmap/maxp only, deliberately not a font that a native rasterizer can render. */
export function fontFixture(format: 4 | 12 = 12, glyphArray = false): Buffer {
  let map: Buffer;
  if (format === 12) {
    map = Buffer.alloc(16 + 3 * 12);
    map.writeUInt16BE(12, 0);
    map.writeUInt32BE(map.length, 4);
    map.writeUInt32BE(3, 12);
    for (const [n, [start, end, glyph]] of [
      [0x41, 0x43, 1],
      [0x5b57, 0x5b57, 4],
      [0x1f600, 0x1f600, 5],
    ].entries()) {
      const at = 16 + n * 12;
      map.writeUInt32BE(start!, at);
      map.writeUInt32BE(end!, at + 4);
      map.writeUInt32BE(glyph!, at + 8);
    }
  } else {
    map = Buffer.alloc(40 + (glyphArray ? 6 : 0));
    map.writeUInt16BE(4, 0);
    map.writeUInt16BE(map.length, 2);
    map.writeUInt16BE(6, 6);
    [0x43, 0x5b57, 0xffff].forEach((value, n) =>
      map.writeUInt16BE(value, 14 + n * 2),
    );
    [0x41, 0x5b57, 0xffff].forEach((value, n) =>
      map.writeUInt16BE(value, 22 + n * 2),
    );
    [glyphArray ? 1 : -64, 4 - 0x5b57, 1].forEach((value, n) =>
      map.writeInt16BE(value, 28 + n * 2),
    );
    if (glyphArray) {
      map.writeUInt16BE(6, 34); // Pointer relative to this idRangeOffset word.
      [5, 0, 6].forEach((value, n) => map.writeUInt16BE(value, 40 + n * 2));
    }
  }
  const cmapLength = 12 + map.length,
    maxpOffset = 44 + cmapLength;
  const bytes = Buffer.alloc(maxpOffset + 6);
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(2, 4);
  bytes.write("cmap", 12, "ascii");
  bytes.writeUInt32BE(44, 20);
  bytes.writeUInt32BE(cmapLength, 24);
  bytes.write("maxp", 28, "ascii");
  bytes.writeUInt32BE(maxpOffset, 36);
  bytes.writeUInt32BE(6, 40);
  bytes.writeUInt16BE(1, 46);
  bytes.writeUInt16BE(3, 48);
  bytes.writeUInt16BE(format === 12 ? 10 : 1, 50);
  bytes.writeUInt32BE(12, 52);
  map.copy(bytes, 56);
  bytes.writeUInt32BE(0x00005000, maxpOffset);
  bytes.writeUInt16BE(16, maxpOffset + 4);
  return bytes;
}

export const FONT_FIXTURE_ID = "77777777-7777-4777-8777-777777777777";
export const fontSha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function signedFontFixture(root: string, bytes = fontFixture()) {
  const keys = generateKeyPairSync("ed25519");
  const unsigned = {
    format: "dramaip-renderer-font-pack",
    version: 1,
    packVersion: "0.0.0-local-test",
    fonts: [
      {
        id: FONT_FIXTURE_ID,
        label: "Controlled font fixture",
        sha256: fontSha(bytes),
        sizeBytes: bytes.length,
        license: "LOCAL-TEST-ONLY-NOT-DISTRIBUTION",
        sourceUrl: "https://fixtures.invalid/font",
      },
    ],
  };
  const persist = async (value: unknown = unsigned) => {
    const manifest = {
      ...(value as object),
      signature: sign(
        null,
        Buffer.from(JSON.stringify(value)),
        keys.privateKey,
      ).toString("base64"),
    };
    await writeFile(
      join(root, "fonts-manifest.json"),
      JSON.stringify(manifest),
    );
    return manifest;
  };
  await mkdir(join(root, "fonts"));
  const path = join(root, "fonts", `${FONT_FIXTURE_ID}.ttf`);
  await writeFile(path, bytes);
  await persist();
  return {
    path,
    unsigned,
    persist,
    publicKeyPem: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}
