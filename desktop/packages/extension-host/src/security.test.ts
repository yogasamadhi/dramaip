import { generateKeyPairSync } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { QuickJsExtensionSandbox } from "./sandbox.js";
import { parseExtensionManifest } from "./manifest.js";
import { verifyExtensionPackage } from "./package.js";
import { createExtensionPackage } from "./package.js";
import { ExtensionRevisionSupervisor } from "./supervisor.js";

describe("Extension sandbox security limits", () => {
  it("interrupts infinite synchronous work and permanently fails the revision", async () => {
    const sandbox = await QuickJsExtensionSandbox.create({
      bundle: `dramaip.registerHandler("loop", async () => { while (true) {} });`,
      bridge: async () => undefined,
      limits: { synchronousTimeoutMs: 20, requestTimeoutMs: 100 },
    });
    await expect(sandbox.invoke("loop", null)).rejects.toThrow();
    expect(sandbox.diagnostics().state).toBe("failed");
  });

  it("rejects payload and concurrency abuse at the host boundary", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sandbox = await QuickJsExtensionSandbox.create({
      bundle: `dramaip.registerHandler("wait", async input => dramaip.capability("wait", input));`,
      bridge: async () => {
        await blocked;
        return true;
      },
      limits: { maximumConcurrentRequests: 1, maximumPayloadBytes: 100 },
    });
    const first = sandbox.invoke("wait", { ok: true });
    await expect(sandbox.invoke("wait", { second: true })).rejects.toThrow(
      "concurrency",
    );
    await expect(
      sandbox.invoke("wait", { text: "x".repeat(200) }),
    ).rejects.toThrow("payload");
    release();
    await expect(first).resolves.toBe(true);
    sandbox.dispose();
  });

  it("terminates an activation promise that never settles", async () => {
    await expect(
      QuickJsExtensionSandbox.create({
        bundle: `
          dramaip.registerHandler("ready", async () => true);
          globalThis.__dramaipActivation = new Promise(() => {});
        `,
        bridge: async () => undefined,
        limits: { requestTimeoutMs: 30 },
      }),
    ).rejects.toThrow(/activation timed out/u);
  });

  it("rejects path traversal archives before extraction", () => {
    const archive = zipSync({
      "../escape": strToU8("forbidden"),
      "manifest.json": strToU8("{}"),
    });
    const key = generateKeyPairSync("ed25519")
      .publicKey.export({
        type: "spki",
        format: "pem",
      })
      .toString();
    expect(() => verifyExtensionPackage(archive, key)).toThrow(
      /unsafe file name/u,
    );
  });

  it("rejects schema bombs and executable UI metadata", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 30; index += 1)
      nested = { type: "object", properties: { child: nested } };
    const base = {
      schemaVersion: 1,
      id: "malicious.example",
      name: "Malicious",
      version: "1.0.0",
      publisher: { id: "malicious.example", keyId: "malicious-key" },
      pluginApi: "^1",
      product: ">=3 <4",
      entrypoint: "dist/extension.js",
      activation: "lazy",
      permissions: ["ui.contribute"],
      dependencies: [],
      serverContributions: [],
      uiContributions: [],
      storage: { collections: [] },
      resources: {
        memoryMiB: 64,
        maxConcurrentRequests: 4,
        requestsPerMinute: 100,
      },
    };
    expect(() =>
      parseExtensionManifest({
        ...base,
        storage: {
          collections: [{ name: "bomb", schema: nested, indexes: [] }],
        },
      }),
    ).toThrow(/too deep/u);
    expect(() =>
      parseExtensionManifest({
        ...base,
        uiContributions: [
          {
            id: "malicious.panel",
            kind: "panel",
            slot: "workspace.panels",
            title: "Malicious",
            html: "<script>steal()</script>",
            iframeUrl: "https://malicious.example",
          },
        ],
      }),
    ).toThrow();
  });

  it("quarantines a revision after five sandbox crashes in five minutes", async () => {
    const keys = generateKeyPairSync("ed25519");
    const extensionPackage = verifyExtensionPackage(
      createExtensionPackage({
        manifest: parseExtensionManifest({
          schemaVersion: 1,
          id: "malicious.crash-loop",
          name: "Crash loop",
          version: "1.0.0",
          publisher: { id: "malicious.example", keyId: "malicious-key" },
          pluginApi: "^1",
          product: ">=3 <4",
          entrypoint: "dist/extension.js",
          activation: "startup",
          permissions: [],
        }),
        bundle: `dramaip.registerHandler("loop", async () => { while (true) {} });`,
        privateKeyPem: keys.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      }),
      keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    const supervisor = new ExtensionRevisionSupervisor(
      extensionPackage,
      async () => null,
      { synchronousTimeoutMs: 20, requestTimeoutMs: 100 },
    );
    for (let crash = 0; crash < 5; crash += 1) {
      await supervisor.start();
      await expect(supervisor.invoke("loop", null)).rejects.toThrow();
    }
    expect(supervisor.diagnostics()).toMatchObject({
      state: "quarantined",
      restartCount: 5,
    });
    await expect(supervisor.start()).rejects.toThrow(/quarantined/u);
    supervisor.retry();
    expect(supervisor.diagnostics()).toMatchObject({
      state: "disabled",
      restartCount: 0,
    });
  });
});
