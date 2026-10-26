import assert from "node:assert/strict";
import { test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  link,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVerifiedRendererFonts } from "./renderer-fonts";
import { fontSha, signedFontFixture } from "./renderer-font.fixture";

async function fixture(
  run: (
    root: string,
    value: Awaited<ReturnType<typeof signedFontFixture>>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-font-unit-"));
  try {
    await run(root, await signedFontFixture(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("missing configured key, pack root or manifest means no capability, never OS font search", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-font-missing-"));
  try {
    const publicKeyPem = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    assert.deepEqual(await loadVerifiedRendererFonts({ root }), []);
    assert.deepEqual(
      await loadVerifiedRendererFonts({ root, publicKeyPem }),
      [],
    );
    assert.deepEqual(
      await loadVerifiedRendererFonts({
        root: join(root, "absent"),
        publicKeyPem,
      }),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("signed complete font identity yields immutable descriptor and independent private bytes", async () =>
  fixture(async (root, f) => {
    const fonts = await loadVerifiedRendererFonts({
      root,
      publicKeyPem: f.publicKeyPem,
    });
    assert.equal(fonts.length, 1);
    assert(Object.isFrozen(fonts));
    assert(Object.isFrozen(fonts[0]));
    assert(Object.isFrozen(fonts[0]!.descriptor));
    const original = fonts[0]!.bytes();
    fonts[0]!.bytes().fill(0);
    assert.deepEqual(fonts[0]!.bytes(), original);
    assert.equal(fonts[0]!.glyph(0x5b57), 4);
    assert.equal(fonts[0]!.descriptor.packVersion, "0.0.0-local-test");
  }));
test("different signing key and post-signature descriptor tampering reject the whole pack", async () =>
  fixture(async (root, f) => {
    const other = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: other }),
      /signature/u,
    );
    const value = JSON.parse(
      await readFile(join(root, "fonts-manifest.json"), "utf8"),
    );
    value.fonts[0].label = "Changed label";
    await writeFile(join(root, "fonts-manifest.json"), JSON.stringify(value));
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /signature/u,
    );
  }));
test("complete same-size byte tampering and signed unsupported face cannot pass original artifact identity", async () =>
  fixture(async (root, f) => {
    const original = await readFile(f.path),
      changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    await writeFile(f.path, changed);
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /complete byte identity/u,
    );
    await writeFile(f.path, original.subarray(0, original.length - 1));
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /complete byte identity/u,
    );
    const collection = Buffer.from(original);
    collection.write("ttcf", 0, "ascii");
    await writeFile(f.path, collection);
    await f.persist({
      ...f.unsigned,
      fonts: [{ ...f.unsigned.fonts[0], sha256: fontSha(collection) }],
    });
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /collection/u,
    );
  }));
test("signed malformed descriptors, credentials, duplicate IDs and unknown path fields never read members", async () =>
  fixture(async (root, f) => {
    for (const value of [
      { ...f.unsigned, version: 2 },
      { ...f.unsigned, path: "/private" },
      { ...f.unsigned, fonts: [f.unsigned.fonts[0], f.unsigned.fonts[0]] },
      {
        ...f.unsigned,
        fonts: [
          {
            ...f.unsigned.fonts[0],
            sourceUrl: "https://user:secret@fixtures.invalid/font",
          },
        ],
      },
      {
        ...f.unsigned,
        fonts: [{ ...f.unsigned.fonts[0], sizeBytes: 32 * 1024 * 1024 + 1 }],
      },
      { ...f.unsigned, fonts: [{ ...f.unsigned.fonts[0], path: "/private" }] },
    ]) {
      await f.persist(value);
      await assert.rejects(
        loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      );
    }
  }));
test("font member symlink and hard link cannot masquerade as ordinary pack members", async () =>
  fixture(async (root, f) => {
    const original = join(root, "original.ttf");
    await rename(f.path, original);
    await symlink(original, f.path);
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /regular member/u,
    );
    await rm(f.path);
    await link(original, f.path);
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /regular member/u,
    );
  }));
test("symlinked pack root and font directory reject instead of traversing outside members", async () =>
  fixture(async (root, f) => {
    const rootLink = join(root, "root-link");
    await symlink(root, rootLink, "dir");
    await assert.rejects(
      loadVerifiedRendererFonts({
        root: rootLink,
        publicKeyPem: f.publicKeyPem,
      }),
      /ordinary directory/u,
    );
    await rename(join(root, "fonts"), join(root, "real-fonts"));
    await symlink(join(root, "real-fonts"), join(root, "fonts"), "dir");
    await assert.rejects(
      loadVerifiedRendererFonts({ root, publicKeyPem: f.publicKeyPem }),
      /symlink/u,
    );
  }));
