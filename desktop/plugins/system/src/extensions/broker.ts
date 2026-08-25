import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  AGENT_TASK_RUNNER_SERVICE,
  AgentEngineKindSchema,
  type JsonValue,
} from "@dramaip/contracts";
import {
  ProjectInputSchema,
  ProjectPatchSchema,
  WORKSPACE_PROJECT_SERVICE,
} from "@dramaip/contracts/workspace";
import {
  ChapterInputSchema,
  ChapterPatchSchema,
  WRITING_CHAPTER_SERVICE,
} from "@dramaip/contracts/writing";
import {
  MEDIA_RECORD_SERVICE,
  MediaRecordInputSchema,
  MediaRecordKindSchema,
} from "@dramaip/contracts/media";
import type { ExtensionManifest } from "@dramaip/extension-host";
import type {
  TypedServiceRegistry,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";
import { assertJsonSchemaValue, jsonPathValue } from "./json-schema.js";

interface GrantIdentity {
  pluginId: string;
  revision: string;
  permissionRevision: number;
  permissions: ReadonlySet<string>;
  networkOrigins: ReadonlySet<string>;
  scopes: ReadonlyMap<string, JsonValue>;
  expiresAt: number;
}

export interface ExtensionCapabilityCall {
  capability: string;
  input?: JsonValue;
  payload?: JsonValue;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Extension capability input must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== "string" || !value || value.length > maximum)
    throw new Error(`${name} is invalid`);
  return value;
}

function serializable(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class ExtensionCapabilityBroker {
  private readonly tokens = new Map<string, GrantIdentity>();
  private manifestResolver:
    ((pluginId: string, revision: string) => ExtensionManifest) | undefined;
  private serviceResolver: (() => TypedServiceRegistry) | undefined;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly host?: DesktopHostClient,
  ) {}

  setManifestResolver(
    resolver: (pluginId: string, revision: string) => ExtensionManifest,
  ): void {
    this.manifestResolver = resolver;
  }

  setServiceResolver(resolver: () => TypedServiceRegistry): void {
    this.serviceResolver = resolver;
  }

  issue(input: {
    pluginId: string;
    revision: string;
    permissionRevision: number;
    permissions: readonly string[];
    networkOrigins?: readonly string[];
    scopes?: Readonly<Record<string, JsonValue>>;
    ttlMs?: number;
  }): string {
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, {
      pluginId: input.pluginId,
      revision: input.revision,
      permissionRevision: input.permissionRevision,
      permissions: new Set(input.permissions),
      networkOrigins: new Set(input.networkOrigins ?? []),
      scopes: new Map(Object.entries(input.scopes ?? {})),
      expiresAt: Date.now() + (input.ttlMs ?? 12 * 60 * 60_000),
    });
    return token;
  }

  revoke(pluginId: string): void {
    for (const [token, identity] of this.tokens)
      if (identity.pluginId === pluginId) this.tokens.delete(token);
  }

  revokeToken(token: string): void {
    this.tokens.delete(token);
  }

  revokeRevision(pluginId: string, revision: string): void {
    for (const [token, identity] of this.tokens)
      if (identity.pluginId === pluginId && identity.revision === revision)
        this.tokens.delete(token);
  }

  retainRevision(pluginId: string, revision: string): void {
    for (const [token, identity] of this.tokens)
      if (identity.pluginId === pluginId && identity.revision !== revision)
        this.tokens.delete(token);
  }

  async handle(
    authorization: string | undefined,
    callValue: unknown,
    traceId: string = randomUUID(),
  ): Promise<JsonValue> {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const identity = this.identity(token);
    const call = record(callValue);
    const capability = text(call.capability, "capability", 100);
    if (!identity.permissions.has(capability))
      throw new Error(`Extension capability is not granted: ${capability}`);
    const input = record(call.input ?? call.payload ?? {});
    const result = await this.dispatch(identity, capability, input);
    this.audit(identity, capability, "allowed", traceId);
    return result;
  }

  diagnostics(): readonly Record<string, JsonValue>[] {
    return [...this.tokens.values()]
      .map((identity) => ({
        pluginId: identity.pluginId,
        revision: identity.revision,
        permissionRevision: identity.permissionRevision,
        permissions: [...identity.permissions].sort(),
        scopes: Object.fromEntries(identity.scopes),
        expiresAt: new Date(identity.expiresAt).toISOString(),
      }))
      .sort((left, right) =>
        String(left.pluginId).localeCompare(String(right.pluginId)),
      );
  }

  private identity(token: string): GrantIdentity {
    if (!token || token.length > 256)
      throw new Error("Extension capability token is invalid");
    for (const [candidate, identity] of this.tokens) {
      const left = Buffer.from(candidate);
      const right = Buffer.from(token);
      if (left.length !== right.length || !timingSafeEqual(left, right))
        continue;
      if (identity.expiresAt <= Date.now()) {
        this.tokens.delete(candidate);
        break;
      }
      return identity;
    }
    throw new Error("Extension capability token is expired or revoked");
  }

  private async dispatch(
    identity: GrantIdentity,
    capability: string,
    input: Record<string, unknown>,
  ): Promise<JsonValue> {
    if (capability === "storage.read")
      return this.readDocument(identity, input);
    if (capability === "storage.write" && input.operation === "delete")
      return this.deleteDocument(identity, input);
    if (capability === "storage.write")
      return this.writeDocument(identity, input);
    if (capability === "projects.read")
      return this.readProjects(identity, input);
    if (capability === "projects.write")
      return this.writeProjects(identity, input);
    if (capability === "documents.read")
      return this.readDocuments(identity, input);
    if (capability === "documents.write")
      return this.writeDocuments(identity, input);
    if (capability === "assets.read") return this.readAssets(identity, input);
    if (capability === "assets.write") return this.writeAssets(identity, input);
    if (capability === "ai.invoke") return this.invokeAi(identity, input);
    if (capability === "notification.show") {
      if (!this.host) throw new Error("Desktop notification is unavailable");
      await this.host.notify({
        title: text(input.title, "title", 120),
        ...(typeof input.body === "string"
          ? { body: input.body.slice(0, 1_000) }
          : {}),
      });
      return null;
    }
    if (capability === "network.request") {
      if (!this.host)
        throw new Error("Desktop network capability is unavailable");
      const url = new URL(text(input.url, "url", 2_000));
      if (!identity.networkOrigins.has(url.origin))
        throw new Error("Extension network origin is not granted");
      return (await this.host.extensionNetworkRequest({
        url: url.href,
        method: input.method === "POST" ? "POST" : "GET",
        ...(input.body && typeof input.body === "object"
          ? { body: input.body as Record<string, unknown> }
          : {}),
      })) as unknown as JsonValue;
    }
    throw new Error(`Extension capability is not implemented: ${capability}`);
  }

  private readDocument(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const collection = text(input.collection, "collection", 80);
    this.collection(identity, collection);
    const documentId = text(input.documentId, "documentId", 200);
    return this.uow.execute((transaction) => {
      const row = transaction.get<{ document_json: string; version: number }>(
        `SELECT document_json, version FROM extension_documents
         WHERE plugin_id = ? AND collection_name = ? AND document_id = ?`,
        identity.pluginId,
        collection,
        documentId,
      );
      return row
        ? {
            value: JSON.parse(row.document_json) as JsonValue,
            version: row.version,
          }
        : null;
    });
  }

  private writeDocument(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const collection = text(input.collection, "collection", 80);
    const collectionDefinition = this.collection(identity, collection);
    const documentId = text(input.documentId, "documentId", 200);
    assertJsonSchemaValue(input.value ?? null, collectionDefinition.schema);
    const document = JSON.stringify(input.value ?? null);
    if (Buffer.byteLength(document) > 1024 * 1024)
      throw new Error("Extension document exceeds 1 MiB");
    const now = new Date().toISOString();
    return this.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO extension_documents(
          plugin_id, collection_name, document_id, document_json, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(plugin_id, collection_name, document_id) DO UPDATE SET
          document_json = excluded.document_json,
          version = extension_documents.version + 1,
          updated_at = excluded.updated_at`,
        identity.pluginId,
        collection,
        documentId,
        document,
        now,
        now,
      );
      transaction.run(
        `DELETE FROM extension_document_index_values
         WHERE plugin_id = ? AND collection_name = ? AND document_id = ?`,
        identity.pluginId,
        collection,
        documentId,
      );
      for (const index of collectionDefinition.indexes) {
        const value = jsonPathValue(input.value, index.path);
        if (value === undefined || value === null) continue;
        if (index.type === "string" && typeof value !== "string")
          throw new Error(`Extension index ${index.name} requires a string`);
        if (
          index.type === "number" &&
          (typeof value !== "number" || !Number.isFinite(value))
        )
          throw new Error(`Extension index ${index.name} requires a number`);
        if (index.type === "boolean" && typeof value !== "boolean")
          throw new Error(`Extension index ${index.name} requires a boolean`);
        transaction.run(
          `INSERT INTO extension_document_index_values(
            plugin_id, collection_name, document_id, index_name,
            text_value, number_value, boolean_value
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          identity.pluginId,
          collection,
          documentId,
          index.name,
          index.type === "string" ? value : null,
          index.type === "number" ? value : null,
          index.type === "boolean" ? (value ? 1 : 0) : null,
        );
      }
      return transaction.get<{ version: number }>(
        `SELECT version FROM extension_documents
         WHERE plugin_id = ? AND collection_name = ? AND document_id = ?`,
        identity.pluginId,
        collection,
        documentId,
      )!.version;
    });
  }

  private deleteDocument(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const collection = text(input.collection, "collection", 80);
    this.collection(identity, collection);
    const documentId = text(input.documentId, "documentId", 200);
    this.uow.execute((transaction) =>
      transaction.run(
        `DELETE FROM extension_documents
         WHERE plugin_id = ? AND collection_name = ? AND document_id = ?`,
        identity.pluginId,
        collection,
        documentId,
      ),
    );
    return null;
  }

  private collection(identity: GrantIdentity, name: string) {
    const manifest = this.manifestResolver?.(
      identity.pluginId,
      identity.revision,
    );
    if (!manifest) throw new Error("Extension manifest is unavailable");
    const collection = manifest.storage.collections.find(
      (candidate) => candidate.name === name,
    );
    if (!collection)
      throw new Error(`Extension storage collection is not declared: ${name}`);
    return collection;
  }

  private services(): TypedServiceRegistry {
    const services = this.serviceResolver?.();
    if (!services) throw new Error("Extension domain services are unavailable");
    return services;
  }

  private scopeAllows(
    identity: GrantIdentity,
    capability: string,
    projectId: string,
  ): boolean {
    const value = identity.scopes.get(capability);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const scope = value as Record<string, JsonValue>;
    return (
      scope.allProjects === true ||
      (Array.isArray(scope.projectIds) && scope.projectIds.includes(projectId))
    );
  }

  private assertProjectScope(
    identity: GrantIdentity,
    capability: string,
    projectId: string,
  ): void {
    if (!this.scopeAllows(identity, capability, projectId))
      throw new Error(`Extension project scope is not granted: ${projectId}`);
  }

  private readProjects(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(WORKSPACE_PROJECT_SERVICE);
    if (!service)
      throw new Error("Workspace project capability is unavailable");
    if (input.operation === "get") {
      const project = service.get(text(input.projectId, "projectId"));
      if (!project) return null;
      this.assertProjectScope(identity, "projects.read", project.id);
      return serializable(project);
    }
    return serializable(
      service
        .list()
        .filter((project) =>
          this.scopeAllows(identity, "projects.read", project.id),
        ),
    );
  }

  private writeProjects(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(WORKSPACE_PROJECT_SERVICE);
    if (!service)
      throw new Error("Workspace project capability is unavailable");
    if (input.operation === "create") {
      const scope = identity.scopes.get("projects.write") as
        Record<string, JsonValue> | undefined;
      if (scope?.allProjects !== true)
        throw new Error("Creating projects requires all-projects scope");
      return serializable(
        service.create(ProjectInputSchema.parse(input.value)),
      );
    }
    if (input.operation === "update") {
      const projectId = text(input.projectId, "projectId");
      this.assertProjectScope(identity, "projects.write", projectId);
      return serializable(
        service.update(projectId, ProjectPatchSchema.parse(input.value)) ??
          null,
      );
    }
    throw new Error("Unsupported projects.write operation");
  }

  private readDocuments(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(WRITING_CHAPTER_SERVICE);
    if (!service) throw new Error("Document capability is unavailable");
    if (input.operation === "get") {
      const document = service.get(text(input.documentId, "documentId"));
      if (!document) return null;
      this.assertProjectScope(identity, "documents.read", document.projectId);
      return serializable(document);
    }
    const projectId = text(input.projectId, "projectId");
    this.assertProjectScope(identity, "documents.read", projectId);
    return serializable(service.list(projectId));
  }

  private writeDocuments(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(WRITING_CHAPTER_SERVICE);
    if (!service) throw new Error("Document capability is unavailable");
    if (input.operation === "create") {
      const value = ChapterInputSchema.parse(input.value);
      this.assertProjectScope(identity, "documents.write", value.projectId);
      return serializable(service.create(value));
    }
    const documentId = text(input.documentId, "documentId");
    const current = service.get(documentId);
    if (!current) return null;
    this.assertProjectScope(identity, "documents.write", current.projectId);
    if (input.operation === "update")
      return serializable(
        service.update(documentId, ChapterPatchSchema.parse(input.value)),
      );
    if (input.operation === "delete") return service.remove(documentId);
    throw new Error("Unsupported documents.write operation");
  }

  private readAssets(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(MEDIA_RECORD_SERVICE);
    if (!service) throw new Error("Asset capability is unavailable");
    if (input.operation === "get") {
      const asset = service.get(text(input.assetId, "assetId"));
      if (!asset) return null;
      this.assertProjectScope(identity, "assets.read", asset.projectId);
      return serializable(asset);
    }
    const projectId = text(input.projectId, "projectId");
    this.assertProjectScope(identity, "assets.read", projectId);
    return serializable(
      service.list(MediaRecordKindSchema.parse(input.kind), { projectId }),
    );
  }

  private writeAssets(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): JsonValue {
    const service = this.services().optional(MEDIA_RECORD_SERVICE);
    if (!service) throw new Error("Asset capability is unavailable");
    if (input.operation === "create") {
      const value = MediaRecordInputSchema.parse(input.value);
      this.assertProjectScope(identity, "assets.write", value.projectId);
      return serializable(
        service.create(MediaRecordKindSchema.parse(input.kind), value),
      );
    }
    const assetId = text(input.assetId, "assetId");
    const current = service.get(assetId);
    if (!current) return null;
    this.assertProjectScope(identity, "assets.write", current.projectId);
    if (input.operation === "update") {
      const value = record(input.value);
      return serializable(
        service.update(assetId, {
          version: Number(value.version),
          ...(typeof value.title === "string" ? { title: value.title } : {}),
          ...(value.payload && typeof value.payload === "object"
            ? { payload: value.payload as Record<string, unknown> }
            : {}),
        }),
      );
    }
    if (input.operation === "delete") return service.remove(assetId);
    throw new Error("Unsupported assets.write operation");
  }

  private async invokeAi(
    identity: GrantIdentity,
    input: Record<string, unknown>,
  ): Promise<JsonValue> {
    const service = this.services().optional(AGENT_TASK_RUNNER_SERVICE);
    if (!service) throw new Error("AI invocation capability is unavailable");
    const projectId = text(input.projectId, "projectId");
    this.assertProjectScope(identity, "ai.invoke", projectId);
    return serializable(
      await service.start({
        projectId,
        ...(typeof input.chapterId === "string"
          ? { chapterId: input.chapterId }
          : {}),
        ...(typeof input.baseVersion === "number"
          ? { baseVersion: input.baseVersion }
          : {}),
        taskType: text(input.taskType, "taskType", 100),
        engineKind: AgentEngineKindSchema.parse(input.engineKind),
        prompt: text(input.prompt, "prompt", 100_000),
        ...(input.model && typeof input.model === "object"
          ? { model: input.model as Record<string, unknown> }
          : {}),
        ...(input.selection !== undefined
          ? { selection: input.selection }
          : {}),
      }),
    );
  }

  private audit(
    identity: GrantIdentity,
    action: string,
    outcome: string,
    traceId: string,
  ): void {
    this.uow.execute((transaction) =>
      transaction.run(
        `INSERT INTO extension_audit(
          audit_id, plugin_id, revision_id, action, outcome, trace_id, detail_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`,
        randomUUID(),
        identity.pluginId,
        identity.revision,
        action,
        outcome,
        traceId,
        new Date().toISOString(),
      ),
    );
  }
}
