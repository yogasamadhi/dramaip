import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  foundationMigrations,
  openDatabase,
  type DatabaseHandle,
} from "@dramaip/database";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { extensionPlatformMigrations } from "./migrations.js";
import { ExtensionPlatform } from "./platform.js";

const manifest = (version: string) => ({
  schemaVersion: 1 as const,
  id: "official.dramaip.sample",
  name: "Sample",
  version,
  publisher: { id: "official.dramaip", keyId: "official-key" },
  pluginApi: "^1" as const,
  product: ">=3.0.0-alpha.3 <4",
  entrypoint: "dist/extension.js" as const,
  activation: "lazy" as const,
  permissions: ["storage.read", "storage.write", "extensions.route"] as const,
  networkOrigins: [],
  dependencies: [],
  serverContributions: [
    {
      id: "sample.echo",
      method: "patch" as const,
      path: "/echo/{id}",
      handler: "route.echo",
      requestSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } },
      },
      responseSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } },
      },
    },
  ],
  uiContributions: [],
  storage: {
    collections: [
      {
        name: "counters",
        schema: {
          type: "object",
          required: ["value"],
          additionalProperties: false,
          properties: { value: { type: "number" } },
        },
        indexes: [{ name: "by_value", path: "$.value", type: "number" }],
      },
    ],
  },
  resources: {
    memoryMiB: 64,
    maxConcurrentRequests: 4,
    requestsPerMinute: 100,
  },
});

describe("Extension Marketplace lifecycle", () => {
  let database: DatabaseHandle | undefined;
  afterEach(() => database?.close());

  it("installs atomically, binds capabilities, revokes and preserves the prior revision", async () => {
    database = openDatabase(":memory:");
    applyMigrations(database.sqlite, [
      ...foundationMigrations,
      ...extensionPlatformMigrations,
    ]);
    let capabilityToken = "";
    let failActivation = false;
    let registryOffline = false;
    const host = {
      fetchExtensionRegistry: vi.fn(async () => {
        if (registryOffline) throw new Error("fixture registry is offline");
        return {
          schemaVersion: 1,
          registryId: "official.dramaip",
          generatedAt: new Date().toISOString(),
          extensions: [
            {
              id: "official.dramaip.sample",
              name: "Sample",
              versions: [
                {
                  version: "2.0.0",
                  packageUrl:
                    "https://extensions.example/sample-2.dramaip-extension",
                  sha256: "2".repeat(64),
                  size: 1_024,
                  manifest: manifest("2.0.0"),
                  publisherPublicKey: "publisher-key",
                },
                {
                  version: "1.0.0",
                  packageUrl:
                    "https://extensions.example/sample-1.dramaip-extension",
                  sha256: "1".repeat(64),
                  size: 1_024,
                  manifest: manifest("1.0.0"),
                  publisherPublicKey: "publisher-key",
                },
              ],
            },
          ],
        };
      }),
      stageExtensionPackage: vi.fn(
        async (input: { expectedSha256: string }) => ({
          packageRef: `extpkg:${input.expectedSha256}`,
          contentHash: input.expectedSha256,
          manifest: {},
        }),
      ),
      activateExtension: vi.fn(async (input: { capabilityToken: string }) => {
        if (failActivation) throw new Error("fixture activation failed");
        capabilityToken = input.capabilityToken;
      }),
      stopExtension: vi.fn(async () => undefined),
      invokeExtension: vi.fn(
        async (input: { handlerId: string; payload: unknown }) =>
          input.handlerId === "route.echo" ? input.payload : null,
      ),
      saveTextFile: vi.fn(async () => ({
        saved: true,
        artifactRef: "artifact:1",
      })),
    } as unknown as DesktopHostClient;
    const platform = new ExtensionPlatform(database.uow, host);
    await platform.catalog({
      registryId: "official.dramaip",
      url: "https://extensions.example/index.json",
      keyId: "root-key",
      rootPublicKey: "root-public-key",
    });
    registryOffline = true;
    await expect(
      platform.catalog({
        registryId: "official.dramaip",
        url: "https://extensions.example/index.json",
        keyId: "root-key",
        rootPublicKey: "root-public-key",
      }),
    ).resolves.toMatchObject({ registryId: "official.dramaip" });
    const preview = platform.createPreview({
      registryId: "official.dramaip",
      pluginId: "official.dramaip.sample",
      version: "1.0.0",
    }) as { previewId: string; permissions: string[] };
    await platform.commit(
      preview.previewId,
      "http://127.0.0.1/extensions/v1/capabilities",
      preview.permissions,
    );
    await platform.broker.handle(`Bearer ${capabilityToken}`, {
      capability: "storage.write",
      input: {
        pluginId: "attacker.spoofed",
        collection: "counters",
        documentId: "main",
        value: { value: 1 },
      },
    });
    await expect(
      platform.broker.handle(`Bearer ${capabilityToken}`, {
        capability: "storage.read",
        input: { collection: "counters", documentId: "main" },
      }),
    ).resolves.toMatchObject({ value: { value: 1 }, version: 1 });
    expect(
      database.sqlite
        .prepare(
          `SELECT number_value FROM extension_document_index_values
           WHERE plugin_id = ? AND collection_name = ? AND index_name = ?`,
        )
        .get("official.dramaip.sample", "counters", "by_value"),
    ).toMatchObject({ number_value: 1 });
    await expect(
      platform.broker.handle(`Bearer ${capabilityToken}`, {
        capability: "storage.write",
        input: {
          collection: "counters",
          documentId: "invalid",
          value: { value: "not-a-number" },
        },
      }),
    ).rejects.toThrow(/schema type number/u);
    await expect(
      platform.invokeRouteByPath(
        "official.dramaip.sample",
        "patch",
        "/echo/42",
        { value: "namespaced" },
      ),
    ).resolves.toEqual({ value: "namespaced" });
    await expect(
      platform.invokeRouteByPath(
        "official.dramaip.sample",
        "post",
        "/echo/42",
        { value: "wrong method" },
      ),
    ).rejects.toThrow(/not declared/u);

    const update = platform.createPreview({
      registryId: "official.dramaip",
      pluginId: "official.dramaip.sample",
      version: "2.0.0",
    }) as { previewId: string; permissions: string[] };
    failActivation = true;
    await expect(
      platform.commit(
        update.previewId,
        "http://127.0.0.1/extensions/v1/capabilities",
        update.permissions,
      ),
    ).rejects.toThrow("fixture activation failed");
    expect(platform.listInstalled()).toMatchObject([
      { version: "1.0.0", state: "active" },
    ]);
    await expect(
      platform.broker.handle(`Bearer ${capabilityToken}`, {
        capability: "storage.read",
        input: { collection: "counters", documentId: "main" },
      }),
    ).resolves.toMatchObject({ value: { value: 1 } });
    expect(
      database.sqlite
        .prepare(
          "SELECT 1 FROM extension_documents WHERE plugin_id = 'attacker.spoofed'",
        )
        .get(),
    ).toBeUndefined();

    await platform.disable("official.dramaip.sample");
    await expect(
      platform.broker.handle(`Bearer ${capabilityToken}`, {
        capability: "storage.read",
        input: { collection: "counters", documentId: "main" },
      }),
    ).rejects.toThrow(/expired or revoked/u);
  });
});
