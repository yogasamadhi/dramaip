import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createExtensionPackage,
  parseExtensionManifest,
  QuickJsExtensionSandbox,
  verifyExtensionPackage,
  type ExtensionManifest,
} from "./index.js";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

const manifest: ExtensionManifest = parseExtensionManifest({
  schemaVersion: 1,
  id: "dramaip.example",
  name: "DramaIP Example",
  version: "1.0.0",
  publisher: { id: "dramaip.official", keyId: "official-test" },
  pluginApi: "^1",
  product: ">=3 <4",
  entrypoint: "dist/extension.js",
  activation: "startup",
  permissions: [
    "storage.read",
    "storage.write",
    "ui.contribute",
    "commands.register",
    "extensions.route",
  ],
  serverContributions: [
    {
      id: "echo",
      method: "post",
      path: "/echo",
      handler: "echo",
      responseSchema: { type: "object" },
    },
  ],
  uiContributions: [
    {
      id: "example.panel",
      kind: "panel",
      slot: "workspace.panels",
      title: "Example",
      command: "echo",
    },
  ],
  storage: {
    collections: [
      {
        name: "notes",
        schema: { type: "object" },
        indexes: [{ name: "title", path: "$.title", type: "string" }],
      },
    ],
  },
});

describe("Extension Platform conformance", () => {
  it("creates deterministic signed packages and verifies every content hash", () => {
    const key = keys();
    const input = {
      manifest,
      bundle: `dramaip.registerHandler("echo", async input => ({ input }));`,
      privateKeyPem: key.privateKey,
    };
    const first = createExtensionPackage(input);
    const second = createExtensionPackage(input);
    expect(first).toEqual(second);
    expect(verifyExtensionPackage(first, key.publicKey)).toMatchObject({
      manifest: { id: "dramaip.example", version: "1.0.0" },
    });
    const tampered = first.slice();
    tampered[Math.floor(tampered.length / 2)]! ^= 1;
    expect(() => verifyExtensionPackage(tampered, key.publicKey)).toThrow();
  });

  it("runs handlers inside QuickJS with only the injected capability bridge", async () => {
    const calls: unknown[] = [];
    const sandbox = await QuickJsExtensionSandbox.create({
      bundle: `
        dramaip.registerHandler("inspect", async input => ({
          input,
          processType: typeof process,
          requireType: typeof require,
          fetchType: typeof fetch,
          stored: await dramaip.capability("storage.read", { id: "one" }),
        }));
      `,
      bridge: async (call) => {
        calls.push(call);
        return { title: "sandboxed" };
      },
    });
    await expect(sandbox.invoke("inspect", { ok: true })).resolves.toEqual({
      input: { ok: true },
      processType: "undefined",
      requireType: "undefined",
      fetchType: "undefined",
      stored: { title: "sandboxed" },
    });
    expect(calls).toEqual([
      { capability: "storage.read", payload: { id: "one" } },
    ]);
    sandbox.dispose();
  });
});
