import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyRendererSidecarManifest } from "./ffprobe-sidecar";

describe("signed renderer sidecar manifest", () => {
  test("accepts only a project-signed, platform-pinned manifest", () => {
    const keys = generateKeyPairSync("ed25519");
    const unsigned = {
      version: "7.1.0",
      platform: process.platform,
      arch: process.arch,
      url: "https://artifacts.example.test/ffprobe",
      sha256: "a".repeat(64),
      license: "GPL-2.0-or-later",
      sourceUrl: "https://sources.example.test/ffmpeg-7.1.tar.xz",
      buildRecipeUrl: "https://sources.example.test/build-recipe.txt",
    };
    const signature = sign(
      null,
      Buffer.from(JSON.stringify(unsigned), "utf8"),
      keys.privateKey,
    ).toString("base64");
    const publicKeyPem = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();

    expect(
      verifyRendererSidecarManifest({ ...unsigned, signature }, publicKeyPem),
    ).toMatchObject(unsigned);
    expect(() =>
      verifyRendererSidecarManifest(
        { ...unsigned, sha256: "b".repeat(64), signature },
        publicKeyPem,
      ),
    ).toThrow("signature");
  });
});
