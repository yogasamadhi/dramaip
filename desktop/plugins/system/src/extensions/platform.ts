import { createHash, randomUUID } from "node:crypto";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  DRAMAIP_RUNTIME_VERSION,
  type DomainEvent,
  type JsonValue,
} from "@dramaip/contracts";
import {
  ExtensionManifestSchema,
  ExtensionRegistryPayloadSchema,
  type ExtensionManifest,
  type ExtensionRegistryPayload,
} from "@dramaip/extension-host";
import type {
  Cleanup,
  EventRuntime,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";
import { ExtensionCapabilityBroker } from "./broker.js";
import { assertJsonSchemaValue } from "./json-schema.js";

interface InstalledRow {
  plugin_id: string;
  current_revision_id: string | null;
  state: string;
  permission_revision: number;
  version: string | null;
  manifest_json: string | null;
  updated_at: string;
}

interface PreviewRow {
  preview_id: string;
  operation: "install" | "update";
  plugin_id: string;
  registry_id: string;
  package_url: string;
  package_sha256: string;
  publisher_id: string;
  publisher_public_key_pem: string;
  manifest_json: string;
  requested_permissions_json: string;
  expires_at: string;
  committed_at: string | null;
}

interface RevisionRow {
  revision_id: string;
  plugin_id: string;
  version: string;
  package_ref: string;
  publisher_public_key_pem: string;
  manifest_json: string;
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function versionParts(value: string): readonly number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (!match) throw new Error(`Unsupported semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersion(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference) return difference;
  }
  return 0;
}

function satisfiesRange(version: string, range: string): boolean {
  if (range.startsWith("^")) {
    const floor = range.slice(1);
    return (
      versionParts(version)[0] === versionParts(floor)[0] &&
      compareVersion(version, floor) >= 0
    );
  }
  if (/^\d+\.\d+\.\d+/u.test(range))
    return compareVersion(version, range) === 0;
  const floor = />=\s*([^\s]+)/u.exec(range)?.[1];
  const ceiling = /<\s*(\d+)(?:\.\d+\.\d+)?/u.exec(range)?.[1];
  return (
    (!floor || compareVersion(version, floor) >= 0) &&
    (!ceiling || versionParts(version)[0]! < Number(ceiling))
  );
}

export class ExtensionPlatform {
  readonly broker: ExtensionCapabilityBroker;
  private eventRuntime: EventRuntime | undefined;
  private readonly eventConsumers = new Map<string, Cleanup>();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly host?: DesktopHostClient,
  ) {
    this.broker = new ExtensionCapabilityBroker(uow, host);
    this.broker.setManifestResolver((_pluginId, revision) =>
      ExtensionManifestSchema.parse(
        JSON.parse(this.revision(revision).manifest_json),
      ),
    );
  }

  attachEventRuntime(events: EventRuntime): Cleanup {
    this.eventRuntime = events;
    for (const value of this.listInstalled()) {
      const installed = value as { pluginId: string; state: string };
      if (installed.state === "active")
        this.reconcileEventConsumer(installed.pluginId);
    }
    return () => {
      if (this.eventRuntime === events) this.eventRuntime = undefined;
      for (const cleanup of this.eventConsumers.values()) cleanup();
      this.eventConsumers.clear();
    };
  }

  async restoreActive(capabilityEndpoint: string): Promise<void> {
    const active = this.listInstalled()
      .map((value) => value as { pluginId: string; state: string })
      .filter((value) => value.state === "active");
    for (const extension of active) {
      try {
        await this.enable(extension.pluginId, capabilityEndpoint);
      } catch {
        // A third-party failure degrades only that extension. enable() records
        // the state and Core Runtime remains available.
      }
    }
  }

  listInstalled(): readonly JsonValue[] {
    return this.uow.execute((transaction) =>
      transaction
        .all<InstalledRow>(
          `SELECT i.plugin_id, i.current_revision_id, i.state,
                  i.permission_revision, r.version, r.manifest_json, i.updated_at
           FROM installed_extensions i
           LEFT JOIN extension_revisions r ON r.revision_id = i.current_revision_id
           ORDER BY i.plugin_id`,
        )
        .map((row) => ({
          pluginId: row.plugin_id,
          revisionId: row.current_revision_id,
          version: row.version,
          state: row.state,
          permissionRevision: row.permission_revision,
          updatedAt: row.updated_at,
          manifest: row.manifest_json
            ? (JSON.parse(row.manifest_json) as JsonValue)
            : null,
        })),
    );
  }

  diagnostics(): JsonValue {
    const graph = this.listInstalled()
      .map((value) => value as Record<string, JsonValue>)
      .map((value) => ({
        pluginId: value.pluginId,
        revisionId: value.revisionId,
        state: value.state,
        permissionRevision: value.permissionRevision,
      }));
    const canonical = JSON.stringify(
      [...graph].sort((left, right) =>
        String(left.pluginId).localeCompare(String(right.pluginId)),
      ),
    );
    return {
      graphRevision: createHash("sha256").update(canonical).digest("hex"),
      installed: graph,
      capabilities: this.broker.diagnostics(),
      eventConsumerCount: this.eventConsumers.size,
    };
  }

  async catalog(input: {
    registryId: string;
    url: string;
    keyId: string;
    rootPublicKey: string;
  }): Promise<ExtensionRegistryPayload> {
    if (!this.host) throw new Error("Extension Registry requires Desktop Host");
    let payload: ExtensionRegistryPayload;
    try {
      payload = ExtensionRegistryPayloadSchema.parse(
        await this.host.fetchExtensionRegistry({
          url: input.url,
          keyId: input.keyId,
          rootPublicKey: input.rootPublicKey,
        }),
      );
    } catch (error) {
      const cached = this.uow.execute((transaction) =>
        transaction.get<{
          url: string;
          key_id: string;
          root_public_key_pem: string;
          cached_payload_json: string | null;
        }>(
          `SELECT url, key_id, root_public_key_pem, cached_payload_json
           FROM extension_registry_sources
           WHERE registry_id = ? AND enabled = 1`,
          input.registryId,
        ),
      );
      if (
        !cached?.cached_payload_json ||
        cached.url !== input.url ||
        cached.key_id !== input.keyId ||
        cached.root_public_key_pem !== input.rootPublicKey
      )
        throw error;
      payload = ExtensionRegistryPayloadSchema.parse(
        JSON.parse(cached.cached_payload_json),
      );
    }
    if (payload.registryId !== input.registryId)
      throw new Error("Extension Registry identity mismatch");
    const now = new Date().toISOString();
    this.uow.execute((transaction) =>
      transaction.run(
        `INSERT INTO extension_registry_sources(
          registry_id, url, key_id, root_public_key_pem, enabled,
          cached_payload_json, cached_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(registry_id) DO UPDATE SET
          url = excluded.url,
          key_id = excluded.key_id,
          root_public_key_pem = excluded.root_public_key_pem,
          enabled = 1,
          cached_payload_json = excluded.cached_payload_json,
          cached_at = excluded.cached_at,
          updated_at = excluded.updated_at`,
        input.registryId,
        input.url,
        input.keyId,
        input.rootPublicKey,
        JSON.stringify(payload),
        now,
        now,
        now,
      ),
    );
    return payload;
  }

  cachedCatalog(registryId: string): ExtensionRegistryPayload | undefined {
    return this.uow.execute((transaction) => {
      const row = transaction.get<{ cached_payload_json: string | null }>(
        `SELECT cached_payload_json FROM extension_registry_sources
         WHERE registry_id = ? AND enabled = 1`,
        registryId,
      );
      return row?.cached_payload_json
        ? ExtensionRegistryPayloadSchema.parse(
            JSON.parse(row.cached_payload_json),
          )
        : undefined;
    });
  }

  createPreview(input: {
    registryId: string;
    pluginId: string;
    version?: string;
  }): JsonValue {
    const catalog = this.cachedCatalog(input.registryId);
    if (!catalog) throw new Error("Extension Registry has no verified cache");
    const entry = catalog.extensions.find(
      (value) => value.id === input.pluginId,
    );
    if (!entry) throw new Error("Extension is not present in Registry");
    const release = input.version
      ? entry.versions.find((value) => value.version === input.version)
      : entry.versions[0];
    if (!release)
      throw new Error("Extension version is not present in Registry");
    const installed = this.installed(input.pluginId);
    this.assertCompatible(release.manifest);
    const currentRevision = installed?.revisionId
      ? this.revision(installed.revisionId)
      : undefined;
    const publisherChange = Boolean(
      currentRevision &&
      (currentRevision.publisher_public_key_pem !==
        release.publisherPublicKey ||
        installed?.manifest?.publisher.id !== release.manifest.publisher.id),
    );
    const previewId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    this.uow.execute((transaction) =>
      transaction.run(
        `INSERT INTO extension_install_previews(
          preview_id, operation, plugin_id, registry_id, package_url,
          package_sha256, publisher_id, publisher_public_key_pem,
          manifest_json, requested_permissions_json, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        previewId,
        installed ? "update" : "install",
        input.pluginId,
        input.registryId,
        release.packageUrl,
        release.sha256,
        release.manifest.publisher.id,
        release.publisherPublicKey,
        JSON.stringify(release.manifest),
        JSON.stringify(release.manifest.permissions),
        expiresAt,
        now.toISOString(),
      ),
    );
    const currentPermissions = new Set(installed?.manifest?.permissions ?? []);
    return jsonValue({
      previewId,
      operation: installed ? "update" : "install",
      pluginId: input.pluginId,
      version: release.version,
      publisher: release.manifest.publisher,
      permissions: release.manifest.permissions,
      permissionExpansion: release.manifest.permissions.filter(
        (permission) => !currentPermissions.has(permission),
      ),
      publisherChange,
      uiContributions: release.manifest.uiContributions,
      serverContributions: release.manifest.serverContributions,
      expiresAt,
    });
  }

  async commit(
    previewId: string,
    capabilityEndpoint: string,
    approvedPermissions: readonly string[],
    traceId?: string,
    approvedPublisherChange = false,
    approvedScopes: Readonly<Record<string, JsonValue>> = {},
  ): Promise<JsonValue> {
    if (!this.host)
      throw new Error("Extension activation requires Desktop Host");
    const preview = this.preview(previewId);
    if (preview.committed_at)
      return jsonValue(this.installed(preview.plugin_id)!);
    if (Date.parse(preview.expires_at) <= Date.now())
      throw new Error("Extension installation preview expired");
    const manifest = ExtensionManifestSchema.parse(
      JSON.parse(preview.manifest_json),
    );
    this.assertCompatible(manifest);
    const currentRevision = this.installed(preview.plugin_id)?.revisionId;
    if (currentRevision) {
      const current = this.revision(currentRevision);
      if (
        current.publisher_public_key_pem !== preview.publisher_public_key_pem &&
        !approvedPublisherChange
      )
        throw new Error(
          "Extension publisher or signing key changed and requires confirmation",
        );
    }
    if (
      manifest.permissions.length !== approvedPermissions.length ||
      manifest.permissions.some((value) => !approvedPermissions.includes(value))
    )
      throw new Error("Approved permissions do not match the signed manifest");
    const staged = await this.host.stageExtensionPackage({
      packageUrl: preview.package_url,
      expectedSha256: preview.package_sha256,
      publisherPublicKey: preview.publisher_public_key_pem,
    });
    const revisionId = staged.contentHash;
    const previous = this.installed(preview.plugin_id);
    const permissionRevision = (previous?.permissionRevision ?? 0) + 1;
    const now = new Date().toISOString();
    this.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO extension_publishers(
          publisher_id, display_name, public_key_pem, trust_state, created_at, updated_at
        ) VALUES (?, ?, ?, 'trusted', ?, ?)
        ON CONFLICT(publisher_id) DO UPDATE SET
          public_key_pem = excluded.public_key_pem,
          trust_state = 'trusted',
          updated_at = excluded.updated_at`,
        preview.publisher_id,
        preview.publisher_id,
        preview.publisher_public_key_pem,
        now,
        now,
      );
      transaction.run(
        `INSERT INTO installed_extensions(
          plugin_id, current_revision_id, state, permission_revision, installed_at, updated_at
        ) VALUES (?, NULL, 'disabled', ?, ?, ?)
        ON CONFLICT(plugin_id) DO UPDATE SET
          permission_revision = excluded.permission_revision,
          updated_at = excluded.updated_at`,
        preview.plugin_id,
        permissionRevision,
        now,
        now,
      );
      transaction.run(
        `INSERT INTO extension_revisions(
          revision_id, plugin_id, version, package_ref, package_sha256,
          publisher_id, publisher_public_key_pem, manifest_json, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)`,
        revisionId,
        preview.plugin_id,
        manifest.version,
        staged.packageRef,
        preview.package_sha256,
        preview.publisher_id,
        preview.publisher_public_key_pem,
        JSON.stringify(manifest),
        now,
      );
      for (const permission of approvedPermissions)
        transaction.run(
          `INSERT INTO extension_grants(
            plugin_id, permission_revision, permission, scope_json, granted_at
          ) VALUES (?, ?, ?, ?, ?)`,
          preview.plugin_id,
          permissionRevision,
          permission,
          JSON.stringify(approvedScopes[permission] ?? {}),
          now,
        );
    });
    const token = this.broker.issue({
      pluginId: preview.plugin_id,
      revision: revisionId,
      permissionRevision,
      permissions: approvedPermissions,
      scopes: approvedScopes,
      networkOrigins: manifest.networkOrigins.map(
        (value) => new URL(value).origin,
      ),
    });
    try {
      await this.host.activateExtension({
        pluginId: preview.plugin_id,
        packageRef: staged.packageRef,
        publisherPublicKey: preview.publisher_public_key_pem,
        capabilityEndpoint,
        capabilityToken: token,
        permissionRevision,
      });
      this.uow.execute((transaction) => {
        if (previous?.revisionId)
          transaction.run(
            "UPDATE extension_revisions SET state = 'superseded' WHERE revision_id = ?",
            previous.revisionId,
          );
        transaction.run(
          `UPDATE extension_revisions SET state = 'healthy', activated_at = ?
           WHERE revision_id = ?`,
          now,
          revisionId,
        );
        transaction.run(
          `UPDATE installed_extensions SET current_revision_id = ?, state = 'active', updated_at = ?
           WHERE plugin_id = ?`,
          revisionId,
          now,
          preview.plugin_id,
        );
        transaction.run(
          "UPDATE extension_install_previews SET committed_at = ? WHERE preview_id = ?",
          now,
          previewId,
        );
      });
      this.audit(
        preview.plugin_id,
        revisionId,
        preview.operation,
        "success",
        traceId,
      );
      this.broker.retainRevision(preview.plugin_id, revisionId);
      this.reconcileEventConsumer(preview.plugin_id);
    } catch (error) {
      this.broker.revokeRevision(preview.plugin_id, revisionId);
      this.uow.execute((transaction) =>
        transaction.run(
          `UPDATE extension_revisions SET state = 'failed', failure = ? WHERE revision_id = ?`,
          error instanceof Error ? error.message : String(error),
          revisionId,
        ),
      );
      this.audit(
        preview.plugin_id,
        revisionId,
        preview.operation,
        "failed",
        traceId,
      );
      throw error;
    }
    return jsonValue(this.installed(preview.plugin_id)!);
  }

  async disable(pluginId: string): Promise<void> {
    this.eventConsumers.get(pluginId)?.();
    this.eventConsumers.delete(pluginId);
    this.broker.revoke(pluginId);
    await this.host?.stopExtension(pluginId);
    this.uow.execute((transaction) =>
      transaction.run(
        "UPDATE installed_extensions SET state = 'disabled', updated_at = ? WHERE plugin_id = ?",
        new Date().toISOString(),
        pluginId,
      ),
    );
  }

  async enable(
    pluginId: string,
    capabilityEndpoint: string,
  ): Promise<JsonValue> {
    if (!this.host)
      throw new Error("Extension activation requires Desktop Host");
    const installed = this.installed(pluginId);
    if (!installed?.revisionId) throw new Error("Extension is not installed");
    const revision = this.revision(installed.revisionId);
    const manifest = ExtensionManifestSchema.parse(
      JSON.parse(revision.manifest_json),
    );
    const token = this.broker.issue({
      pluginId,
      revision: revision.revision_id,
      permissionRevision: installed.permissionRevision,
      ...this.grants(pluginId, installed.permissionRevision),
      networkOrigins: manifest.networkOrigins.map(
        (value) => new URL(value).origin,
      ),
    });
    try {
      await this.host.activateExtension({
        pluginId,
        packageRef: revision.package_ref,
        publisherPublicKey: revision.publisher_public_key_pem,
        capabilityEndpoint,
        capabilityToken: token,
        permissionRevision: installed.permissionRevision,
      });
    } catch (error) {
      this.broker.revokeToken(token);
      const state =
        error instanceof Error && /quarantined/u.test(error.message)
          ? "quarantined"
          : "degraded";
      this.uow.execute((transaction) =>
        transaction.run(
          "UPDATE installed_extensions SET state = ?, updated_at = ? WHERE plugin_id = ?",
          state,
          new Date().toISOString(),
          pluginId,
        ),
      );
      throw error;
    }
    this.uow.execute((transaction) =>
      transaction.run(
        "UPDATE installed_extensions SET state = 'active', updated_at = ? WHERE plugin_id = ?",
        new Date().toISOString(),
        pluginId,
      ),
    );
    this.broker.retainRevision(pluginId, revision.revision_id);
    this.reconcileEventConsumer(pluginId);
    return jsonValue(this.installed(pluginId)!);
  }

  async retry(
    pluginId: string,
    capabilityEndpoint: string,
  ): Promise<JsonValue> {
    if (!this.host) throw new Error("Extension retry requires Desktop Host");
    await this.host.retryExtension(pluginId);
    return this.enable(pluginId, capabilityEndpoint);
  }

  async rollback(
    pluginId: string,
    capabilityEndpoint: string,
  ): Promise<JsonValue> {
    const current = this.installed(pluginId);
    if (!current?.revisionId) throw new Error("Extension is not installed");
    const target = this.uow.execute((transaction) =>
      transaction.get<{ revision_id: string }>(
        `SELECT revision_id FROM extension_revisions
         WHERE plugin_id = ? AND revision_id <> ? AND state IN ('healthy', 'superseded')
         ORDER BY created_at DESC LIMIT 1`,
        pluginId,
        current.revisionId,
      ),
    );
    if (!target) throw new Error("Extension has no rollback revision");
    this.uow.execute((transaction) =>
      transaction.run(
        `UPDATE installed_extensions SET current_revision_id = ?, state = 'disabled', updated_at = ?
         WHERE plugin_id = ?`,
        target.revision_id,
        new Date().toISOString(),
        pluginId,
      ),
    );
    try {
      return await this.enable(pluginId, capabilityEndpoint);
    } catch (error) {
      this.uow.execute((transaction) =>
        transaction.run(
          `UPDATE installed_extensions SET current_revision_id = ?, state = 'degraded', updated_at = ?
           WHERE plugin_id = ?`,
          current.revisionId,
          new Date().toISOString(),
          pluginId,
        ),
      );
      throw error;
    }
  }

  async uninstall(
    pluginId: string,
    data: "delete" | "export" | "keep",
  ): Promise<JsonValue> {
    await this.disable(pluginId);
    let artifactRef: string | undefined;
    if (data === "export") {
      if (!this.host)
        throw new Error("Extension data export requires Desktop Host");
      const documents = this.uow.execute((transaction) =>
        transaction.all<Record<string, unknown>>(
          `SELECT collection_name, document_id, document_json, version, created_at, updated_at
           FROM extension_documents WHERE plugin_id = ?
           ORDER BY collection_name, document_id`,
          pluginId,
        ),
      );
      const saved = await this.host.saveTextFile({
        suggestedName: `${pluginId}-extension-data.json`,
        content: JSON.stringify({ pluginId, documents }, null, 2),
      });
      if (!saved.saved || !saved.artifactRef)
        throw new Error("Extension data export was canceled");
      artifactRef = saved.artifactRef;
    }
    this.uow.execute((transaction) => {
      if (data === "delete") {
        transaction.run(
          "DELETE FROM extension_document_index_values WHERE plugin_id = ?",
          pluginId,
        );
        transaction.run(
          "DELETE FROM extension_documents WHERE plugin_id = ?",
          pluginId,
        );
        transaction.run(
          "DELETE FROM extension_event_checkpoints WHERE plugin_id = ?",
          pluginId,
        );
      }
      transaction.run(
        "DELETE FROM extension_grants WHERE plugin_id = ?",
        pluginId,
      );
      transaction.run(
        "DELETE FROM extension_revisions WHERE plugin_id = ?",
        pluginId,
      );
      transaction.run(
        "DELETE FROM installed_extensions WHERE plugin_id = ?",
        pluginId,
      );
    });
    return { uninstalled: true, data, ...(artifactRef ? { artifactRef } : {}) };
  }

  async invoke(
    pluginId: string,
    handlerId: string,
    payload: unknown,
  ): Promise<JsonValue> {
    if (!this.host) throw new Error("Extension Host is unavailable");
    return (await this.host.invokeExtension({
      pluginId,
      handlerId,
      payload,
    })) as JsonValue;
  }

  async invokeCommand(
    pluginId: string,
    commandId: string,
    payload: unknown,
  ): Promise<JsonValue> {
    const manifest = this.activeManifest(pluginId);
    if (
      !manifest.permissions.includes("commands.register") ||
      !manifest.uiContributions.some((item) => item.command === commandId)
    )
      throw new Error("Extension command is not declared or granted");
    return this.invoke(pluginId, commandId, payload);
  }

  async invokeRouteByPath(
    pluginId: string,
    method: "delete" | "get" | "patch" | "post" | "put",
    path: string,
    payload: unknown,
  ): Promise<JsonValue> {
    const manifest = this.activeManifest(pluginId);
    if (!manifest.permissions.includes("extensions.route"))
      throw new Error("Extension route permission is not granted");
    const requestSegments = path.split("/").filter(Boolean);
    const route = manifest.serverContributions.find((item) => {
      if (item.method !== method) return false;
      const declaredSegments = item.path.split("/").filter(Boolean);
      return (
        declaredSegments.length === requestSegments.length &&
        declaredSegments.every(
          (segment, index) =>
            (/^\{[a-zA-Z][a-zA-Z0-9_]*\}$/u.test(segment) ||
              segment === requestSegments[index]) &&
            requestSegments[index] !== undefined,
        )
      );
    });
    if (!route) throw new Error("Extension route is not declared");
    assertJsonSchemaValue(payload, route.requestSchema);
    const result = await this.invoke(pluginId, route.handler, payload);
    assertJsonSchemaValue(result, route.responseSchema);
    return result;
  }

  uiContributions(): readonly JsonValue[] {
    return this.listInstalled().flatMap((value) => {
      const installed = value as { state?: unknown; manifest?: unknown };
      if (installed.state !== "active") return [];
      const manifest = ExtensionManifestSchema.safeParse(installed.manifest);
      return manifest.success
        ? manifest.data.uiContributions.map((entry) =>
            jsonValue({
              ...entry,
              pluginId: (value as { pluginId: string }).pluginId,
            }),
          )
        : [];
    });
  }

  effectiveOpenApi(): JsonValue {
    const paths: Record<string, JsonValue> = {};
    for (const value of this.listInstalled()) {
      const installed = value as {
        pluginId: string;
        state: string;
        manifest: unknown;
      };
      if (installed.state !== "active") continue;
      const manifest = ExtensionManifestSchema.parse(installed.manifest);
      for (const route of manifest.serverContributions)
        paths[`/api/v2/extensions/${installed.pluginId}${route.path}`] =
          jsonValue({
            [route.method]: {
              operationId: `extension.${installed.pluginId}.${route.id}`,
              requestBody: route.requestSchema ?? null,
              responses: {
                "200": {
                  description: "Extension response",
                  schema: route.responseSchema,
                },
              },
            },
          });
    }
    return {
      openapi: "3.1.0",
      info: { title: "DramaIP Instance Extensions", version: "1" },
      paths,
    };
  }

  private installed(pluginId: string):
    | {
        pluginId: string;
        revisionId: string | null;
        permissionRevision: number;
        manifest?: ExtensionManifest;
      }
    | undefined {
    return this.listInstalled()
      .map((value) => value as Record<string, unknown>)
      .filter((value) => value.pluginId === pluginId)
      .map((value) => ({
        pluginId,
        revisionId: value.revisionId as string | null,
        permissionRevision: value.permissionRevision as number,
        ...(value.manifest
          ? { manifest: ExtensionManifestSchema.parse(value.manifest) }
          : {}),
      }))[0];
  }

  private activeManifest(pluginId: string): ExtensionManifest {
    const installed = this.listInstalled().find(
      (value) => (value as { pluginId?: unknown }).pluginId === pluginId,
    ) as { state?: string; manifest?: unknown } | undefined;
    if (!installed || installed.state !== "active" || !installed.manifest)
      throw new Error("Extension is not active");
    return ExtensionManifestSchema.parse(installed.manifest);
  }

  private assertCompatible(manifest: ExtensionManifest): void {
    if (!satisfiesRange(DRAMAIP_RUNTIME_VERSION, manifest.product))
      throw new Error("Extension is incompatible with this DramaIP version");
    for (const dependency of manifest.dependencies) {
      const installed = this.installed(dependency.id);
      const version = installed?.manifest?.version;
      if (!version || !satisfiesRange(version, dependency.range)) {
        if (dependency.optional) continue;
        throw new Error(
          `Extension dependency is missing or incompatible: ${dependency.id}`,
        );
      }
    }
  }

  private preview(previewId: string): PreviewRow {
    const row = this.uow.execute((transaction) =>
      transaction.get<PreviewRow>(
        "SELECT * FROM extension_install_previews WHERE preview_id = ?",
        previewId,
      ),
    );
    if (!row) throw new Error("Extension installation preview was not found");
    return row;
  }

  private revision(revisionId: string): RevisionRow {
    const row = this.uow.execute((transaction) =>
      transaction.get<RevisionRow>(
        "SELECT * FROM extension_revisions WHERE revision_id = ?",
        revisionId,
      ),
    );
    if (!row) throw new Error("Extension revision was not found");
    return row;
  }

  private grants(
    pluginId: string,
    revision: number,
  ): { permissions: readonly string[]; scopes: Record<string, JsonValue> } {
    const rows = this.uow.execute((transaction) =>
      transaction.all<{ permission: string; scope_json: string }>(
        `SELECT permission, scope_json FROM extension_grants
         WHERE plugin_id = ? AND permission_revision = ? AND revoked_at IS NULL`,
        pluginId,
        revision,
      ),
    );
    return {
      permissions: rows.map((row) => row.permission),
      scopes: Object.fromEntries(
        rows.map((row) => [
          row.permission,
          JSON.parse(row.scope_json) as JsonValue,
        ]),
      ),
    };
  }

  private audit(
    pluginId: string,
    revisionId: string,
    action: string,
    outcome: string,
    traceId?: string,
  ): void {
    this.uow.execute((transaction) =>
      transaction.run(
        `INSERT INTO extension_audit(
          audit_id, plugin_id, revision_id, action, outcome, trace_id, detail_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`,
        randomUUID(),
        pluginId,
        revisionId,
        action,
        outcome,
        traceId ?? null,
        new Date().toISOString(),
      ),
    );
  }

  private reconcileEventConsumer(pluginId: string): void {
    this.eventConsumers.get(pluginId)?.();
    this.eventConsumers.delete(pluginId);
    if (!this.eventRuntime || !this.host) return;
    let manifest: ExtensionManifest;
    let revisionId: string;
    try {
      const installed = this.listInstalled().find(
        (value) => (value as { pluginId?: unknown }).pluginId === pluginId,
      ) as
        | { state: string; revisionId: string | null; manifest?: unknown }
        | undefined;
      if (
        !installed ||
        installed.state !== "active" ||
        !installed.revisionId ||
        !installed.manifest
      )
        return;
      revisionId = installed.revisionId;
      manifest = ExtensionManifestSchema.parse(installed.manifest);
      if (manifest.eventSubscriptions.length === 0) return;
      const cleanup = this.eventRuntime.registerConsumer({
        id: `extension:${pluginId}:${revisionId}`,
        pluginId: "system",
        critical: false,
        eventTypes: [
          ...new Set(
            manifest.eventSubscriptions.map((entry) => entry.eventType),
          ),
        ],
        handle: async (event: DomainEvent) => {
          for (const subscription of manifest.eventSubscriptions) {
            if (subscription.eventType !== event.type) continue;
            await this.host!.invokeExtension({
              pluginId,
              handlerId: subscription.handler,
              payload: jsonValue(event),
            });
            this.uow.execute((transaction) =>
              transaction.run(
                `INSERT INTO extension_event_checkpoints(
                  plugin_id, subscription_id, cursor, updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(plugin_id, subscription_id) DO UPDATE SET
                  cursor = excluded.cursor,
                  updated_at = excluded.updated_at`,
                pluginId,
                subscription.id,
                event.cursor,
                new Date().toISOString(),
              ),
            );
          }
        },
      });
      this.eventConsumers.set(pluginId, cleanup);
    } catch {
      this.uow.execute((transaction) =>
        transaction.run(
          "UPDATE installed_extensions SET state = 'degraded', updated_at = ? WHERE plugin_id = ?",
          new Date().toISOString(),
          pluginId,
        ),
      );
    }
  }
}
